import React from 'react';
import { 
  Users, 
  Calendar, 
  FileText, 
  TrendingUp, 
  Activity,
  Pill,
  BarChart3
} from 'lucide-react';
import { mockAnalytics } from '../../services/mockData';

const Analytics: React.FC = () => {
  const analytics = mockAnalytics;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Analytics Dashboard</h2>
        <select className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
          <option>Last 30 Days</option>
          <option>Last 3 Months</option>
          <option>Last 6 Months</option>
          <option>Last Year</option>
        </select>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Patients</p>
              <p className="text-3xl font-bold text-blue-600">{analytics.totalPatients}</p>
              <p className="text-sm text-green-600 mt-1">+12% from last month</p>
            </div>
            <Users className="w-12 h-12 text-blue-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Today's Visits</p>
              <p className="text-3xl font-bold text-green-600">{analytics.todayVisits}</p>
              <p className="text-sm text-green-600 mt-1">+8% from yesterday</p>
            </div>
            <Calendar className="w-12 h-12 text-green-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Visits</p>
              <p className="text-3xl font-bold text-purple-600">{analytics.totalVisits}</p>
              <p className="text-sm text-green-600 mt-1">+15% from last month</p>
            </div>
            <FileText className="w-12 h-12 text-purple-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Avg. Daily Visits</p>
              <p className="text-3xl font-bold text-orange-600">18</p>
              <p className="text-sm text-green-600 mt-1">+5% from last week</p>
            </div>
            <TrendingUp className="w-12 h-12 text-orange-600" />
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Visits Chart */}
        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Monthly Visits</h3>
            <BarChart3 className="w-5 h-5 text-gray-400" />
          </div>
          <div className="space-y-3">
            {analytics.monthlyVisits.map((month, index) => (
              <div key={month.month} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{month.month}</span>
                <div className="flex items-center gap-2 flex-1 mx-4">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(month.visits / 65) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-800 min-w-[2rem]">
                    {month.visits}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Diagnoses */}
        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Top Diagnoses</h3>
            <Activity className="w-5 h-5 text-gray-400" />
          </div>
          <div className="space-y-3">
            {analytics.topDiagnoses.map((diagnosis, index) => (
              <div key={diagnosis.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    index === 0 ? 'bg-red-500' : 
                    index === 1 ? 'bg-orange-500' : 
                    index === 2 ? 'bg-yellow-500' : 
                    index === 3 ? 'bg-green-500' : 'bg-blue-500'
                  }`} />
                  <span className="text-sm text-gray-600">{diagnosis.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all duration-300 ${
                        index === 0 ? 'bg-red-500' : 
                        index === 1 ? 'bg-orange-500' : 
                        index === 2 ? 'bg-yellow-500' : 
                        index === 3 ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${(diagnosis.count / 50) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-800 min-w-[2rem]">
                    {diagnosis.count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Medicines */}
        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Most Prescribed Medicines</h3>
            <Pill className="w-5 h-5 text-gray-400" />
          </div>
          <div className="space-y-3">
            {analytics.topMedicines.map((medicine, index) => (
              <div key={medicine.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    index === 0 ? 'bg-blue-500' : 
                    index === 1 ? 'bg-green-500' : 
                    index === 2 ? 'bg-yellow-500' : 
                    index === 3 ? 'bg-purple-500' : 'bg-pink-500'
                  }`} />
                  <span className="text-sm text-gray-600">{medicine.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all duration-300 ${
                        index === 0 ? 'bg-blue-500' : 
                        index === 1 ? 'bg-green-500' : 
                        index === 2 ? 'bg-yellow-500' : 
                        index === 3 ? 'bg-purple-500' : 'bg-pink-500'
                      }`}
                      style={{ width: `${(medicine.count / 70) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-800 min-w-[2rem]">
                    {medicine.count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Revenue & Performance */}
        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Revenue & Performance</h3>
            <TrendingUp className="w-5 h-5 text-gray-400" />
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
              <div>
                <p className="text-sm text-gray-600">Today's Revenue</p>
                <p className="text-2xl font-bold text-blue-600">₹12,450</p>
              </div>
              <div className="text-green-600">+18%</div>
            </div>
            
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <div>
                <p className="text-sm text-gray-600">Monthly Revenue</p>
                <p className="text-2xl font-bold text-green-600">₹2,85,600</p>
              </div>
              <div className="text-green-600">+12%</div>
            </div>
            
            <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
              <div>
                <p className="text-sm text-gray-600">Avg. Consultation Fee</p>
                <p className="text-2xl font-bold text-purple-600">₹350</p>
              </div>
              <div className="text-green-600">+5%</div>
            </div>
          </div>
        </div>
      </div>

      {/* Additional Insights */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Quick Insights</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-blue-600" />
              <span className="font-medium text-blue-800">New Patients</span>
            </div>
            <p className="text-sm text-gray-600">45 new patients registered this month</p>
          </div>
          
          <div className="p-4 bg-green-50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-5 h-5 text-green-600" />
              <span className="font-medium text-green-800">Peak Hours</span>
            </div>
            <p className="text-sm text-gray-600">Most visits between 10 AM - 12 PM</p>
          </div>
          
          <div className="p-4 bg-yellow-50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-5 h-5 text-yellow-600" />
              <span className="font-medium text-yellow-800">Growth</span>
            </div>
            <p className="text-sm text-gray-600">25% increase in follow-up compliance</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;