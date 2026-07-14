import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BarChart3,
  Calendar,
  CreditCard,
  FileText,
  Loader2,
  Pill,
  RefreshCw,
  TrendingUp,
  Users
} from 'lucide-react';
import { analyticsService } from '../../services/analyticsService';
import { AnalyticsRangeKey, AnalyticsSummary } from '../../types';

const rangeLabels: Record<AnalyticsRangeKey, string> = {
  '30d': 'Last 30 Days',
  '3m': 'Last 3 Months',
  '6m': 'Last 6 Months',
  '1y': 'Last Year'
};

const colorClasses = [
  'bg-blue-600',
  'bg-green-600',
  'bg-yellow-500',
  'bg-purple-600',
  'bg-pink-600'
];

const formatNumber = (value: number): string => Math.round(value).toLocaleString('en-IN');

const formatCurrency = (value: number): string =>
  `Rs ${Math.round(value).toLocaleString('en-IN')}`;

const formatPercentChange = (current: number, previous: number): string => {
  if (previous === 0 && current === 0) return 'No change vs previous period';
  if (previous === 0) return 'New activity vs previous period';

  const change = ((current - previous) / Math.abs(previous)) * 100;
  const prefix = change > 0 ? '+' : '';
  return `${prefix}${change.toFixed(1)}% vs previous period`;
};

const formatPeriodLabel = (period: string, bucket: 'day' | 'month'): string => {
  const date = new Date(`${period}T00:00:00`);
  if (Number.isNaN(date.getTime())) return period;

  return new Intl.DateTimeFormat('en-IN', {
    month: 'short',
    ...(bucket === 'day' ? { day: 'numeric' } : {})
  }).format(date);
};

const formatHour = (hour: number): string => {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    hour12: true
  }).format(date);
};

const formatLabel = (value: string): string =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  color: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, detail, icon, color }) => (
  <div className="bg-white p-6 rounded-lg shadow-md">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-gray-600">{label}</p>
        <p className={`text-3xl font-bold ${color}`}>{value}</p>
        <p className="text-sm text-gray-500 mt-1">{detail}</p>
      </div>
      <div className={color}>{icon}</div>
    </div>
  </div>
);

interface CountBarListProps {
  title: string;
  icon: React.ReactNode;
  rows: { name: string; count: number }[];
  emptyText: string;
}

