import { supabase } from '../lib/supabase';
import { Patient, TestOrdered } from '../types';
import { clinicSettingsService } from './clinicSettingsService';
import { getCurrentProfile } from './profileService';

export interface LimsOrderPayload {
  external_order_id: string;
  patient: {
    external_id: string;
    name: string;
    age?: number;
    gender?: string;
    phone?: string;
  };
  tests: Array<{ name: string }>;
  referring_doctor?: string;
  pdf_callback_url?: string;
}

export interface LimsOrderResponse {
  success: boolean;
  order?: {
    id: string;
    sample_id: string;
    status: string;
  };
  tests?: {
    matched: Array<{
      hims_name: string;
      lims_name: string;
      confidence: number;
    }>;
    unmatched: Array<{
      hims_name: string;
      reason: string;
    }>;
  };
  idempotent?: boolean;
  error?: string;
}

export interface LimsOutboundOrder {
  id: string;
  clinicId: string;
  visitId?: string;
  patientId: string;
  externalOrderId?: string;
  limsSampleId?: string;
  status: 'pending' | 'sent' | 'accepted' | 'completed' | 'failed';
  testsSent: Array<{ name: string }>;
  matchedTests?: Array<{ hims_name: string; lims_name: string; confidence: number }>;
  unmatchedTests?: Array<{ hims_name: string; reason: string }>;
  limsResponse?: LimsOrderResponse;
  pdfUrl?: string;
  pdfReceivedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const convertDbOrder = (data: any): LimsOutboundOrder => ({
  id: data.id,
  clinicId: data.clinic_id,
  visitId: data.visit_id,
  patientId: data.patient_id,
  externalOrderId: data.external_order_id,
  limsSampleId: data.lims_sample_id,
  status: data.status,
  testsSent: data.tests_sent || [],
  matchedTests: data.matched_tests,
  unmatchedTests: data.unmatched_tests,
  limsResponse: data.lims_response,
  pdfUrl: data.pdf_url,
  pdfReceivedAt: data.pdf_received_at ? new Date(data.pdf_received_at) : undefined,
  errorMessage: data.error_message,
  createdAt: new Date(data.created_at),
  updatedAt: new Date(data.updated_at),
});

export const limsService = {
  async sendOrderToLims(
    visitId: string,
    patient: Patient,
    tests: TestOrdered[],
    referringDoctor?: string
  ): Promise<LimsOutboundOrder> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic');
    }

    const settings = await clinicSettingsService.getClinicSettings();
    if (!settings?.labTestIntegrationEnabled) {
      throw new Error('LIMS integration is not enabled');
    }

    if (!settings.limsApiUrl || !settings.limsApiKey) {
      throw new Error('LIMS API URL and Key must be configured in Settings');
    }

    // Check if order already sent for this visit (avoid duplicates on edit)
    const { data: existingOrder } = await supabase
      .from('lims_outbound_orders')
      .select('*')
      .eq('visit_id', visitId)
      .in('status', ['sent', 'accepted', 'completed'])
      .maybeSingle();

    if (existingOrder) {
      console.log('LIMS order already exists for visit:', visitId, existingOrder.lims_sample_id);
      return convertDbOrder(existingOrder);
    }

    // Use visit_id for idempotency - same visit = same order ID
    const externalOrderId = `OPD-${visitId}`;

