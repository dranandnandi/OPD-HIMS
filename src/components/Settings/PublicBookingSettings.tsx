import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Globe,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  Save,
  AlertCircle,
  Code2,
  Download,
} from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { clinicSettingsService } from '../../services/clinicSettingsService';
import { PublicBookingPolicy } from '../../types';

// Both production domains serve this same SPA, so the shareable link is built
// from wherever the admin happens to be signed in. A clinic on docpreneur.academy
// gets a docpreneur link; one on opdapp.anprohealthtech.com gets that.
const canonicalLink = (slug: string) => `${window.location.origin}/book/${slug}`;
const vanityLink = (slug: string) => `${window.location.origin}/${slug}/appointment`;

const embedSnippet = (slug: string) => `<!-- ${slug} appointment booking -->
<div id="opd-booking-${slug}"></div>
<script>
  (function () {
    var frame = document.createElement('iframe');
    frame.src = '${canonicalLink(slug)}?embed=1';
    frame.style.cssText = 'width:100%;border:0;min-height:640px';
    frame.setAttribute('title', 'Book an appointment');
    document.getElementById('opd-booking-${slug}').appendChild(frame);

    window.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'opd-booking-resize') {
        frame.style.height = event.data.height + 'px';
      }
    });
  })();
</script>`;

const DEFAULT_POLICY: Required<
  Pick<
    PublicBookingPolicy,
    'leadTimeHours' | 'horizonDays' | 'maxPerPhonePerDay' | 'autoConfirm' | 'noticeText'
  >
> = {
  leadTimeHours: 2,
  horizonDays: 14,
  maxPerPhonePerDay: 3,
  autoConfirm: false,
  noticeText: '',
};

const suggestSlug = (clinicName: string) =>
  clinicName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 41);

