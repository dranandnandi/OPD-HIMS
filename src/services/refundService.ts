import { supabase } from '../lib/supabase';
import { RefundRequest, PaymentRecord } from '../types';
import { getCurrentProfile } from './profileService';
import { paymentService } from './paymentService';
import type { DatabaseRefundRequest } from '../lib/supabaseClient';

const convertRefundRequest = (row: DatabaseRefundRequest): RefundRequest => ({
  id: row.id,
  billId: row.bill_id,
  patientId: row.patient_id,
  clinicId: row.clinic_id,
  sourceType: row.source_type,
  totalAmount: Number(row.total_amount),
  refundMethod: row.refund_method || undefined,
  reason: row.reason || undefined,
  status: row.status,
  initiatedBy: row.initiated_by || undefined,
  approvedBy: row.approved_by || undefined,
  approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
  paidAt: row.paid_at ? new Date(row.paid_at) : undefined,
  metadata: row.metadata || undefined,
  inventoryActions: row.inventory_actions || undefined,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at)
});

/** A queue row: the request plus the patient/bill context an approver needs. */
export interface RefundQueueItem extends RefundRequest {
  billNumber: string;
  patientName: string;
  patientPhone: string;
  initiatedByName?: string;
}

export const refundService = {
  /**
   * Every refund request in the clinic, newest first — the approver's worklist.
   *
   * listRefundRequests is scoped to a single bill, so before this existed a
   * pending refund was only visible to someone who already knew which bill to
   * open. Requests could sit unseen indefinitely.
   */
  async listRefundQueue(options?: {
    statuses?: RefundRequest['status'][];
    from?: Date;
    to?: Date;
  }): Promise<RefundQueueItem[]> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) throw new Error('User not assigned to a clinic.');

    let query = supabase
      .from('refund_requests')
      .select('*, bills(bill_number), patients(name, phone), initiator:profiles!refund_requests_initiated_by_fkey(name)')
      .eq('clinic_id', profile.clinicId)
      .order('created_at', { ascending: false });

    if (options?.statuses?.length) {
      query = query.in('status', options.statuses);
    }
    if (options?.from) {
      query = query.gte('created_at', options.from.toISOString());
    }
    if (options?.to) {
      query = query.lte('created_at', options.to.toISOString());
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load refund queue: ${error.message}`);
    }

    return ((data as any[]) || []).map((row) => ({
      ...convertRefundRequest(row),
      billNumber: row.bills?.bill_number || '—',
      patientName: row.patients?.name || 'Unknown patient',
      patientPhone: row.patients?.phone || '',
      initiatedByName: row.initiator?.name || undefined
    }));
  },

  async listRefundRequests(options?: { status?: RefundRequest['status']; billId?: string }): Promise<RefundRequest[]> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) throw new Error('User not assigned to a clinic.');

    let query = supabase
      .from('refund_requests')
      .select('*')
      .eq('clinic_id', profile.clinicId)
      .order('created_at', { ascending: false });

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    if (options?.billId) {
      query = query.eq('bill_id', options.billId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch refund requests: ${error.message}`);
    }

    return (data || []).map(convertRefundRequest);
  },

  async createRefundRequest(payload: {
    billId: string;
    patientId: string;
    sourceType: RefundRequest['sourceType'];
    totalAmount: number;
    refundMethod?: RefundRequest['refundMethod'];
    reason?: string;
    metadata?: Record<string, any>;
  }): Promise<RefundRequest> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) throw new Error('User not assigned to a clinic.');

    // Guard the refundable balance. Without this the same bill can accumulate
    // several pending requests that individually fit but together exceed what
    // was ever paid — e.g. three pending requests totalling more than the bill.
    const { data: bill, error: billError } = await supabase
      .from('bills')
      .select('paid_amount, total_refunded_amount, clinic_id')
      .eq('id', payload.billId)
      .single();

    if (billError || !bill) {
      throw new Error('Bill not found for refund request.');
    }
    const billRow = bill as { paid_amount: number; total_refunded_amount: number; clinic_id: string };
    if (billRow.clinic_id !== profile.clinicId) {
      throw new Error('Not authorized to raise a refund on this bill.');
    }

    const { data: openRequests, error: openError } = await supabase
      .from('refund_requests')
      .select('total_amount')
      .eq('bill_id', payload.billId)
      .in('status', ['draft', 'pending_approval', 'approved']);

    if (openError) {
      throw new Error(`Failed to check existing refund requests: ${openError.message}`);
    }

    const alreadyRefunded = Number(billRow.total_refunded_amount || 0);
    const pendingTotal = ((openRequests as any[]) || []).reduce(
      (sum, row) => sum + Number(row.total_amount || 0),
      0
    );
    const available = Number(billRow.paid_amount || 0) - alreadyRefunded - pendingTotal;

    if (payload.totalAmount > available + 0.01) {
      throw new Error(
        pendingTotal > 0
          ? `Only ₹${available.toFixed(2)} can still be refunded — ₹${pendingTotal.toFixed(2)} is already tied up in open refund requests on this bill.`
          : `Refund amount exceeds the refundable balance of ₹${available.toFixed(2)}.`
      );
    }

    const { data, error } = await supabase
      .from('refund_requests')
      .insert({
        bill_id: payload.billId,
        patient_id: payload.patientId,
        clinic_id: profile.clinicId,
        source_type: payload.sourceType,
        total_amount: payload.totalAmount,
        refund_method: payload.refundMethod,
        reason: payload.reason,
        metadata: payload.metadata,
        initiated_by: profile.id,
        status: 'pending_approval'
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create refund request: ${error.message}`);
    }

    return convertRefundRequest(data);
  },

  async updateRefundRequest(
    id: string,
    updates: Partial<Pick<RefundRequest, 'status' | 'refundMethod' | 'reason' | 'approvedBy'>> & {
      inventoryActions?: Record<string, any>;
      totalAmount?: number;
    }
  ): Promise<RefundRequest> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) throw new Error('User not assigned to a clinic.');

    const { data: existingRequest, error: fetchError } = await supabase
      .from('refund_requests')
      .select('clinic_id')
      .eq('id', id)
      .single();

    if (fetchError || !existingRequest) {
      throw new Error('Refund request not found');
    }

    if (existingRequest.clinic_id !== profile.clinicId) {
      throw new Error('Not authorized to modify this refund request.');
    }

    const updateData: Record<string, any> = {};
    if (updates.status) updateData.status = updates.status;
    if (updates.refundMethod) updateData.refund_method = updates.refundMethod;
    if (updates.reason !== undefined) updateData.reason = updates.reason;
    if (updates.inventoryActions) updateData.inventory_actions = updates.inventoryActions;
    if (updates.totalAmount !== undefined) updateData.total_amount = updates.totalAmount;
    if (updates.approvedBy) {
      updateData.approved_by = updates.approvedBy;
      updateData.approved_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('refund_requests')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to update refund request: ${error.message}`);
    }

    return convertRefundRequest(data);
  },

  async markRefundPaid(
    requestId: string,
    payment: {
      amount: number;
      paymentMethod: PaymentRecord['paymentMethod'];
      paymentDate?: Date;
      notes?: string;
      approvedBy?: string;
    }
  ): Promise<RefundRequest> {
    if (!supabase) throw new Error('Supabase client not initialized');
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) throw new Error('User not assigned to a clinic.');

    const request = await this.getRefundRequestById(requestId);
    if (request.clinicId !== profile.clinicId) {
      throw new Error('Not authorized to modify this refund request.');
    }
    // Approval is the control on paying money out, so it cannot be skipped.
    // This previously also accepted 'pending_approval', which let an approver
    // pay a request straight from the queue without it ever being approved —
    // leaving approved_by/approved_at null on a paid refund.
    if (request.status !== 'approved') {
      throw new Error('This refund must be approved before it can be paid.');
    }

    await paymentService.recordPayment({
      billId: request.billId,
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      paymentDate: payment.paymentDate || new Date(),
      notes: payment.notes
    }, {
      recordType: 'refund',
      refundRequestId: requestId,
      reason: payment.notes,
      approvedBy: payment.approvedBy
    });

    const { data, error } = await supabase
      .from('refund_requests')
      .update({
        status: 'paid',
        paid_at: payment.paymentDate?.toISOString() || new Date().toISOString()
      })
      .eq('id', requestId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to mark refund as paid: ${error.message}`);
    }

    return convertRefundRequest(data);
  },

  async getRefundRequestById(id: string): Promise<RefundRequest> {
    if (!supabase) throw new Error('Supabase client not initialized');

    const { data, error } = await supabase
      .from('refund_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new Error('Refund request not found');
    }

    return convertRefundRequest(data);
  }
};