    const payload: LimsOrderPayload = {
      external_order_id: externalOrderId,
      patient: {
        external_id: patient.id,
        name: patient.name,
        age: patient.age ?? undefined,
        gender: patient.gender,
        phone: patient.phone,
      },
      tests: tests.map(t => ({ name: t.testName })),
      referring_doctor: referringDoctor,
      pdf_callback_url: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lims-receive-result`,
    };

    const { data: orderRecord, error: insertError } = await supabase
      .from('lims_outbound_orders')
      .insert({
        clinic_id: profile.clinicId,
        visit_id: visitId,
        patient_id: patient.id,
        status: 'pending',
        tests_sent: payload.tests,
      })
      .select()
      .single();

    if (insertError || !orderRecord) {
      throw new Error(`Failed to create LIMS order record: ${insertError?.message}`);
    }

    try {
      const response = await fetch(settings.limsApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-lab-api-key': settings.limsApiKey,
        },
        body: JSON.stringify(payload),
      });

      const result: LimsOrderResponse = await response.json();

      if (!response.ok || !result.success) {
        const { error: updateError } = await supabase
          .from('lims_outbound_orders')
          .update({
            status: 'failed',
            error_message: result.error || `HTTP ${response.status}`,
            lims_response: result,
          })
          .eq('id', orderRecord.id);

        if (updateError) {
          console.error('Failed to update order status:', updateError);
        }

        throw new Error(result.error || `LIMS request failed with status ${response.status}`);
      }

      const { data: updatedOrder, error: updateError } = await supabase
        .from('lims_outbound_orders')
        .update({
          status: 'accepted',
          external_order_id: externalOrderId,
          lims_sample_id: result.order?.sample_id,
          matched_tests: result.tests?.matched || [],
          unmatched_tests: result.tests?.unmatched || [],
          lims_response: result,
        })
        .eq('id', orderRecord.id)
        .select()
        .single();

      if (updateError || !updatedOrder) {
        console.error('Failed to update order with LIMS response:', updateError);
        return convertDbOrder(orderRecord);
      }

      return convertDbOrder(updatedOrder);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await supabase
        .from('lims_outbound_orders')
        .update({
          status: 'failed',
          error_message: errorMessage,
        })
        .eq('id', orderRecord.id);

      throw error;
    }
  },

  async getOrdersForVisit(visitId: string): Promise<LimsOutboundOrder[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const { data, error } = await supabase
      .from('lims_outbound_orders')
      .select('*')
      .eq('visit_id', visitId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch LIMS orders: ${error.message}`);
    }

    return (data || []).map(convertDbOrder);
  },

  async getRecentOrders(limit = 50): Promise<LimsOutboundOrder[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic');
    }

    const { data, error } = await supabase
      .from('lims_outbound_orders')
      .select('*')
      .eq('clinic_id', profile.clinicId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch LIMS orders: ${error.message}`);
    }

    return (data || []).map(convertDbOrder);
  },

  async getPendingOrders(): Promise<LimsOutboundOrder[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic');
    }

    const { data, error } = await supabase
      .from('lims_outbound_orders')
      .select('*')
      .eq('clinic_id', profile.clinicId)
      .in('status', ['pending', 'sent', 'accepted'])
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch pending LIMS orders: ${error.message}`);
    }

    return (data || []).map(convertDbOrder);
  },

  async isLimsEnabled(): Promise<boolean> {
    try {
      const settings = await clinicSettingsService.getClinicSettings();
      return !!(settings?.labTestIntegrationEnabled && settings.limsApiUrl && settings.limsApiKey);
    } catch {
      return false;
    }
  },

  async retryFailedOrder(orderId: string): Promise<LimsOutboundOrder> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const { data: order, error } = await supabase
      .from('lims_outbound_orders')
      .select('*, patients(*)')
      .eq('id', orderId)
      .eq('status', 'failed')
      .single();

    if (error || !order) {
      throw new Error('Failed order not found');
    }

    const settings = await clinicSettingsService.getClinicSettings();
    if (!settings?.limsApiUrl || !settings?.limsApiKey) {
      throw new Error('LIMS not configured');
    }

    const patient = order.patients;
    const payload: LimsOrderPayload = {
      external_order_id: `OPD-${order.visit_id}`,
      patient: {
        external_id: order.patient_id,
        name: patient?.name || 'Unknown',
        age: patient?.age ?? undefined,
        gender: patient?.gender,
        phone: patient?.phone,
      },
      tests: order.tests_sent || [],
      pdf_callback_url: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lims-receive-result`,
    };

    try {
      const response = await fetch(settings.limsApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-lab-api-key': settings.limsApiKey,
        },
        body: JSON.stringify(payload),
      });

      const result: LimsOrderResponse = await response.json();

      if (!response.ok || !result.success) {
        await supabase
          .from('lims_outbound_orders')
          .update({
            error_message: result.error || `HTTP ${response.status}`,
            lims_response: result,
          })
          .eq('id', orderId);
        throw new Error(result.error || 'LIMS request failed');
      }

      const { data: updated } = await supabase
        .from('lims_outbound_orders')
        .update({
          status: 'accepted',
          external_order_id: payload.external_order_id,
          lims_sample_id: result.order?.sample_id,
          matched_tests: result.tests?.matched || [],
          unmatched_tests: result.tests?.unmatched || [],
          lims_response: result,
          error_message: null,
        })
        .eq('id', orderId)
        .select()
        .single();

      return convertDbOrder(updated);
    } catch (err) {
      throw err;
    }
  },
};