const CountBarList: React.FC<CountBarListProps> = ({ title, icon, rows, emptyText }) => {
  const maxCount = Math.max(...rows.map((row) => row.count), 0);

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
        {icon}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.name} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full ${colorClasses[index % colorClasses.length]}`} />
                <span className="text-sm text-gray-600 truncate">{row.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-20 bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${colorClasses[index % colorClasses.length]}`}
                    style={{ width: `${maxCount > 0 ? (row.count / maxCount) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-gray-800 min-w-[2rem] text-right">
                  {formatNumber(row.count)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface AmountBarListProps {
  title: string;
  icon: React.ReactNode;
  rows: { label: string; amount: number; count?: number }[];
  emptyText: string;
}

const AmountBarList: React.FC<AmountBarListProps> = ({ title, icon, rows, emptyText }) => {
  const maxAmount = Math.max(...rows.map((row) => row.amount), 0);

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
        {icon}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.label} className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-600 truncate">{row.label}</span>
                <span className="text-sm font-medium text-gray-800 shrink-0">
                  {formatCurrency(row.amount)}
                </span>
              </div>
              <div className="bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${colorClasses[index % colorClasses.length]}`}
                  style={{ width: `${maxAmount > 0 ? (row.amount / maxAmount) * 100 : 0}%` }}
                />
              </div>
              {row.count !== undefined && (
                <p className="text-xs text-gray-500">{formatNumber(row.count)} entries</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Analytics: React.FC = () => {
  const [rangeKey, setRangeKey] = useState<AnalyticsRangeKey>('30d');
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const summary = await analyticsService.getAnalyticsSummary(rangeKey);
      setAnalytics(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [rangeKey]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const chartMaxVisits = useMemo(
    () => Math.max(...(analytics?.visitTrend || []).map((row) => row.visits), 0),
    [analytics]
  );

  const peakHourText = analytics?.peakVisitHours.length
    ? analytics.peakVisitHours.map((row) => formatHour(row.hour)).join(', ')
    : 'No visit hours yet';

  const paymentMethodRows = (analytics?.paymentMethods || []).map((row) => ({
    label: formatLabel(row.method),
    amount: row.amount,
    count: row.count
  }));

  const serviceCategoryRows = (analytics?.serviceCategories || []).map((row) => ({
    label: formatLabel(row.category),
    amount: row.amount,
    count: row.count
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Analytics Dashboard</h2>
          {analytics && (
            <p className="text-sm text-gray-500">
              {analytics.range.startDate} to {analytics.range.endDate} ({analytics.range.timezone})
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={rangeKey}
            onChange={(event) => setRangeKey(event.target.value as AnalyticsRangeKey)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {(Object.keys(rangeLabels) as AnalyticsRangeKey[]).map((key) => (
              <option key={key} value={key}>
                {rangeLabels[key]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={loadAnalytics}
            disabled={loading}
            className="p-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-60"
            title="Refresh analytics"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="bg-white p-8 rounded-lg shadow-md flex items-center justify-center gap-3 text-gray-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading analytics...</span>
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-50 border border-red-200 p-4 rounded-lg flex items-start gap-3 text-red-700">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Analytics could not be loaded</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {analytics && !loading && !error && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <MetricCard
              label="Total Patients"
              value={formatNumber(analytics.metrics.totalPatients)}
              detail={`${formatNumber(analytics.metrics.newPatients)} new in this period`}
              icon={<Users className="w-12 h-12" />}
              color="text-blue-600"
            />
            <MetricCard
              label="Today's Visits"
              value={formatNumber(analytics.metrics.todayVisits)}
              detail={`${formatNumber(analytics.metrics.totalVisits)} visits in selected range`}
              icon={<Calendar className="w-12 h-12" />}
              color="text-green-600"
            />
            <MetricCard
              label="Avg. Daily Visits"
              value={analytics.metrics.avgDailyVisits.toFixed(1)}
              detail={formatPercentChange(analytics.metrics.totalVisits, analytics.metrics.previousTotalVisits)}
              icon={<TrendingUp className="w-12 h-12" />}
              color="text-orange-600"
            />
            <MetricCard
              label="Net Collection"
              value={formatCurrency(analytics.metrics.netRevenue)}
              detail={formatPercentChange(analytics.metrics.netRevenue, analytics.metrics.previousNetRevenue)}
              icon={<CreditCard className="w-12 h-12" />}
              color="text-purple-600"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-lg shadow-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">
                  {analytics.range.bucket === 'month' ? 'Monthly Visits' : 'Visit Trend'}
                </h3>
                <BarChart3 className="w-5 h-5 text-gray-400" />
              </div>
              {analytics.visitTrend.length === 0 ? (
                <p className="text-sm text-gray-500">No visits found for this range.</p>
              ) : (
                <div className="space-y-3">
                  {analytics.visitTrend.map((row) => (
                    <div key={row.period} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600 w-16">
                        {formatPeriodLabel(row.period, analytics.range.bucket)}
                      </span>
                      <div className="flex items-center gap-2 flex-1 ml-4">
                        <div className="flex-1 bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full"
                            style={{ width: `${chartMaxVisits > 0 ? (row.visits / chartMaxVisits) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium text-gray-800 min-w-[2rem] text-right">
                          {formatNumber(row.visits)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <CountBarList
              title="Top Diagnoses"
              icon={<Activity className="w-5 h-5 text-gray-400" />}
              rows={analytics.topDiagnoses}
              emptyText="No diagnoses recorded in this range."
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CountBarList
              title="Most Prescribed Medicines"
              icon={<Pill className="w-5 h-5 text-gray-400" />}
              rows={analytics.topMedicines}
              emptyText="No prescriptions recorded in this range."
            />

            <AmountBarList
              title="Payment Methods"
              icon={<CreditCard className="w-5 h-5 text-gray-400" />}
              rows={paymentMethodRows}
              emptyText="No payments recorded in this range."
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AmountBarList
              title="Service Categories"
              icon={<FileText className="w-5 h-5 text-gray-400" />}
              rows={serviceCategoryRows}
              emptyText="No bill items recorded in this range."
            />

            <div className="bg-white p-6 rounded-lg shadow-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Operational Snapshot</h3>
                <TrendingUp className="w-5 h-5 text-gray-400" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-gray-600">Today's Collection</p>
                  <p className="text-2xl font-bold text-blue-600">{formatCurrency(analytics.metrics.todayRevenue)}</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <p className="text-sm text-gray-600">Outstanding Balance</p>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(analytics.metrics.outstandingBalance)}</p>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg">
                  <p className="text-sm text-gray-600">Avg. Consultation Fee</p>
                  <p className="text-2xl font-bold text-purple-600">{formatCurrency(analytics.metrics.avgConsultationFee)}</p>
                </div>
                <div className="p-4 bg-yellow-50 rounded-lg">
                  <p className="text-sm text-gray-600">Follow-ups Due</p>
                  <p className="text-2xl font-bold text-yellow-700">{formatNumber(analytics.metrics.followupsDue)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Quick Insights</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  <span className="font-medium text-blue-800">New Patients</span>
                </div>
                <p className="text-sm text-gray-600">
                  {formatNumber(analytics.metrics.newPatients)} registrations in {rangeLabels[rangeKey].toLowerCase()}.
                </p>
              </div>
              <div className="p-4 bg-green-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-5 h-5 text-green-600" />
                  <span className="font-medium text-green-800">Peak Hours</span>
                </div>
                <p className="text-sm text-gray-600">{peakHourText}</p>
              </div>
              <div className="p-4 bg-yellow-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-5 h-5 text-yellow-700" />
                  <span className="font-medium text-yellow-800">Visit Growth</span>
                </div>
                <p className="text-sm text-gray-600">
                  {formatPercentChange(analytics.metrics.totalVisits, analytics.metrics.previousTotalVisits)}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Analytics;
