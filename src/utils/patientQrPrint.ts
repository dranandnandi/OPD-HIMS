import QRCode from 'qrcode';
import { Patient } from '../types';

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatPatientNumber = (patient: Patient) => patient.patientNumber || patient.patient_number || '';

const formatAgeGender = (patient: Patient) => {
  const parts = [];
  if (patient.age !== null && patient.age !== undefined) {
    parts.push(`${patient.age} yrs`);
  }
  if (patient.gender) {
    parts.push(patient.gender);
  }
  return parts.join(' / ');
};

export const printPatientQr = async (patient: Patient, clinicName?: string) => {
  const qrDataUrl = await QRCode.toDataURL(patient.id, {
    width: 260,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#111827',
      light: '#ffffff'
    }
  });

  const patientNumber = formatPatientNumber(patient);
  const ageGender = formatAgeGender(patient);

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Patient QR - ${escapeHtml(patientNumber || patient.name)}</title>
    <style>
      @page {
        size: 80mm 120mm;
        margin: 6mm;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: #111827;
        font-family: Arial, Helvetica, sans-serif;
        background: #ffffff;
      }

      .sheet {
        width: 100%;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .card {
        width: 68mm;
        border: 1px solid #111827;
        padding: 5mm;
      }

      .clinic {
        font-size: 11px;
        font-weight: 700;
        text-align: center;
        text-transform: uppercase;
        margin-bottom: 3mm;
      }

      .qr {
        display: block;
        width: 42mm;
        height: 42mm;
        margin: 0 auto 4mm;
      }

      .name {
        font-size: 16px;
        font-weight: 700;
        text-align: center;
        margin-bottom: 2mm;
        line-height: 1.2;
      }

      .row {
        display: flex;
        justify-content: space-between;
        gap: 4mm;
        border-top: 1px solid #d1d5db;
        padding-top: 2mm;
        margin-top: 2mm;
        font-size: 11px;
      }

      .label {
        color: #6b7280;
        font-weight: 700;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .value {
        color: #111827;
        font-weight: 700;
        text-align: right;
        word-break: break-word;
      }

      .footer {
        margin-top: 4mm;
        text-align: center;
        font-size: 9px;
        color: #6b7280;
      }

      @media screen {
        body {
          background: #f3f4f6;
        }

        .sheet {
          padding: 24px;
        }

        .card {
          background: #ffffff;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
        }
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <section class="card">
        ${clinicName ? `<div class="clinic">${escapeHtml(clinicName)}</div>` : ''}
        <img class="qr" src="${qrDataUrl}" alt="Patient QR" />
        <div class="name">${escapeHtml(patient.name)}</div>
        ${patientNumber ? `
        <div class="row">
          <span class="label">Patient No</span>
          <span class="value">${escapeHtml(patientNumber)}</span>
        </div>` : ''}
        <div class="row">
          <span class="label">Patient ID</span>
          <span class="value">${escapeHtml(patient.id)}</span>
        </div>
        ${ageGender ? `
        <div class="row">
          <span class="label">Details</span>
          <span class="value">${escapeHtml(ageGender)}</span>
        </div>` : ''}
        ${patient.phone ? `
        <div class="row">
          <span class="label">Phone</span>
          <span class="value">${escapeHtml(patient.phone)}</span>
        </div>` : ''}
        <div class="footer">Scan QR to identify patient record</div>
      </section>
    </main>
  </body>
</html>`;

  // Print via a hidden iframe instead of window.open — popup blockers
  // reject windows opened after an async gap (the QR generation await).
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const removeIframe = () => {
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve();
      const doc = iframe.contentDocument;
      if (!doc) {
        reject(new Error('Unable to prepare the patient QR for printing.'));
        return;
      }
      doc.open();
      doc.write(html);
      doc.close();
    });

    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      throw new Error('Unable to prepare the patient QR for printing.');
    }

    // Remove the iframe once the print dialog closes; keep a fallback
    // timeout for browsers that never fire afterprint.
    frameWindow.addEventListener('afterprint', () => setTimeout(removeIframe, 100));
    setTimeout(removeIframe, 60000);

    frameWindow.focus();
    frameWindow.print();
  } catch (error) {
    removeIframe();
    throw error;
  }
};
