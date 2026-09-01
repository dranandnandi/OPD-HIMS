import React, { useState } from 'react';
import { CreditCard, Loader2, Printer, AlertCircle } from 'lucide-react';
import { abhaService, ABHASessionExpiredError, type ABHAProfile } from '../../services/abhaService';

/**
 * ABHA card and QR — spec sections 10 and 11, and NHA's M1 test CRT_ABHA_114.
 *
 * Shown on the success step of the verification flows, and only there. The ABDM
 * endpoints authenticate as the patient using the X-token, which is retained
 * server-side for a few minutes after verification and then discarded (we
 * deliberately do not keep it — that was G-02). So this is a
 * take-it-now-or-verify-again affair, and the copy says so rather than letting
 * reception discover it later.
 *
 * ############ WHY WE COMPOSE THE CARD OURSELVES ############################
 *
 * ABDM's `/v3/profile/account/abha-card` returns 401 with an EMPTY body for our
 * client ID, while `/qrCode` returns 200 on the same X-token — investigated at
 * length on 2026-08-25/26 and raised with NHA. It is not our request.
 *
 * That endpoint is not needed. CRT_ABHA_114 lists what a card must SHOW —
 * ABHA number, QR code, date of birth and gender, ABHA address, and an
 * OPTIONAL photo — and every one of those is already in hand from the
 * verification response plus the QR that works. So the card is rendered here
 * from data we hold, and ABDM's rendered PNG is used only if it ever arrives.
 *
 * Where a flow returns no demographics — the ABHA-address route returns
 * identity only — those rows are omitted rather than faked. The card then still
 * carries ABHA number, address and QR, which is what CRT_ABHA_115 asks of an
 * integrator who does not generate ABDM's own card.
 *
 * The photo is deliberately absent: it is optional in 114 and we strip it
 * server-side for privacy.
 * ###########################################################################
 *
 * Nothing is stored: the card lives in this component's state and goes straight
 * to a print window, so the clinic never accumulates ABHA cards at rest.
 */

interface ABHACardPanelProps {
  sessionId: string;
  patientName: string;
  profile: ABHAProfile;
}

/** Values come from ABDM and go into markup — escape before interpolation. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The card markup, built ONCE and used for both the on-screen preview and the
 * printed page.
 *
 * Deliberately a string rather than JSX duplicated into a print template: the
 * preview and the print-out must be the same artefact. Two copies of this
 * layout would drift, and the first anyone would notice is a printed card that
 * disagrees with what the operator approved on screen.
 */
function buildCardHtml(profile: ABHAProfile, qrCode: string | null, patientName: string): string {
  const rows: string[] = [];
  if (profile.abhaAddress) {
    rows.push(`<div class="row"><span>ABHA Address</span><b>${escapeHtml(profile.abhaAddress)}</b></div>`);
  }
  // Omitted rather than faked when ABDM did not supply them.
  if (profile.dob) {
    rows.push(`<div class="row"><span>Date of Birth</span><b>${escapeHtml(profile.dob)}</b></div>`);
  }
  if (profile.gender) {
    rows.push(`<div class="row"><span>Gender</span><b>${escapeHtml(profile.gender)}</b></div>`);
  }

  const qr = qrCode
    ? `<img class="qr" src="${escapeHtml(qrCode)}" alt="ABHA QR code">`
    : '<div class="qr placeholder">QR unavailable</div>';

  return (
    '<div class="abha-card">' +
    '<div class="head">' +
    '<span class="brand">आयुष्मान भारत डिजिटल मिशन</span>' +
    '<span class="brand-en">Ayushman Bharat Digital Mission</span>' +
    '</div>' +
    '<div class="body">' +
    '<div class="details">' +
    `<div class="name">${escapeHtml(profile.name || patientName)}</div>` +
    `<div class="number">${escapeHtml(abhaService.formatAbhaNumber(profile.abhaNumber))}</div>` +
    rows.join('') +
    '</div>' +
    qr +
    '</div>' +
    '</div>'
  );
}

