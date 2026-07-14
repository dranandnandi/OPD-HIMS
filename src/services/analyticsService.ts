import { supabase } from '../lib/supabase';
import { AnalyticsRangeKey, AnalyticsSummary } from '../types';
import { getCurrentProfile } from './profileService';

type SupabaseRpcClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

type JsonRecord = Record<string, unknown>;

const rangeOptions: Record<AnalyticsRangeKey, { label: string; days: number; bucket: 'day' | 'month' }> = {
  '30d': { label: 'Last 30 Days', days: 30, bucket: 'day' },
  '3m': { label: 'Last 3 Months', days: 90, bucket: 'day' },
  '6m': { label: 'Last 6 Months', days: 180, bucket: 'month' },
  '1y': { label: 'Last Year', days: 365, bucket: 'month' }
};

const toDateOnly = (date: Date): string => date.toISOString().slice(0, 10);

const startOfLocalDay = (date: Date): Date => {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
};

const getDateRange = (rangeKey: AnalyticsRangeKey) => {
  const option = rangeOptions[rangeKey];
  const endDate = startOfLocalDay(new Date());
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - option.days + 1);

  return {
    startDate: toDateOnly(startDate),
    endDate: toDateOnly(endDate),
    bucket: option.bucket
  };
};

const numberValue = (value: unknown): number => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const objectValue = (value: unknown): JsonRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};

const arrayValue = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.map(objectValue) : [];

const normalizeCountList = (rows: unknown): { name: string; count: number }[] =>
  arrayValue(rows).map((row) => ({
    name: String(row.name || 'Unknown'),
    count: numberValue(row.count)
  }));

const normalizeAnalyticsSummary = (payload: unknown): AnalyticsSummary => {
  const root = objectValue(payload);
  const range = objectValue(root.range);
  const metrics = objectValue(root.metrics);

  return {
    range: {
      startDate: String(range.startDate || ''),
      endDate: String(range.endDate || ''),
      previousStartDate: String(range.previousStartDate || ''),
      previousEndDate: String(range.previousEndDate || ''),
      bucket: range.bucket === 'month' ? 'month' : 'day',
      timezone: String(range.timezone || 'Asia/Kolkata')
    },
    metrics: {
      totalPatients: numberValue(metrics.totalPatients),
      newPatients: numberValue(metrics.newPatients),
      previousNewPatients: numberValue(metrics.previousNewPatients),
      todayVisits: numberValue(metrics.todayVisits),
      totalVisits: numberValue(metrics.totalVisits),
      previousTotalVisits: numberValue(metrics.previousTotalVisits),
      avgDailyVisits: numberValue(metrics.avgDailyVisits),
      followupsDue: numberValue(metrics.followupsDue),
      netRevenue: numberValue(metrics.netRevenue),
      previousNetRevenue: numberValue(metrics.previousNetRevenue),
      todayRevenue: numberValue(metrics.todayRevenue),
      paymentCount: numberValue(metrics.paymentCount),
      outstandingBalance: numberValue(metrics.outstandingBalance),
      avgConsultationFee: numberValue(metrics.avgConsultationFee)
    },
    visitTrend: arrayValue(root.visitTrend).map((row) => ({
      period: String(row.period),
      visits: numberValue(row.visits)
    })),
    revenueTrend: arrayValue(root.revenueTrend).map((row) => ({
      period: String(row.period),
      revenue: numberValue(row.revenue)
    })),
    topDiagnoses: normalizeCountList(root.topDiagnoses),
    topMedicines: normalizeCountList(root.topMedicines),
    appointmentStatuses: arrayValue(root.appointmentStatuses).map((row) => ({
      status: String(row.status || 'Unknown'),
      count: numberValue(row.count)
    })),
    paymentMethods: arrayValue(root.paymentMethods).map((row) => ({
      method: String(row.method || 'unknown'),
      amount: numberValue(row.amount),
      count: numberValue(row.count)
    })),
    serviceCategories: arrayValue(root.serviceCategories).map((row) => ({
      category: String(row.category || 'other'),
      amount: numberValue(row.amount),
      count: numberValue(row.count)
    })),
    peakVisitHours: arrayValue(root.peakVisitHours).map((row) => ({
      hour: numberValue(row.hour),
      count: numberValue(row.count)
    }))
  };
};

export const analyticsService = {
  rangeOptions,

  async getAnalyticsSummary(rangeKey: AnalyticsRangeKey): Promise<AnalyticsSummary> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const range = getDateRange(rangeKey);
    const rpcClient = supabase as unknown as SupabaseRpcClient;
    const { data, error } = await rpcClient.rpc('get_clinic_analytics_summary', {
      p_clinic_id: profile.clinicId,
      p_start_date: range.startDate,
      p_end_date: range.endDate,
      p_bucket: range.bucket
    });

    if (error) {
      throw new Error(`Failed to load analytics: ${error.message}`);
    }

    return normalizeAnalyticsSummary(data);
  }
};
