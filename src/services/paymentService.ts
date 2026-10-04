import { supabase } from '../lib/supabase';
import {
  PaymentRecord,
  DailyPaymentSummary,
  CollectorCollectionRow,
  EnhancedDailyReport,
  Profile,
  PaymentRecordType
} from '../types';
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
  recordType: dbPayment.record_type,
  refundRequestId: dbPayment.refund_request_id,
  reason: dbPayment.reason,
  approvedBy: dbPayment.approved_by,
  createdAt: new Date(dbPayment.created_at)
});


/**
 * Local-midnight bounds for a calendar day, as [start, next midnight).
 * payment_date is a timestamptz: bounding it with UTC day edges pushes every
 * receipt taken before 05:30 IST onto the previous day's report and drops the
 * first five and a half hours of the day from this one.
 */
const localDayBounds = (date: Date): { fromISO: string; toISO: string } => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { fromISO: start.toISOString(), toISO: end.toISOString() };
};

/** Refunds are money leaving the counter, so they carry a negative sign. */
const signedAmount = (row: { amount: number | string; record_type?: PaymentRecordType }): number =>
  row.record_type === 'refund' ? -(Number(row.amount) || 0) : (Number(row.amount) || 0);

/**
 * PostgREST returns an embedded to-one relation as an object, but as an array
 * when it cannot prove the relationship is to-one. Accept either.
 */
const profileName = (embedded: any): string => {
  const profile = Array.isArray(embedded) ? embedded[0] : embedded;
  return profile?.name || 'Unassigned';
};

/** Fold raw payment_records rows into a day's summary. */
const summariseCollections = (date: Date, rows: any[]): DailyPaymentSummary => {
  const byMethod = new Map<string, { amount: number; count: number }>();
  const byCollector = new Map<string, CollectorCollectionRow>();

  let gross = 0;
  let refunds = 0;
  let transactionCount = 0;
  let refundCount = 0;

  for (const row of rows) {
    const isRefund = row.record_type === 'refund';
    const amount = signedAmount(row);
    const method = String(row.payment_method || 'unknown');

    if (isRefund) {
      refunds += amount;
      refundCount += 1;
    } else {
      gross += amount;
      transactionCount += 1;
    }

    const methodRow = byMethod.get(method) || { amount: 0, count: 0 };
    methodRow.amount += amount;
    methodRow.count += 1;
    byMethod.set(method, methodRow);

    const key = row.received_by || 'unassigned';
    const collector = byCollector.get(key) || {
      userId: row.received_by || null,
      userName: profileName(row.profiles),
      gross: 0,
      refunds: 0,
      net: 0,
      count: 0,
      byMethod: {} as { [method: string]: number }
    };
    if (isRefund) {
      collector.refunds += amount;
    } else {
      collector.gross += amount;
    }
    collector.net += amount;
    collector.count += 1;
    collector.byMethod[method] = (collector.byMethod[method] || 0) + amount;
    byCollector.set(key, collector);
  }

  const amountOf = (method: string): number => byMethod.get(method)?.amount || 0;

  return {
    date,
    cash: amountOf('cash'),
    card: amountOf('card'),
    upi: amountOf('upi'),
    cheque: amountOf('cheque'),
    net_banking: amountOf('net_banking'),
    wallet: amountOf('wallet'),
    gross,
    refunds,
    total: gross + refunds,
    transactionCount,
    refundCount,
    paymentBreakdown: Array.from(byMethod.entries())
      .map(([method, value]) => ({ method, amount: value.amount, count: value.count }))
      .sort((a, b) => b.amount - a.amount),
    collectorBreakdown: Array.from(byCollector.values()).sort((a, b) => b.net - a.net)
  };
};

