import React from 'react';
import { Bill, Patient, Profile, ClinicSetting } from '../../types';
import { format } from 'date-fns';
import { toTitleCase } from '../../utils/stringUtils';

interface PrintableBillProps {
  bill: Bill;
  patient: Patient;
  doctor?: Profile;
  clinicSettings: ClinicSetting;
}

const PrintableBill: React.FC<PrintableBillProps> = ({ bill, patient, doctor, clinicSettings }) => {
  return (
    <div className="pdf-container p-8 text-black" style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* Clinic Header */}
      <div className="pdf-header text-center border-b-2 border-gray-300 pb-6 mb-6">
        {clinicSettings.logoUrl && clinicSettings.logoUrl.trim() && !clinicSettings.logoUrl.includes('example.com') && (
          <img 
            src={clinicSettings.logoUrl} 
            alt={clinicSettings.clinicName}
            className="mx-auto mb-4 h-16 object-contain"
            onError={(e) => {
              console.warn('Failed to load clinic logo:', clinicSettings.logoUrl);
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
        <h1 className="text-2xl font-bold text-gray-800 mb-2">{clinicSettings.clinicName}</h1>
        <div className="text-sm text-gray-600 space-y-1">
          <p>{clinicSettings.address}</p>
          <div className="flex justify-center gap-4">
            <span>📞 {clinicSettings.phone}</span>
            {clinicSettings.email && <span>✉️ {clinicSettings.email}</span>}
            {clinicSettings.website && <span>🌐 {clinicSettings.website}</span>}
          </div>
          {clinicSettings.registrationNumber && (
            <p>Registration No: {clinicSettings.registrationNumber}</p>
          )}
        </div>
      </div>

      {/* Bill Header */}
      <div className="pdf-section flex justify-between items-start mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">BILL / INVOICE</h2>
          <div className="text-sm space-y-1">
            <p><strong>Bill No:</strong> {bill.billNumber}</p>
            <p><strong>Date:</strong> {format(bill.billDate, 'dd/MM/yyyy')}</p>
            {bill.visit && (
              <p><strong>Visit Date:</strong> {format(bill.visit.date, 'dd/MM/yyyy')}</p>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className={`inline-block px-3 py-1 rounded text-sm font-medium ${
            bill.paymentStatus === 'paid' ? 'bg-green-100 text-green-800' :
            bill.paymentStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
            bill.paymentStatus === 'partial' ? 'bg-blue-100 text-blue-800' :
            'bg-red-100 text-red-800'
          }`}>
            {bill.paymentStatus.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Patient & Doctor Information */}
      <div className="pdf-section grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="pdf-no-break-inside border border-gray-300 rounded p-4">
          <h3 className="font-bold text-gray-800 mb-3">PATIENT DETAILS</h3>
          <div className="text-sm space-y-1">
            <p><strong>Name:</strong> {toTitleCase(patient.name)}</p>
            <p><strong>Phone:</strong> {patient.phone}</p>
            <p><strong>Age:</strong> {patient.age} years</p>
            <p><strong>Gender:</strong> {toTitleCase(patient.gender)}</p>
            {patient.bloodGroup && <p><strong>Blood Group:</strong> {patient.bloodGroup}</p>}
            <p><strong>Address:</strong> {patient.address}</p>
          </div>
        </div>

        <div className="pdf-no-break-inside border border-gray-300 rounded p-4">
          <h3 className="font-bold text-gray-800 mb-3">DOCTOR DETAILS</h3>
          <div className="text-sm space-y-1">
            <p><strong>Name:</strong> Dr. {toTitleCase(doctor?.name || 'Not specified')}</p>
            {doctor?.specialization && <p><strong>Specialization:</strong> {doctor.specialization}</p>}
            {doctor?.qualification && <p><strong>Qualification:</strong> {doctor.qualification}</p>}
            {doctor?.registrationNo && <p><strong>Registration No:</strong> {doctor.registrationNo}</p>}
            {doctor?.phone && <p><strong>Phone:</strong> {doctor.phone}</p>}
          </div>
        </div>
      </div>

      {/* Bill Items Table */}
      <div className="pdf-section mb-6">
        <h3 className="pdf-section-header font-bold text-gray-800 mb-3">BILL DETAILS</h3>
        <table className="w-full border-collapse border border-gray-300">
          <thead>
            <tr className="pdf-no-break-inside bg-gray-100">
              <th className="border border-gray-300 px-3 py-2 text-left text-sm font-medium">S.No</th>
              <th className="border border-gray-300 px-3 py-2 text-left text-sm font-medium">Item Description</th>
              <th className="border border-gray-300 px-3 py-2 text-left text-sm font-medium">Type</th>
              <th className="border border-gray-300 px-3 py-2 text-center text-sm font-medium">Qty</th>
              <th className="border border-gray-300 px-3 py-2 text-right text-sm font-medium">Unit Price (₹)</th>
              <th className="border border-gray-300 px-3 py-2 text-right text-sm font-medium">Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            {bill.billItems.map((item, index) => (
              <tr key={item.id} className="pdf-table-row">
                <td className="border border-gray-300 px-3 py-2 text-sm">{index + 1}</td>
                <td className="border border-gray-300 px-3 py-2 text-sm">{item.itemName}</td>
                <td className="border border-gray-300 px-3 py-2 text-sm capitalize">{item.itemType}</td>
                <td className="border border-gray-300 px-3 py-2 text-center text-sm">{item.quantity}</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-sm">{item.unitPrice.toFixed(2)}</td>
                <td className="border border-gray-300 px-3 py-2 text-right text-sm">{item.totalPrice.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Payment Summary */}
      <div className="pdf-section flex justify-end mb-6">
        <div className="pdf-no-break-inside w-64 border border-gray-300 rounded">
          <div className="bg-gray-100 px-4 py-2 border-b border-gray-300">
            <h4 className="font-bold text-gray-800">PAYMENT SUMMARY</h4>
          </div>
          <div className="p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Total Amount:</span>
              <span className="font-medium">₹{bill.totalAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Paid Amount:</span>
              <span className="font-medium text-green-600">₹{bill.paidAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-300 pt-2">
              <span className="font-bold">Balance Due:</span>
              <span className={`font-bold ${bill.balanceAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                ₹{bill.balanceAmount.toFixed(2)}
              </span>
            </div>
            {bill.paymentMethod && (
              <div className="flex justify-between">
                <span>Payment Method:</span>
                <span className="font-medium capitalize">{bill.paymentMethod}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notes */}
      {bill.notes && (
        <div className="pdf-section mb-6">
          <h3 className="font-bold text-gray-800 mb-2">NOTES</h3>
          <p className="text-sm text-gray-600 border border-gray-300 rounded p-3">{bill.notes}</p>
        </div>
      )}

      {/* Footer */}
      <div className="pdf-footer pdf-page-break-before border-t-2 border-gray-300 pt-4 text-center text-xs text-gray-500">
        <p>This is a computer-generated bill and does not require a signature.</p>
        <p className="mt-1">Generated on {format(new Date(), 'dd/MM/yyyy HH:mm')}</p>
        {clinicSettings.taxId && (
          <p className="mt-1">Tax ID: {clinicSettings.taxId}</p>
        )}
      </div>
    </div>
  );
};

export default PrintableBill;