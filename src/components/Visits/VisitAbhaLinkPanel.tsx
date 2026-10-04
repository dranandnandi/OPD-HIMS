/**
 * "Share this visit to the patient's ABHA app" — the M2 care-context link.
 *
 * ############ WHY THIS SCREEN IS SHAPED THE WAY IT IS ######################
 *
 * Announcing a care context is PERMANENT. ABDM has no unlink, no rename and no
 * withdraw (FAQ v1.4 Q33): whatever is sent from here sits in that patient's
 * national health record for good, under the label shown below.
 *
 * So the panel deliberately does three things before offering the button:
 *
 *   - shows exactly what would be announced, with the patient-facing label,
 *     because that text is what the patient reads in their ABHA app;
 *   - names the ABHA address it would be attached to, since the whole failure
 *     mode worth fearing is announcing one patient's visit onto another
 *     patient's record;
 *   - says whether a link token is cached, because without one the first press
 *     spends one of only three generate-token calls allowed per patient per
 *     day and completes asynchronously rather than immediately.
 *
 * Reading state is a separate endpoint from linking, so rendering this panel
 * can never announce anything.
 * ###########################################################################
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Share2, AlertTriangle, CheckCircle, Clock, XCircle, Loader2 } from 'lucide-react';
import { abdmService, type VisitLinkStatus } from '../../services/abdmService';

interface VisitAbhaLinkPanelProps {
  visitId: string;
  patientId: string;
}

const STATUS_STYLES: Record<string, { icon: React.ElementType; className: string; label: string }> = {
  linked: { icon: CheckCircle, className: 'text-green-600', label: 'Linked' },
  pending: { icon: Clock, className: 'text-amber-600', label: 'Awaiting ABDM confirmation' },
  failed: { icon: XCircle, className: 'text-red-600', label: 'Failed' },
  'not-recorded': { icon: Clock, className: 'text-gray-400', label: 'Not shared yet' },
};

const VisitAbhaLinkPanel: React.FC<VisitAbhaLinkPanelProps> = ({ visitId, patientId }) => {
  const [status, setStatus] = useState<VisitLinkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [linking, setLinking] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      setStatus(await abdmService.getVisitLinkStatus(visitId, patientId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not read ABHA sharing status.');
    } finally {
      setLoading(false);
    }
  }, [visitId, patientId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleLink = async () => {
    setLinking(true);
    setResult(null);
    try {
      const response = await abdmService.linkCareContexts(visitId, patientId);

      if (response.alreadyLinked) {
        setResult({ type: 'info', text: 'This visit is already in the patient’s ABHA record.' });
      } else if (response.pending) {
        setResult({
          type: 'info',
          text:
            response.reason ??
            'A link token has been requested from ABDM. It arrives on a callback — try again in a minute.',
        });
      } else {
        // 202 from ABDM means accepted, not linked. Saying "shared" here would
        // be a claim we cannot support until the callback confirms it.
        setResult({
          type: 'success',
          text: 'ABDM accepted the request. It will appear in the ABHA app once ABDM confirms.',
        });
      }
      await load();
    } catch (error) {
      setResult({ type: 'error', text: error instanceof Error ? error.message : 'Sharing failed.' });
    } finally {
      setLinking(false);
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 flex items-center gap-3 text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking ABHA sharing status…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-3 mb-2">
          <Share2 className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">Share with ABHA</h3>
        </div>
        <p className="text-sm text-red-700">{loadError}</p>
      </div>
    );
  }

  if (!status) return null;

  const everythingLinked =
    status.careContexts.length > 0 && status.careContexts.every((c) => c.status === 'linked');
  const outstanding = status.careContexts.filter((c) => c.status !== 'linked');

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Share2 className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">Share with ABHA</h3>
        </div>
        {status.abhaAddress && (
          <span className="text-sm text-gray-500 font-mono">{status.abhaAddress}</span>
        )}
      </div>

      {status.blockers.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <ul className="text-sm text-amber-800 space-y-1">
              {status.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {status.careContexts.length === 0 ? (
        <p className="text-sm text-gray-600">
          This visit has no clinical content to share yet.
        </p>
      ) : (
        <div className="space-y-2 mb-4">
          {status.careContexts.map((context) => {
            const style = STATUS_STYLES[context.status] ?? STATUS_STYLES['not-recorded'];
            const Icon = style.icon;
            return (
              <div
                key={context.referenceNumber}
                className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3"
              >
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${style.className}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{context.display}</p>
                  <p className="text-xs text-gray-500">
                    {context.hiType} · {style.label}
                    {context.linkedAt && ` · ${new Date(context.linkedAt).toLocaleDateString()}`}
                  </p>
                  {context.errorMessage && (
                    <p className="text-xs text-red-600 mt-1">{context.errorMessage}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {status.ready && outstanding.length > 0 && !status.linkToken.present && (
        <p className="text-xs text-amber-700 mb-3">
          No link token is cached for this patient. The first attempt requests one from ABDM and
          finishes on a callback rather than immediately — and ABDM allows only three such requests
          per patient per day at this facility.
        </p>
      )}

      {status.ready && outstanding.length > 0 && (
        <div>
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              type="button"
            >
              <Share2 className="w-4 h-4" />
              Share this visit
            </button>
          ) : (
            <div className="p-4 border border-red-200 bg-red-50 rounded-lg">
              <p className="text-sm text-red-900 font-medium mb-2">
                This cannot be undone.
              </p>
              <p className="text-sm text-red-800 mb-3">
                {outstanding.length === 1 ? 'This entry' : `These ${outstanding.length} entries`} will
                be added permanently to{' '}
                <span className="font-mono">{status.abhaAddress}</span>. ABDM provides no way to
                unlink, rename or withdraw a care context afterwards.
              </p>
              <ul className="text-sm text-red-800 mb-3 list-disc list-inside">
                {outstanding.map((context) => (
                  <li key={context.referenceNumber}>{context.display}</li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button
                  onClick={handleLink}
                  disabled={linking}
                  className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50"
                  type="button"
                >
                  {linking && <Loader2 className="w-4 h-4 animate-spin" />}
                  {linking ? 'Sharing…' : 'Yes, share permanently'}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={linking}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {everythingLinked && (
        <p className="text-sm text-green-700">
          This visit is in the patient&apos;s ABHA record.
        </p>
      )}

      {result && (
        <div
          className={`mt-4 p-3 rounded-lg text-sm ${
            result.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : result.type === 'info'
                ? 'bg-blue-50 border border-blue-200 text-blue-800'
                : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {result.text}
        </div>
      )}
    </div>
  );
};

export default VisitAbhaLinkPanel;
