import React, { useState } from 'react';
import { CreditCard, Loader2, Printer, AlertCircle } from 'lucide-react';
import { abhaService, ABHASessionExpiredError } from '../../services/abhaService';

/**
 * ABHA card and QR download — spec sections 10 and 11.
 *
 * Shown on the success step of both verification flows, and only there. Both
 * ABDM endpoints authenticate as the patient using the X-token, which is
 * retained server-side for a few minutes after verification and then discarded
 * (we deliberately do not keep it — that was G-02). So this is a
 * take-it-now-or-verify-again affair, and the copy says so rather than letting
 * reception discover it later.
 *
 * Nothing is stored: the images live in this component's state and go straight
 * to a print window, so the clinic never accumulates ABHA cards at rest.
 */

interface ABHACardPanelProps {
  sessionId: string;
  patientName: string;
}

const ABHACardPanel: React.FC<ABHACardPanelProps> = ({ sessionId, patientName }) => {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);

  const handleFetch = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await abhaService.getCard(sessionId);
      setQrCode(res.qrCode);
      setCard(res.card);
      if (!res.qrCode && !res.card) {
        setError('ABDM did not return a card for this ABHA.');
      }
    } catch (err) {
      if (err instanceof ABHASessionExpiredError) {
        setExpired(true);
        setError('The verification window has closed. Verify the ABHA again to print the card.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not fetch the ABHA card.');
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Print from a detached window rather than the app document.
   *
   * Printing the modal itself would drag the whole application's stylesheet in
   * and produce a page with navigation furniture around the card.
   */
  const handlePrint = () => {
    const image = card ?? qrCode;
    if (!image) return;

    const win = window.open('', '_blank', 'width=640,height=800');
    if (!win) {
      setError('Your browser blocked the print window. Allow pop-ups and try again.');
      return;
    }

    win.document.write(
      `<!doctype html><html><head><title>ABHA — ${patientName}</title>` +
        '<style>' +
        'body{margin:0;display:flex;align-items:center;justify-content:center;' +
        'min-height:100vh;font-family:system-ui,sans-serif}' +
        'img{max-width:100%;height:auto}' +
        '</style></head><body>' +
        `<img src="${image}" alt="ABHA card">` +
        // Wait for decode before printing, or the dialog can open on a blank page.
        '<script>const i=document.images[0];' +
        'const go=()=>{window.focus();window.print();};' +
        'i.complete?go():i.addEventListener("load",go);<\/script>' +
        '</body></html>',
    );
    win.document.close();
  };

  const fetched = Boolean(qrCode || card);

  return (
    <div className="border rounded-lg p-3 space-y-3 text-left">
      <div className="flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-blue-600" />
        <span className="text-sm font-medium">ABHA Card</span>
      </div>

      {!fetched && !expired && (
        <>
          <p className="text-xs text-gray-500">
            Available for the next few minutes only. After that the patient must verify again.
          </p>
          <button
            onClick={handleFetch}
            disabled={loading}
            className="btn-secondary w-full flex items-center justify-center gap-2 text-sm"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Fetching...' : 'Get ABHA card & QR'}
          </button>
        </>
      )}

      {fetched && (
        <>
          <div className="flex flex-wrap gap-3 items-start">
            {card && (
              <img
                src={card}
                alt="ABHA card"
                className="max-w-full rounded border"
                style={{ maxHeight: 180 }}
              />
            )}
            {qrCode && (
              <img
                src={qrCode}
                alt="ABHA QR code"
                className="rounded border bg-white"
                style={{ width: 110, height: 110, objectFit: 'contain' }}
              />
            )}
          </div>
          <button
            onClick={handlePrint}
            className="btn-secondary w-full flex items-center justify-center gap-2 text-sm"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </>
      )}

      {error && (
        <div className="flex items-start gap-2 text-amber-700 text-xs">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

export default ABHACardPanel;
