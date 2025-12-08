import { useCallback, useMemo, useState } from 'react';
import { whatsappApi, type WhatsAppStatusResponse } from '../services/whatsappApi';
import type { Bill, Patient } from '../types';
import { formatPhoneForWhatsApp } from '../utils/phoneUtils';

interface UseWhatsAppOptions {
  clinicId?: string;
  labId?: string;
  userId?: string;
}

export const useWhatsApp = ({ clinicId, labId, userId }: UseWhatsAppOptions = {}) => {
  const context = useMemo(
    () => ({ clinicId, labId: labId || clinicId, userId }),
    [clinicId, labId, userId]
  );

  const [status, setStatus] = useState<WhatsAppStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!clinicId && !labId) return;
    try {
      setLoading(true);
      const response = await whatsappApi.getStatus({}, context);
      setStatus(response);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load WhatsApp status');
    } finally {
      setLoading(false);
    }
  }, [clinicId, labId, context]);

  const sendBillMessage = useCallback(
    async (bill: Bill, messageOverride?: string) => {
      if (!bill.patient?.phone) {
        throw new Error('Patient phone number is required to send WhatsApp messages.');
      }

      const message = messageOverride || (() => {
        const lines = [
          `Hi ${bill.patient.name},`,
          `Bill #${bill.billNumber}`,
          `Total Amount: ₹${bill.totalAmount.toLocaleString('en-IN')}`
        ];
        if (bill.balanceAmount > 0) {
          lines.push(`Pending Balance: ₹${bill.balanceAmount.toLocaleString('en-IN')}`);
        }
        return lines.join('\n');
      })();

      await whatsappApi.sendMessage(
        {
          phone: formatPhoneForWhatsApp(bill.patient.phone),
          message,
          metadata: { billId: bill.id }
        },
        context
      );
    },
    [context]
  );

  const sendVisitSummary = useCallback(
    async (patient: Patient, visitSummary: string, fileBase64?: string) => {
      if (!patient.phone) {
        throw new Error('Patient phone number is required.');
      }

      if (fileBase64) {
        await whatsappApi.sendDocument(
          {
            phone: formatPhoneForWhatsApp(patient.phone),
            fileBase64,
            fileName: `${patient.name}-visit-summary.pdf`,
            caption: visitSummary
          },
          context
        );
        return;
      }

      await whatsappApi.sendMessage(
        {
          phone: patient.phone,
          message: visitSummary,
          metadata: { type: 'visit_summary', patientId: patient.id }
        },
        context
      );
    },
    [context]
  );

  return {
    status,
    loading,
    error,
    fetchStatus,
    sendBillMessage,
    sendVisitSummary
  };
};