export const paymentService = {
  // Record a payment
  async recordPayment(
    payment: {
      billId: string;
      amount: number;
      paymentMethod: 'cash' | 'card' | 'upi' | 'cheque' | 'net_banking' | 'wallet';
      cardReference?: string;
      chequeNumber?: string;
      bankName?: string;
      notes?: string;
      paymentDate?: Date;
    },
    options?: {
      recordType?: PaymentRecordType;
      refundRequestId?: string;
      reason?: string;
      approvedBy?: string;
    }
  ): Promise<PaymentRecord> {
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
          clinic_id: profile.clinicId,
          record_type: options?.recordType || 'payment',
          refund_request_id: options?.refundRequestId,
          reason: options?.reason,
          approved_by: options?.approvedBy
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
  /**
   * A day's counter collections: net of refunds, split by method and by who
   * took the money.
   *
   * Reads payment_records directly instead of the get_daily_payment_summary
   * RPC. That helper filters record_type = 'payment', so refunds never reduced
   * the day's figure, and it buckets on DATE(payment_date), which resolves in
   * the server's UTC session rather than clinic-local time.
   */
  async getDailyPaymentSummary(date: Date): Promise<DailyPaymentSummary> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { fromISO, toISO } = localDayBounds(date);

    try {
      const { data: rows, error } = await supabase
        .from('payment_records')
        .select('id, amount, payment_method, record_type, received_by, payment_date, profiles:received_by (id, name)')
        .eq('clinic_id', profile.clinicId)
        .gte('payment_date', fromISO)
        .lt('payment_date', toISO)
        .order('payment_date', { ascending: true });

      if (error) {
        throw new Error(`Failed to fetch daily summary: ${error.message}`);
      }

      return summariseCollections(date, (rows as any[]) || []);
    } catch (error) {
      console.error('Error fetching daily payment summary:', error);
      throw error;
    }
  },

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
        .select('payment_method, amount, payment_date, record_type')
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
      // Refunds are signed negative so the range total is net, matching the
      // daily summaries returned alongside it.
      payments?.forEach((payment: any) => {
        const amount = signedAmount(payment);
        totalAmount += amount;
        if (payment.record_type !== 'refund') {
          totalTransactions++;
        }

        if (Object.prototype.hasOwnProperty.call(methodTotals, payment.payment_method)) {
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
  },

  /**
   * The daily collection report behind the reconciliation screen.
   *
   * Bounded on clinic-local midnights and signed so refunds reduce the day,
   * matching getDailyPaymentSummary above - the two used to disagree because
   * one went through the RPC and the other queried UTC day edges directly.
   */
  async getEnhancedDailyReport(date: Date): Promise<EnhancedDailyReport> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { fromISO, toISO } = localDayBounds(date);

    try {
      const { data: paymentData, error: paymentError } = await supabase
        .from('payment_records')
        .select(`
          *,
          profiles:received_by (id, name),
          bills (
            *,
            bill_items (*)
          )
        `)
        .eq('clinic_id', profile.clinicId)
        .gte('payment_date', fromISO)
        .lt('payment_date', toISO)
        .order('payment_date', { ascending: false });

      if (paymentError) throw paymentError;

      const rows = (paymentData as any[]) || [];

      // Outstanding is a position, not a flow: it is as at now, not for the day.
      const { data: outstandingData, error: outstandingError } = await supabase
        .from('bills')
        .select('balance_amount')
        .eq('clinic_id', profile.clinicId)
        .gt('balance_amount', 0);

      if (outstandingError) throw outstandingError;

      const summary = summariseCollections(date, rows);
      const outstandingBalance = outstandingData?.reduce(
        (sum, bill) => sum + Number(bill.balance_amount), 0
      ) || 0;

      // Average receipt size is a property of collections, so refunds are out
      // of both halves of the ratio.
      const averageTransactionValue =
        summary.transactionCount > 0 ? summary.gross / summary.transactionCount : 0;

      // Percentages run over gross: a net that nets to zero on a heavy refund
      // day would otherwise produce meaningless shares.
      const share = (amount: number): number =>
        summary.gross > 0 ? (amount / summary.gross) * 100 : 0;

      const paymentMethods = summary.paymentBreakdown.map((row) => ({
        method: row.method,
        amount: row.amount,
        count: row.count,
        percentage: share(row.amount)
      }));

      // Category mix of the BILLS collected against today, each bill counted
      // once. Attributing a bill's items to every receipt against it counted
      // an instalment-paid bill twice over.
      const categoryMap = new Map<string, { amount: number; count: number }>();
      const seenBills = new Set<string>();
      for (const payment of rows) {
        const bill = payment.bills;
        if (!bill || seenBills.has(bill.id)) continue;
        seenBills.add(bill.id);

        for (const item of bill.bill_items || []) {
          const category = item.item_type || 'other';
          const amount = Number(item.total_price) || 0;
          const existing = categoryMap.get(category) || { amount: 0, count: 0 };
          existing.amount += amount;
          existing.count += 1;
          categoryMap.set(category, existing);
        }
      }

      const billedTotal = Array.from(categoryMap.values())
        .reduce((sum, value) => sum + value.amount, 0);

      const serviceCategories = Array.from(categoryMap.entries())
        .map(([category, value]) => ({
          category: category as EnhancedDailyReport['serviceCategories'][number]['category'],
          amount: value.amount,
          count: value.count,
          percentage: billedTotal > 0 ? (value.amount / billedTotal) * 100 : 0
        }))
        .sort((a, b) => b.amount - a.amount);

      // getHours() is local, so these buckets already match the local day above.
      const hourlyMap = new Map<number, { amount: number; transactions: number }>();
      for (const payment of rows) {
        const hour = new Date(payment.payment_date).getHours();
        const existing = hourlyMap.get(hour) || { amount: 0, transactions: 0 };
        existing.amount += signedAmount(payment);
        if (payment.record_type !== 'refund') existing.transactions += 1;
        hourlyMap.set(hour, existing);
      }

      const hourlyBreakdown = Array.from({ length: 24 }, (_, hour) => {
        const data = hourlyMap.get(hour) || { amount: 0, transactions: 0 };
        return {
          hour: `${hour.toString().padStart(2, '0')}:00`,
          amount: data.amount,
          transactions: data.transactions
        };
      });

      const peakHours = Array.from(hourlyMap.entries())
        .map(([hour, data]) => ({ hour, amount: data.amount, count: data.transactions }))
        .filter((entry) => entry.amount > 0)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 3);

      return {
        date,
        gross: summary.gross,
        refunds: summary.refunds,
        totalCollection: summary.total,
        transactionCount: summary.transactionCount,
        refundCount: summary.refundCount,
        averageTransactionValue,
        outstandingBalance,
        paymentMethods,
        collectorBreakdown: summary.collectorBreakdown,
        serviceCategories,
        peakHours,
        hourlyBreakdown
      };
    } catch (error) {
      console.error('Error fetching enhanced daily report:', error);
      throw error;
    }
  }
};
