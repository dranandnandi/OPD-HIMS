/**
 * Settings -> ABDM. The clinic's side of ABDM, as opposed to a patient's.
 *
 * Three things live here, in the order they have to happen:
 *
 *   1. The identity ABDM holds for this facility (read-only mirror).
 *   2. Where ABDM sends callbacks. Nothing in M2 works until this is right.
 *   3. The scan-and-share counter QR, which is also the cheapest way to prove
 *      2 actually works — a patient scan costs no quota and no rate limit,
 *      unlike every other flow that produces an inbound callback.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Link2,
  QrCode,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
  Printer,
} from 'lucide-react';
import { ClinicSetting } from '../../types';
import { abdmService, defaultCallbackBase } from '../../services/abdmService';
import {
  checkScanShareReadiness,
  renderShareProfileQr,
  type AbdmEnv,
} from '../../services/scanAndShareService';

interface AbdmSettingsProps {
  clinicSettings: ClinicSetting | null;
}

/** Escaped before it reaches the print window's markup — a clinic name is
 *  free text, and this string is interpolated into HTML. */
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const AbdmSettings: React.FC<AbdmSettingsProps> = ({ clinicSettings }) => {
  const [callbackUrl, setCallbackUrl] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registerResult, setRegisterResult] = useState<
    { type: 'success' | 'error'; text: string } | null
  >(null);
  const [confirmingRegister, setConfirmingRegister] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const [env, setEnv] = useState<AbdmEnv>('sandbox');
  const [qr, setQr] = useState<{ dataUrl: string; url: string } | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  const expectedBase = useMemo(() => defaultCallbackBase(), []);

  useEffect(() => {
    setCallbackUrl(expectedBase);
  }, [expectedBase]);

  const readiness = useMemo(
    () =>
      checkScanShareReadiness({
        abdmHipId: clinicSettings?.abdmHipId ?? null,
        abdmCounterCode: clinicSettings?.abdmCounterCode ?? null,
        hfrFacilityId: clinicSettings?.hfrFacilityId ?? null,
      }),
    [clinicSettings],
  );

  useEffect(() => {
    let cancelled = false;
    if (!readiness.ready) {
      setQr(null);
      return;
    }
    renderShareProfileQr(readiness.hipId, readiness.counterCode, env)
      .then((result) => {
        if (!cancelled) {
          setQr(result);
          setQrError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setQr(null);
          setQrError(error instanceof Error ? error.message : 'Could not render the QR code.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [readiness, env]);

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      // Clipboard is permission-gated; the value is on screen and selectable.
    }
  };

  const handleRegister = async () => {
    setRegistering(true);
    setRegisterResult(null);
    try {
      const result = await abdmService.registerCallback(callbackUrl.trim());
      // ABDM tells us which environment the bridge is in. Trust that over the
      // local guess, so the QR below cannot point at the wrong PHR host.
      setEnv(result.env === 'production' ? 'production' : 'sandbox');
      setRegisterResult({
        type: 'success',
        text: `Registered with ABDM (${result.env}). ABDM will now deliver callbacks to ${result.url}`,
      });
    } catch (error) {
      setRegisterResult({
        type: 'error',
        text: error instanceof Error ? error.message : 'Registration failed.',
      });
    } finally {
      setRegistering(false);
      setConfirmingRegister(false);
    }
  };

  const handlePrintQr = () => {
    if (!qr) return;
    const win = window.open('', '_blank', 'width=640,height=800');
    if (!win) return;
    const title = escapeHtml(clinicSettings?.abdmHipName || clinicSettings?.clinicName || 'Clinic');
    const counter = escapeHtml(readiness.ready ? readiness.counterCode : '');
    win.document.write(
      `<!doctype html><html><head><title>ABHA Scan &amp; Share</title>` +
        `<style>` +
        `body { font-family: system-ui, sans-serif; text-align: center; padding: 40px; }` +
        `h1 { font-size: 20px; margin-bottom: 4px; }` +
        `p { color: #555; font-size: 13px; margin-top: 0; }` +
        `img { width: 320px; height: 320px; margin: 24px auto; display: block; }` +
        `.counter { font-size: 12px; color: #777; }` +
        `</style></head><body>` +
        `<h1>${title}</h1>` +
        `<p>Scan with your ABHA app to share your health ID</p>` +
        `<img src="${qr.dataUrl}" alt="ABHA scan and share QR" />` +
        `<p class="counter">Counter ${counter}</p>` +
        `</body></html>`,
    );
    win.document.close();
    win.focus();
    win.print();
  };

  const identityRows: Array<{ label: string; value: string | null | undefined; hint?: string }> = [
    { label: 'HFR facility ID', value: clinicSettings?.hfrFacilityId, hint: 'From the HFR portal' },
    { label: 'HIP ID', value: clinicSettings?.abdmHipId, hint: 'Minted when the bridge was linked' },
    {
      label: 'Name shown to patients',
      value: clinicSettings?.abdmHipName,
      hint: 'What appears in the ABHA app — deliberately separate from the clinic name',
    },
    {
      label: 'Counter code',
      value: clinicSettings?.abdmCounterCode,
      hint: 'Which desk the QR belongs to',
    },
  ];

  return (
    <div className="space-y-6">
      {/* 1. Identity */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">ABDM identity</h3>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          These are ABDM&apos;s records for this clinic, mirrored here for reference. They are set
          during HFR registration and bridge linkage, not edited in the app.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {identityRows.map((row) => (
            <div key={row.label} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <label className="block text-sm font-medium text-gray-600 mb-1">{row.label}</label>
              {row.value ? (
                <p className="text-gray-800 font-medium break-all">{row.value}</p>
              ) : (
                <p className="text-amber-600 font-medium">Not set</p>
              )}
              {row.hint && <p className="text-xs text-gray-500 mt-1">{row.hint}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* 2. Callback URL */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <Link2 className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">Callback URL</h3>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Where ABDM delivers link tokens, patient shares and consent notifications. Register the
          <strong> base URL only</strong> — ABDM appends its own path to it.
        </p>

        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 space-y-1">
            <p>
              <strong>This setting is bridge-wide, not per-clinic.</strong> Changing it moves where
              ABDM delivers patient data for every clinic on this bridge.
            </p>
            <p>
              If a full endpoint is registered instead of the base, ABDM appends the path a second
              time and callbacks silently stop arriving, with nothing logged to explain it.
            </p>
          </div>
        </div>

        <label className="block text-sm font-medium text-gray-600 mb-1">Base URL</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            value={callbackUrl}
            onChange={(e) => {
              setCallbackUrl(e.target.value);
              setConfirmingRegister(false);
            }}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
            placeholder="https://your-domain/functions/v1/abdm-callback"
          />
          <button
            onClick={() => copy(callbackUrl, 'callback')}
            className="flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
            type="button"
          >
            {copied === 'callback' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            Copy
          </button>
        </div>

        {expectedBase && callbackUrl.trim() !== expectedBase && (
          <p className="text-xs text-amber-700 mt-2">
            This differs from this deployment&apos;s dispatcher, which is{' '}
            <span className="font-mono">{expectedBase}</span>. Callbacks will go somewhere else.
          </p>
        )}

        <div className="mt-4">
          {!confirmingRegister ? (
            <button
              onClick={() => setConfirmingRegister(true)}
              disabled={!callbackUrl.trim()}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              type="button"
            >
              Register with ABDM
            </button>
          ) : (
            <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-900 mb-3">
                Point every ABDM callback for this bridge at{' '}
                <span className="font-mono break-all">{callbackUrl.trim()}</span>?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleRegister}
                  disabled={registering}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  type="button"
                >
                  {registering && <Loader2 className="w-4 h-4 animate-spin" />}
                  {registering ? 'Registering…' : 'Yes, register it'}
                </button>
                <button
                  onClick={() => setConfirmingRegister(false)}
                  disabled={registering}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {registerResult && (
          <div
            className={`mt-4 p-3 rounded-lg text-sm ${
              registerResult.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}
          >
            {registerResult.text}
          </div>
        )}
      </div>

      {/* 3. Scan and share */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <QrCode className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-800">Scan &amp; share QR</h3>
          </div>
          <select
            value={env}
            onChange={(e) => setEnv(e.target.value as AbdmEnv)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          >
            <option value="sandbox">Sandbox</option>
            <option value="production">Production</option>
          </select>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Print this and keep it at reception. A patient scans it in their ABHA app and their
          KYC&apos;d profile arrives here — no typing, no OTP. It must match the environment the
          server is configured for; a production QR is inert against a sandbox bridge.
        </p>

        {!readiness.ready ? (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            {readiness.reason}
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            {qr ? (
              <img
                src={qr.dataUrl}
                alt="ABHA scan and share QR"
                className="w-48 h-48 border border-gray-200 rounded-lg"
              />
            ) : (
              <div className="w-48 h-48 border border-gray-200 rounded-lg flex items-center justify-center text-center text-sm text-gray-400 p-2">
                {qrError ?? 'Rendering…'}
              </div>
            )}

            <div className="flex-1 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Encoded URL</label>
                <p className="font-mono text-xs text-gray-700 break-all bg-gray-50 border border-gray-200 rounded p-2">
                  {qr?.url ?? '—'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => qr && copy(qr.url, 'qr')}
                  disabled={!qr}
                  className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  type="button"
                >
                  {copied === 'qr' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  Copy URL
                </button>
                <button
                  onClick={handlePrintQr}
                  disabled={!qr}
                  className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  type="button"
                >
                  <Printer className="w-4 h-4" />
                  Print
                </button>
              </div>
              <p className="text-xs text-gray-500">
                A scan is the cheapest end-to-end test of the callback URL above: it costs no rate
                limit and can be repeated, unlike the flows that consume ABDM quota.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AbdmSettings;
