import React, { useState, useEffect } from 'react';
import { Calendar, IndianRupee, CreditCard, Smartphone, FileText, Building, Wallet, TrendingUp, Clock, Users, BarChart3, PieChart } from 'lucide-react';
import { paymentService } from '../../services/paymentService';
import { DailyPaymentSummary } from '../../types';

const DailyReconciliation: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [summary, setSummary] = useState<DailyPaymentSummary | null>(null);
  const [enhancedReport, setEnhancedReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load daily summary when date changes
  useEffect(() => {
    loadDailySummary();
    loadEnhancedReport();
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

  const loadEnhancedReport = async () => {
    try {
      const enhanced = await paymentService.getEnhancedDailyReport(selectedDate);
      setEnhancedReport(enhanced);
    } catch (err) {
      console.error('Error loading enhanced report:', err);
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
        return <IndianRupee className="w-6 h-6" />;
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
        return <IndianRupee className="w-6 h-6" />;
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

            {/* Enhanced Analytics - Service Categories */}
            {enhancedReport && enhancedReport.serviceCategories && enhancedReport.serviceCategories.length > 0 && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <PieChart className="w-5 h-5 text-blue-600" />
                  <h3 className="text-lg font-semibold text-gray-900">Revenue by Service Category</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {enhancedReport.serviceCategories.map((category: any, index: number) => {
                    const colors = [
                      'bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500'
                    ];
                    const lightColors = [
                      'bg-emerald-50 text-emerald-700', 'bg-blue-50 text-blue-700', 
                      'bg-purple-50 text-purple-700', 'bg-orange-50 text-orange-700', 'bg-pink-50 text-pink-700'
                    ];
                    return (
                      <div key={category.category} className={`${lightColors[index % lightColors.length]} rounded-lg p-4`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium capitalize">{category.category}</span>
                          <div className={`w-3 h-3 rounded-full ${colors[index % colors.length]}`}></div>
                        </div>
                        <div className="text-lg font-bold">{formatCurrency(category.amount)}</div>
                        <div className="text-xs opacity-75">{category.count} items • {category.percentage.toFixed(1)}%</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Enhanced Analytics - Summary Cards */}
            {enhancedReport && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-gradient-to-r from-green-500 to-green-600 rounded-xl p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-green-100 text-sm font-medium">Average Transaction</p>
                      <p className="text-2xl font-bold">{formatCurrency(enhancedReport.averageTransactionValue)}</p>
                    </div>
                    <BarChart3 className="w-8 h-8 text-green-200" />
                  </div>
                </div>
                
                <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-orange-100 text-sm font-medium">Outstanding Balance</p>
                      <p className="text-2xl font-bold">{formatCurrency(enhancedReport.outstandingBalance)}</p>
                    </div>
                    <Users className="w-8 h-8 text-orange-200" />
                  </div>
                </div>

                <div className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-purple-100 text-sm font-medium">Peak Collection Hour</p>
                      <p className="text-2xl font-bold">
                        {enhancedReport.peakHours && enhancedReport.peakHours.length > 0 
                          ? `${enhancedReport.peakHours[0].hour}:00` 
                          : 'N/A'}
                      </p>
                      <p className="text-purple-100 text-sm">
                        {enhancedReport.peakHours && enhancedReport.peakHours.length > 0 
                          ? formatCurrency(enhancedReport.peakHours[0].amount)
                          : ''}
                      </p>
                    </div>
                    <Clock className="w-8 h-8 text-purple-200" />
                  </div>
                </div>
              </div>
            )}

            {/* Hourly Collection Chart */}
            {enhancedReport && enhancedReport.hourlyBreakdown && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-5 h-5 text-blue-600" />
                  <h3 className="text-lg font-semibold text-gray-900">Hourly Collection Pattern</h3>
                </div>
                <div className="flex items-end justify-between h-32 gap-1">
                  {enhancedReport.hourlyBreakdown.map((hour: any, index: number) => {
                    const maxAmount = Math.max(...enhancedReport.hourlyBreakdown.map((h: any) => h.amount));
                    const height = maxAmount > 0 ? (hour.amount / maxAmount) * 100 : 0;
                    
                    return (
                      <div key={index} className="flex flex-col items-center group relative">
                        <div 
                          className="w-3 bg-blue-500 rounded-t hover:bg-blue-600 transition-colors cursor-pointer"
                          style={{ height: `${height}%`, minHeight: hour.amount > 0 ? '2px' : '0px' }}
                        />
                        <span className="text-xs text-gray-500 mt-1 transform -rotate-45 origin-center">
                          {hour.hour}
                        </span>
                        
                        {/* Tooltip */}
                        <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
                          {hour.hour}: {formatCurrency(hour.amount)} ({hour.transactions} tx)
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* No Data Message */}
            {summary.total === 0 && (
              <div className="text-center py-12">
                <IndianRupee className="w-12 h-12 text-gray-400 mx-auto mb-4" />
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
