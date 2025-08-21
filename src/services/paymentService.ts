import { supabase } from '../lib/supabase';
import { PaymentRecord, DailyPaymentSummary, Profile } from '../types';
import { getCurrentProfile } from './profileService';
import type { DatabasePaymentRecord } from '../lib/supabaseClient';

// Convert database payment record to app payment record type
const convertDatabasePaymentRecord = (dbPayment: DatabasePaymentRecord, receivedByProfile?: Profile): PaymentRecord => ({
  id: dbPayment.id,
  billId: dbPayment.bill_id,
  paymentDate: new Date(dbPayment.payment_date),
  paymentMethod: dbPayment.payment_method,
  amount: dbPayment.amount,
  cardReference: dbPayment.card_reference,
  chequeNumber: dbPayment.cheque_number,
  bankName: dbPayment.bank_name,
  notes: dbPayment.notes,
  receivedBy: dbPayment.received_by,
  receivedByProfile,
  createdAt: new Date(dbPayment.created_at)
});

export const paymentService = {
  // Record a payment
  async recordPayment(payment: {
    billId: string;
    amount: number;
    paymentMethod: 'cash' | 'card' | 'upi' | 'cheque' | 'net_banking' | 'wallet';
    cardReference?: string;
    chequeNumber?: string;
    bankName?: string;
    notes?: string;
    paymentDate?: Date;
  }): Promise<PaymentRecord> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { data: paymentRecord, error } = await supabase
        .from('payment_records')
        .insert({
          bill_id: payment.billId,
          amount: payment.amount,
          payment_method: payment.paymentMethod,
          payment_date: payment.paymentDate?.toISOString() || new Date().toISOString(),
          card_reference: payment.cardReference,
          cheque_number: payment.chequeNumber,
          bank_name: payment.bankName,
          notes: payment.notes,
          received_by: profile.id,
          clinic_id: profile.clinicId
        })
        .select(`
          *,
          profiles:received_by (*)
        `)
        .single();

      if (error) {
        throw new Error(`Failed to record payment: ${error.message}`);
      }

      return convertDatabasePaymentRecord(paymentRecord, paymentRecord.profiles);
    } catch (error) {
      console.error('Error recording payment:', error);
      throw error;
    }
  },

  // Get payment records for a bill
  async getBillPayments(billId: string): Promise<PaymentRecord[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { data: payments, error } = await supabase
        .from('payment_records')
        .select(`
          *,
          profiles:received_by (*)
        `)
        .eq('bill_id', billId)
        .eq('clinic_id', profile.clinicId)
        .order('payment_date', { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch payments: ${error.message}`);
      }

      return payments?.map((payment: any) => convertDatabasePaymentRecord(payment, payment.profiles)) || [];
    } catch (error) {
      console.error('Error fetching bill payments:', error);
      throw error;
    }
  },

  // Delete a payment record
  async deletePayment(paymentId: string): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { error } = await supabase
        .from('payment_records')
        .delete()
        .eq('id', paymentId)
        .eq('clinic_id', profile.clinicId);

      if (error) {
        throw new Error(`Failed to delete payment: ${error.message}`);
      }
    } catch (error) {
      console.error('Error deleting payment:', error);
      throw error;
    }
  },

  // Update a payment record
  async updatePayment(paymentId: string, updates: {
    amount?: number;
    paymentMethod?: 'cash' | 'card' | 'upi' | 'cheque' | 'net_banking' | 'wallet';
    cardReference?: string;
    chequeNumber?: string;
    bankName?: string;
    notes?: string;
    paymentDate?: Date;
  }): Promise<PaymentRecord> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const updateData: any = {};
      if (updates.amount !== undefined) updateData.amount = updates.amount;
      if (updates.paymentMethod !== undefined) updateData.payment_method = updates.paymentMethod;
      if (updates.cardReference !== undefined) updateData.card_reference = updates.cardReference;
      if (updates.chequeNumber !== undefined) updateData.cheque_number = updates.chequeNumber;
      if (updates.bankName !== undefined) updateData.bank_name = updates.bankName;
      if (updates.notes !== undefined) updateData.notes = updates.notes;
      if (updates.paymentDate !== undefined) updateData.payment_date = updates.paymentDate.toISOString();

      const { data: paymentRecord, error } = await supabase
        .from('payment_records')
        .update(updateData)
        .eq('id', paymentId)
        .eq('clinic_id', profile.clinicId)
        .select(`
          *,
          profiles:received_by (*)
        `)
        .single();

      if (error) {
        throw new Error(`Failed to update payment: ${error.message}`);
      }

      return convertDatabasePaymentRecord(paymentRecord, paymentRecord.profiles);
    } catch (error) {
      console.error('Error updating payment:', error);
      throw error;
    }
  },

  // Get daily payment summary
  async getDailyPaymentSummary(date: Date): Promise<DailyPaymentSummary> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      // Use the database function for aggregated data
      const { data: summaryData, error } = await supabase
        .rpc('get_daily_payment_summary', {
          p_clinic_id: profile.clinicId,
          p_date: date.toISOString().split('T')[0] // Convert to YYYY-MM-DD format
        });

      if (error) {
        throw new Error(`Failed to fetch daily summary: ${error.message}`);
      }

      // Initialize summary with all payment methods
      const summary: DailyPaymentSummary = {
        date,
        cash: 0,
        card: 0,
        upi: 0,
        cheque: 0,
        net_banking: 0,
        wallet: 0,
        total: 0,
        transactionCount: 0,
        paymentBreakdown: []
      };

      // Process the aggregated data
      if (summaryData) {
        summaryData.forEach((row: any) => {
          const method = row.payment_method as keyof DailyPaymentSummary;
          const amount = Number(row.total_amount);
          const count = Number(row.transaction_count);

          // Update method-specific amount
          if (method in summary && typeof summary[method] === 'number') {
            (summary as any)[method] = amount;
          }

          // Update totals
          summary.total += amount;
          summary.transactionCount += count;

          // Add to breakdown
          summary.paymentBreakdown.push({
            method: row.payment_method,
            amount,
            count
          });
        });
      }

      return summary;
    } catch (error) {
      console.error('Error fetching daily payment summary:', error);
      throw error;
    }
  },

  // Get payment summary for a date range
  async getPaymentSummaryRange(startDate: Date, endDate: Date): Promise<{
    totalAmount: number;
    totalTransactions: number;
    dailySummaries: DailyPaymentSummary[];
    methodTotals: { [key: string]: number };
  }> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const startOfDay = new Date(startDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);

      const { data: payments, error } = await supabase
        .from('payment_records')
        .select('payment_method, amount, payment_date')
        .gte('payment_date', startOfDay.toISOString())
        .lte('payment_date', endOfDay.toISOString())
        .eq('clinic_id', profile.clinicId);

      if (error) {
        throw new Error(`Failed to fetch payment range: ${error.message}`);
      }

      const methodTotals: { [key: string]: number } = {
        cash: 0,
        card: 0,
        upi: 0,
        cheque: 0,
        net_banking: 0,
        wallet: 0
      };

      let totalAmount = 0;
      let totalTransactions = 0;

      // Aggregate payments by method
      payments?.forEach((payment: any) => {
        const amount = Number(payment.amount);
        totalAmount += amount;
        totalTransactions++;
        
        if (methodTotals.hasOwnProperty(payment.payment_method)) {
          methodTotals[payment.payment_method] += amount;
        }
      });

      // Get daily summaries for each date in range
      const dailySummaries: DailyPaymentSummary[] = [];
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const dailySummary = await this.getDailyPaymentSummary(new Date(currentDate));
        dailySummaries.push(dailySummary);
        currentDate.setDate(currentDate.getDate() + 1);
      }

      return {
        totalAmount,
        totalTransactions,
        dailySummaries,
        methodTotals
      };
    } catch (error) {
      console.error('Error fetching payment summary range:', error);
      throw error;
    }
  }
};