/** Shared by the preview and the print window so the two cannot diverge. */
const CARD_CSS =
  '.abha-card{width:340px;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;' +
  'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#0f172a}' +
  '.abha-card .head{background:#1d4ed8;color:#fff;padding:6px 10px;line-height:1.25}' +
  '.abha-card .brand{display:block;font-size:11px}' +
  '.abha-card .brand-en{display:block;font-size:9px;opacity:.85}' +
  '.abha-card .body{display:flex;gap:10px;padding:10px;align-items:flex-start}' +
  '.abha-card .details{flex:1;min-width:0}' +
  '.abha-card .name{font-weight:600;font-size:14px;margin-bottom:2px;word-break:break-word}' +
  '.abha-card .number{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;' +
  'font-size:13px;letter-spacing:.5px;margin-bottom:6px}' +
  '.abha-card .row{font-size:10px;color:#475569;display:flex;justify-content:space-between;gap:8px;' +
  'padding:1px 0}' +
  '.abha-card .row b{color:#0f172a;font-weight:600;text-align:right;word-break:break-all}' +
  '.abha-card .qr{width:84px;height:84px;object-fit:contain;border:1px solid #e2e8f0;' +
  'border-radius:6px;background:#fff;flex:none}' +
  '.abha-card .qr.placeholder{display:flex;align-items:center;justify-content:center;' +
  'font-size:9px;color:#94a3b8;text-align:center;padding:4px}';

const ABHACardPanel: React.FC<ABHACardPanelProps> = ({ sessionId, patientName, profile }) => {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expired, setExpired] = useState(false);

  const handleFetch = async () => {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const res = await abhaService.getCard(sessionId);
      setQrCode(res.qrCode);
      setCard(res.card);
      setFetched(true);
      if (!res.card && res.qrCode) {
        // Not an error. ABDM's rendered card is unavailable to this client ID;
        // the card below is composed from the verified profile and the QR, and
        // carries everything CRT_ABHA_114 asks for.
        setNotice('Card composed from the verified ABHA details.');
      } else if (!res.card && !res.qrCode) {
        setError('ABDM returned neither a card nor a QR code for this ABHA.');
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
    const win = window.open('', '_blank', 'width=640,height=800');
    if (!win) {
      setError('Your browser blocked the print window. Allow pop-ups and try again.');
      return;
    }

    // ABDM's own rendered card wins when it exists; otherwise ours.
    const content = card
      ? `<img class="abdm-card" src="${escapeHtml(card)}" alt="ABHA card">`
      : buildCardHtml(profile, qrCode, patientName);

    win.document.write(
      `<!doctype html><html><head><title>ABHA — ${escapeHtml(patientName)}</title>` +
        '<style>' +
        'body{margin:0;display:flex;align-items:center;justify-content:center;' +
        'min-height:100vh;font-family:system-ui,sans-serif;background:#fff}' +
        '.abdm-card{max-width:100%;height:auto}' +
        CARD_CSS +
        '@media print{body{min-height:auto}}' +
        '</style></head><body>' +
        content +
        // Wait for images to decode before printing, or the dialog can open on
        // a blank page. With no images at all, print on the next tick.
        '<script>const imgs=[...document.images];' +
        'const go=()=>{window.focus();window.print();};' +
        'const pending=imgs.filter(i=>!i.complete);' +
        'if(!pending.length){setTimeout(go,0);}else{let n=pending.length;' +
        'pending.forEach(i=>i.addEventListener("load",()=>{if(!--n)go();}));}<\/script>' +
        '</body></html>',
    );
    win.document.close();
  };

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

      {fetched && (card || qrCode) && (
        <>
          <div className="flex justify-center">
            {card ? (
              <img
                src={card}
                alt="ABHA card"
                className="max-w-full rounded border"
                style={{ maxHeight: 200 }}
              />
            ) : (
              <>
                <style>{CARD_CSS}</style>
                {/*
                  Same markup the print window receives, so what reception
                  approves on screen is exactly what comes out of the printer.
                  Every interpolated value is escaped in buildCardHtml.
                */}
                <div
                  dangerouslySetInnerHTML={{
                    __html: buildCardHtml(profile, qrCode, patientName),
                  }}
                />
              </>
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

      {notice && !error && <p className="text-xs text-gray-500">{notice}</p>}

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
