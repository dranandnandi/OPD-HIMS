import React, { useState, useEffect } from 'react';
import { Calendar, DollarSign, CreditCard, Smartphone, FileText, Building, Wallet, TrendingUp } from 'lucide-react';
import { paymentService } from '../../services/paymentService';
import { DailyPaymentSummary } from '../../types';

const DailyReconciliation: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [summary, setSummary] = useState<DailyPaymentSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load daily summary when date changes
  useEffect(() => {
    loadDailySummary();
  }, [selectedDate]);

  const loadDailySummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const dailySummary = await paymentService.getDailyPaymentSummary(selectedDate);
      setSummary(dailySummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load daily summary');
      console.error('Error loading daily summary:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  };

  const getPaymentMethodIcon = (method: string) => {
    switch (method) {
      case 'cash':
        return <DollarSign className="w-6 h-6" />;
      case 'card':
        return <CreditCard className="w-6 h-6" />;
      case 'upi':
        return <Smartphone className="w-6 h-6" />;
      case 'cheque':
        return <FileText className="w-6 h-6" />;
      case 'net_banking':
        return <Building className="w-6 h-6" />;
      case 'wallet':
        return <Wallet className="w-6 h-6" />;
      default:
        return <DollarSign className="w-6 h-6" />;
    }
  };

  const getPaymentMethodColor = (method: string): string => {
    switch (method) {
      case 'cash':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'card':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'upi':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'cheque':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'net_banking':
        return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'wallet':
        return 'bg-pink-100 text-pink-800 border-pink-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getMethodDisplayName = (method: string): string => {
    switch (method) {
      case 'cash':
        return 'Cash';
      case 'card':
        return 'Card';
      case 'upi':
        return 'UPI';
      case 'cheque':
        return 'Cheque';
      case 'net_banking':
        return 'Net Banking';
      case 'wallet':
        return 'Wallet';
      default:
        return method;
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-6"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Daily Collection Report</h1>
          <p className="text-gray-600">Track daily payment collections across all payment methods</p>
        </div>

        {/* Date Selection */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Calendar className="w-5 h-5 text-gray-400" />
              <label htmlFor="date" className="text-sm font-medium text-gray-700">
                Select Date:
              </label>
            </div>
            <input
              type="date"
              id="date"
              value={selectedDate.toISOString().split('T')[0]}
              onChange={(e) => setSelectedDate(new Date(e.target.value))}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={() => setSelectedDate(new Date())}
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 focus:outline-none"
            >
              Today
            </button>
          </div>
          <div className="mt-2">
            <p className="text-lg font-semibold text-gray-900">{formatDate(selectedDate)}</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        {summary && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {/* Total Collection */}
              <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-6 text-white col-span-full lg:col-span-1">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-100 text-sm font-medium">Total Collection</p>
                    <p className="text-3xl font-bold">{formatCurrency(summary.total)}</p>
                    <p className="text-blue-100 text-sm mt-1">
                      {summary.transactionCount} transaction{summary.transactionCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="bg-blue-400 bg-opacity-30 rounded-full p-3">
                    <TrendingUp className="w-8 h-8" />
                  </div>
                </div>
              </div>

              {/* Payment Method Breakdown */}
              {summary.paymentBreakdown.map((breakdown) => (
                <div
                  key={breakdown.method}
                  className={`rounded-xl p-6 border-2 ${getPaymentMethodColor(breakdown.method)}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center space-x-2 mb-2">
                        {getPaymentMethodIcon(breakdown.method)}
                        <p className="font-semibold">{getMethodDisplayName(breakdown.method)}</p>
                      </div>
                      <p className="text-2xl font-bold">{formatCurrency(breakdown.amount)}</p>
                      <p className="text-sm opacity-75 mt-1">
                        {breakdown.count} transaction{breakdown.count !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Detailed Breakdown Table */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Payment Method Breakdown</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Payment Method
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Transactions
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Percentage
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {summary.paymentBreakdown.map((breakdown) => {
                      const percentage = summary.total > 0 ? (breakdown.amount / summary.total) * 100 : 0;
                      return (
                        <tr key={breakdown.method} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className={`p-2 rounded-full ${getPaymentMethodColor(breakdown.method)}`}>
                                {getPaymentMethodIcon(breakdown.method)}
                              </div>
                              <div className="ml-3">
                                <div className="text-sm font-medium text-gray-900">
                                  {getMethodDisplayName(breakdown.method)}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-semibold text-gray-900">
                              {formatCurrency(breakdown.amount)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{breakdown.count}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                                <div
                                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                  style={{ width: `${percentage}%` }}
                                ></div>
                              </div>
                              <span className="text-sm text-gray-600">{percentage.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* No Data Message */}
            {summary.total === 0 && (
              <div className="text-center py-12">
                <DollarSign className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Collections Today</h3>
                <p className="text-gray-600">No payments were recorded for {formatDate(selectedDate)}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DailyReconciliation;