const PublicBookingSettings: React.FC = () => {
  const { user } = useAuth();
  const clinicId = user?.clinicId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  const [slug, setSlug] = useState('');
  const [savedSlug, setSavedSlug] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [policy, setPolicy] = useState<PublicBookingPolicy>(DEFAULT_POLICY);

  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!clinicId) return;

      try {
        const settings = await clinicSettingsService.getClinicSettings();
        if (!settings) return;

        const existing = settings.publicSlug ?? '';
        setSlug(existing || suggestSlug(settings.clinicName ?? ''));
        setSavedSlug(existing);
        setEnabled(settings.publicBookingEnabled ?? false);
        setPolicy({ ...DEFAULT_POLICY, ...(settings.publicBookingPolicy ?? {}) });
      } catch (error) {
        setMessage({
          type: 'error',
          text: error instanceof Error ? error.message : 'Failed to load settings.',
        });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [clinicId]);

  // QR points at the saved slug, not the draft: a code for a link that has not
  // been saved yet would print and hand out a dead URL.
  useEffect(() => {
    if (!savedSlug) {
      setQrDataUrl('');
      return;
    }

    QRCode.toDataURL(canonicalLink(savedSlug), { width: 320, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [savedSlug]);

  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(''), 2000);
    } catch {
      setMessage({ type: 'error', text: 'Could not copy. Please select and copy manually.' });
    }
  }, []);

  const handleSave = async () => {
    if (!clinicId) return;

    setSaving(true);
    setMessage(null);

    try {
      await clinicSettingsService.updatePublicBooking(clinicId, {
        publicSlug: slug.trim().toLowerCase() || null,
        publicBookingEnabled: enabled,
        publicBookingPolicy: policy,
      });

      setSavedSlug(slug.trim().toLowerCase());
      setMessage({ type: 'success', text: 'Public booking settings saved.' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save.',
      });
    } finally {
      setSaving(false);
    }
  };

  const updatePolicy = (patch: Partial<PublicBookingPolicy>) =>
    setPolicy((previous) => ({ ...previous, ...patch }));

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading public booking settings...
      </div>
    );
  }

  const isLive = enabled && Boolean(savedSlug);

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
          <Globe className="h-5 w-5 text-blue-600" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Public Booking</h2>
          <p className="text-sm text-gray-600">
            Give patients a link to book their own appointments &mdash; no login needed.
          </p>
        </div>
      </header>

      {message && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800'
              : 'bg-red-50 text-red-800'
          }`}
        >
          {message.type === 'success' ? (
            <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* --- link name ---------------------------------------------------- */}
      <section className="rounded-xl border border-gray-200 p-4">
        <label htmlFor="pb-slug" className="mb-1 block text-sm font-medium text-gray-900">
          Link name
        </label>
        <div className="flex items-center rounded-lg border border-gray-300 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
          <span className="whitespace-nowrap py-2 pl-3 text-sm text-gray-500">
            {window.location.host}/book/
          </span>
          <input
            id="pb-slug"
            type="text"
            value={slug}
            onChange={(event) =>
              setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
            }
            placeholder="meditrust"
            className="min-w-0 flex-1 rounded-r-lg px-1 py-2 text-sm outline-none"
          />
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Lowercase letters, numbers and hyphens. Must be unique across all clinics.
        </p>
      </section>

      {/* --- enable ------------------------------------------------------- */}
      <section className="rounded-xl border border-gray-200 p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          <span>
            <span className="block text-sm font-medium text-gray-900">
              Accept public bookings
            </span>
            <span className="block text-xs text-gray-500">
              When off, the link shows &ldquo;unavailable&rdquo; instead of the booking form.
            </span>
          </span>
        </label>
      </section>

      {/* --- policy ------------------------------------------------------- */}
      <section className="space-y-4 rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900">Booking rules</h3>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="pb-lead" className="mb-1 block text-xs font-medium text-gray-700">
              Minimum notice (hours)
            </label>
            <input
              id="pb-lead"
              type="number"
              min={0}
              max={720}
              value={policy.leadTimeHours ?? 2}
              onChange={(event) =>
                updatePolicy({ leadTimeHours: Number(event.target.value) })
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="pb-horizon" className="mb-1 block text-xs font-medium text-gray-700">
              Book up to (days ahead)
            </label>
            <input
              id="pb-horizon"
              type="number"
              min={1}
              max={90}
              value={policy.horizonDays ?? 14}
              onChange={(event) => updatePolicy({ horizonDays: Number(event.target.value) })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="pb-cap" className="mb-1 block text-xs font-medium text-gray-700">
              Max per phone / day
            </label>
            <input
              id="pb-cap"
              type="number"
              min={1}
              max={50}
              value={policy.maxPerPhonePerDay ?? 3}
              onChange={(event) =>
                updatePolicy({ maxPerPhonePerDay: Number(event.target.value) })
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={policy.autoConfirm ?? false}
            onChange={(event) => updatePolicy({ autoConfirm: event.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          <span>
            <span className="block text-sm font-medium text-gray-900">
              Auto-confirm bookings
            </span>
            <span className="block text-xs text-gray-500">
              Off is recommended: bookings arrive as <strong>Scheduled</strong> so
              reception can verify the phone number before confirming. Phone numbers
              are not verified by OTP yet.
            </span>
          </span>
        </label>

        <div>
          <label htmlFor="pb-notice" className="mb-1 block text-xs font-medium text-gray-700">
            Notice shown to patients (optional)
          </label>
          <textarea
            id="pb-notice"
            rows={2}
            maxLength={400}
            value={policy.noticeText ?? ''}
            onChange={(event) => updatePolicy({ noticeText: event.target.value })}
            placeholder="e.g. Please arrive 10 minutes early and carry your previous reports."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </section>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save settings
      </button>

      {/* --- share -------------------------------------------------------- */}
      {savedSlug && (
        <section className="space-y-4 rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Share your booking page</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                isLive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {isLive ? 'Live' : 'Not accepting bookings'}
            </span>
          </div>

          {[
            { key: 'canonical', label: 'Booking link', value: canonicalLink(savedSlug) },
            { key: 'vanity', label: 'Short link', value: vanityLink(savedSlug) },
          ].map((link) => (
            <div key={link.key}>
              <span className="mb-1 block text-xs font-medium text-gray-700">{link.label}</span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-800">
                  {link.value}
                </code>
                <button
                  type="button"
                  onClick={() => copy(link.value, link.key)}
                  title="Copy link"
                  className="rounded-lg border border-gray-300 p-2 text-gray-600 transition hover:bg-gray-50"
                >
                  {copied === link.key ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
                <a
                  href={link.value}
                  target="_blank"
                  rel="noreferrer"
                  title="Open in a new tab"
                  className="rounded-lg border border-gray-300 p-2 text-gray-600 transition hover:bg-gray-50"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          ))}

          {qrDataUrl && (
            <div className="flex items-center gap-4 rounded-lg bg-gray-50 p-4">
              <img src={qrDataUrl} alt="Booking page QR code" className="h-28 w-28" />
              <div>
                <p className="text-sm font-medium text-gray-900">QR code</p>
                <p className="mb-2 text-xs text-gray-600">
                  Print for the reception desk or waiting area.
                </p>
                <a
                  href={qrDataUrl}
                  download={`${savedSlug}-booking-qr.png`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <Code2 className="h-3.5 w-3.5 text-gray-500" />
              <span className="text-xs font-medium text-gray-700">
                Embed on the clinic website
              </span>
            </div>
            <pre className="max-h-48 overflow-auto rounded-lg bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">
              {embedSnippet(savedSlug)}
            </pre>
            <button
              type="button"
              onClick={() => copy(embedSnippet(savedSlug), 'embed')}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
            >
              {copied === 'embed' ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              Copy embed code
            </button>
          </div>
        </section>
      )}

      <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
        Only doctors marked <strong>&ldquo;Open for consultation&rdquo;</strong> appear on the
        public page, and their slots come from{' '}
        <strong>Settings &rarr; Doctor Availability</strong>. If a doctor has no
        availability set, the clinic&rsquo;s working hours are used instead.
      </p>
    </div>
  );
};

export default PublicBookingSettings;
