import React, { useState, useEffect } from 'react';
import { X, Calendar, User, FileText, Pill, TestTube, CreditCard, Activity, CheckCircle, XCircle, Stethoscope, Phone, Clock, Download, Edit, ClipboardList, Eye, Printer, MessageCircle } from 'lucide-react';
import { Visit, Bill } from '../../types';
import { supabase } from '../../lib/supabaseClient';
import { visitService } from '../../services/visitService';
import { billingService } from '../../services/billingService';
import { useAuth } from '../Auth/useAuth';
import { authService } from '../../services/authService';
import { format } from 'date-fns';
import BillModal from '../Billing/BillModal';
import DispenseModal from '../Pharmacy/DispenseModal';
import AddVisitModal from '../Patients/AddVisitModal';
import { toTitleCase } from '../../utils/stringUtils';
import { pdfService } from '../../services/pdfService';
import { WhatsAppAutoSendService } from '../../services/whatsappAutoSendService';

interface VisitDetailsModalProps {
  visitId: string;
  onClose: () => void;
}

const VisitDetailsModal: React.FC<VisitDetailsModalProps> = ({ visitId, onClose }) => {
  const { user } = useAuth();
  const [visit, setVisit] = useState<Visit | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBillModal, setShowBillModal] = useState(false);
  const [showDispenseModal, setShowDispenseModal] = useState(false);
  const [showEditVisitModal, setShowEditVisitModal] = useState(false);
  const [dispensedItemsForBilling, setDispensedItemsForBilling] = useState<any[]>([]);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [generatingPrintPdf, setGeneratingPrintPdf] = useState(false);
  const [sendingWhatsAppPrescription, setSendingWhatsAppPrescription] = useState(false);
  const [sendingWhatsAppInvoice, setSendingWhatsAppInvoice] = useState<string | null>(null); // Track which bill is being sent

  useEffect(() => {
    if (user && visitId) {
      loadVisitData();
      loadDoctors();
    }
  }, [user, visitId]);

  const loadVisitData = async () => {
    try {
      setLoading(true);
      setError(null);

      const visitData = await visitService.getVisit(visitId);
      if (!visitData) {
        setError('Visit not found');
        return;
      }

      setVisit(visitData);

      // Load bills for this visit
      const allBills = await billingService.getBills();
      const visitBills = allBills.filter(bill => bill.visitId === visitId);
      setBills(visitBills);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load visit details');
      console.error('Error loading visit details:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDoctors = async () => {
    try {
      // Load doctors using authService to ensure clinic filtering
      const doctorsData = await authService.getDoctors();
      setDoctors(doctorsData);
    } catch (error) {
      console.error('Error loading doctors:', error);
      setDoctors([]);
    }
  };

  const handleAddBill = () => {
    setShowBillModal(true);
  };

  const handleBillSaved = () => {
    setShowBillModal(false);
    loadVisitData(); // Reload to show new bill
  };

  const getStatusColor = (status: Bill['paymentStatus']) => {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'partial': return 'bg-blue-100 text-blue-800';
      case 'overdue': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Normalize phone number: remove leading zeros and spaces
  const normalizePhoneNumber = (phone: string): string => {
    if (!phone) return phone;
    // Remove spaces, dashes, parentheses
    let normalized = phone.replace(/[\s\-\(\)]/g, '');
    // Remove + prefix if present
    if (normalized.startsWith('+')) {
      normalized = normalized.substring(1);
    }
    // Remove leading zeros (e.g., 08780465286 -> 8780465286)
    normalized = normalized.replace(/^0+/, '');
    return normalized;
  };

  const handleDispenseSaved = (dispensedItems?: any[]) => {
    setShowDispenseModal(false);

    // If items were dispensed, ask if user wants to create a bill
    if (dispensedItems && dispensedItems.length > 0) {
      const createBill = confirm('Medicines dispensed successfully! Would you like to create a bill for these items?');
      if (createBill) {
        setDispensedItemsForBilling(dispensedItems);
        setShowBillModal(true);
      }
    }
  };

  const handleExportPDF = async () => {
    if (!visit) return;

    try {
      setExportingPDF(true);

      // Reload visit data from database to get latest pdf_url
      const latestVisit = await visitService.getVisit(visitId);
      if (latestVisit) {
        setVisit(latestVisit);
      }

      const currentVisit = latestVisit || visit;

      // Check if PDF already exists - if so, just download it
      if (currentVisit.pdf_url) {
        console.log('Using cached PDF for download:', currentVisit.pdf_url);
        window.open(currentVisit.pdf_url, '_blank');
        return;
      }

      console.log('No cached PDF found, generating new one for download...');

      // Find the doctor for this visit - check in loaded doctors first
      let doctor = doctors.find(d => d.id === currentVisit.doctorId) || currentVisit.doctor;

      // If doctor not found (might be inactive or not open for consultation),
      // fetch all doctors to find them
      if (!doctor && currentVisit.doctorId) {
        const { authService } = await import('../../services/authService');
        const allDoctors = await authService.getAllDoctors();
        doctor = allDoctors.find(d => d.id === currentVisit.doctorId);
      }

      // Validate required data before generating PDF
      if (!currentVisit.patient) {
        throw new Error('Patient data not found');
      }
      if (!user?.clinic) {
        throw new Error('Clinic settings not found');
      }

      const pdfUrl = await pdfService.generatePdfFromData('visit', {
        visit: currentVisit,
        patient: currentVisit.patient,
        doctor: doctor,
        clinicSettings: user.clinic
      });

      // Artificial delay to show "Processing" state to user
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Save PDF URL and trigger WhatsApp
      if (currentVisit.id) {
        await pdfService.savePdfUrlToDatabase('visit', currentVisit.id, pdfUrl);
        // Update local state
        setVisit(prev => prev ? { ...prev, pdf_url: pdfUrl } : null);
        console.log('PDF generated and saved:', pdfUrl);

        if (user?.clinic?.id && user?.id) {
          WhatsAppAutoSendService.sendPrescriptionPdf(
            currentVisit.id,
            pdfUrl,
            user.id,
            user.clinic.id
          ).catch(err => console.error('Failed to auto-send WhatsApp:', err));
        }
      }

      window.open(pdfUrl, '_blank'); // Open the generated PDF in a new tab

    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF. Please try again.');
    } finally {
      setExportingPDF(false);
    }
  };

  // Handle generating print version PDF (for letterhead printing)
  const handleGeneratePrintPdf = async () => {
    if (!visit) return;

    try {
      setGeneratingPrintPdf(true);

      // Reload visit data from database to get latest print_pdf_url
      const latestVisit = await visitService.getVisit(visitId);
      if (latestVisit) {
        setVisit(latestVisit);
      }

      const currentVisit = latestVisit || visit;

      // Check if print PDF already exists - if so, just open it
      if (currentVisit.print_pdf_url) {
        console.log('Using cached print PDF:', currentVisit.print_pdf_url);
        window.open(currentVisit.print_pdf_url, '_blank');
        return;
      }

      console.log('No cached print PDF found, generating new one...');

      // Find the doctor for this visit
      let doctor = doctors.find(d => d.id === currentVisit.doctorId) || currentVisit.doctor;
      if (!doctor && currentVisit.doctorId) {
        const { authService } = await import('../../services/authService');
        const allDoctors = await authService.getAllDoctors();
        doctor = allDoctors.find(d => d.id === currentVisit.doctorId);
      }

      // Validate required data
      if (!currentVisit.patient) {
        throw new Error('Patient data not found');
      }
      if (!user?.clinic) {
        throw new Error('Clinic settings not found');
      }

      // Generate print PDF
      const printPdfUrl = await pdfService.generatePrintPdf('visit', {
        visit: currentVisit,
        patient: currentVisit.patient,
        doctor: doctor,
        clinicSettings: user.clinic
      });

      // Artificial delay
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Save print PDF URL to database
      if (currentVisit.id) {
        await pdfService.savePrintPdfUrl('visit', currentVisit.id, printPdfUrl);
        // Update local state
        setVisit(prev => prev ? { ...prev, print_pdf_url: printPdfUrl } : null);
        console.log('Print PDF generated and saved:', printPdfUrl);
      }

      window.open(printPdfUrl, '_blank');

    } catch (error) {
      console.error('Error generating print PDF:', error);
      alert('Failed to generate print PDF. Please try again.');
    } finally {
      setGeneratingPrintPdf(false);
    }
  };

  // Handle viewing prescription PDF - opens in new tab (uses cached PDF if available)
  const handleViewPrescriptionPdf = async () => {
    if (!visit) return;

    // Reload visit data from database to get latest pdf_url
    const latestVisit = await visitService.getVisit(visitId);
    if (latestVisit) {
      setVisit(latestVisit);
      // If PDF already exists in database, use it directly
      if (latestVisit.pdf_url) {
        console.log('Opening cached prescription PDF:', latestVisit.pdf_url);
        window.open(latestVisit.pdf_url, '_blank');
        return;
      }
    }

    // Otherwise, generate and open
    console.log('No cached PDF found, generating...');
    await handleExportPDF();
  };

  // Handle sending prescription via WhatsApp
  const handleSendWhatsAppPrescription = async () => {
    if (!visit || !visit.patient || !user?.clinic) {
      alert('Missing required data for WhatsApp prescription');
      return;
    }

    // Check if patient has phone number
    if (!visit.patient.phone) {
      alert('Patient phone number is required to send WhatsApp message');
      return;
    }

    try {
      setSendingWhatsAppPrescription(true);

      // Reload visit data from database to get latest pdf_url
      const latestVisit = await visitService.getVisit(visitId);
      if (latestVisit) {
        setVisit(latestVisit);
      }

      const currentVisit = latestVisit || visit;
      let pdfUrl = currentVisit.pdf_url;

      console.log('Checking for cached PDF:', {
        visitId,
        hasCachedPdf: !!pdfUrl,
        pdfUrl
      });

      // If no cached PDF, generate one
      if (!pdfUrl) {
        console.log('No cached PDF found, generating new one...');
        // Find the doctor for this visit
        let doctor = doctors.find(d => d.id === currentVisit.doctorId) || currentVisit.doctor;
        if (!doctor && currentVisit.doctorId) {
          const { authService } = await import('../../services/authService');
          const allDoctors = await authService.getAllDoctors();
          doctor = allDoctors.find(d => d.id === currentVisit.doctorId);
        }


        if (!currentVisit.patient) {
          throw new Error('Patient data not found');
        }

        pdfUrl = await pdfService.generatePdfFromData('visit', {
          visit: currentVisit,
          patient: currentVisit.patient,
          doctor: doctor,
          clinicSettings: user.clinic
        });

        // Save PDF URL to database
        if (currentVisit.id) {
          await pdfService.savePdfUrlToDatabase('visit', currentVisit.id, pdfUrl);
          // Update local state
          setVisit(prev => prev ? { ...prev, pdf_url: pdfUrl } : null);
          console.log('PDF generated and saved:', pdfUrl);
        }
      } else {
        console.log('Using cached PDF:', pdfUrl);
      }

      // Send via WhatsApp using Netlify function
      if (!supabase) {
        throw new Error('Supabase client not initialized');
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      // Get the template message
      const template = user.clinic.whatsappTemplates?.visit_prescription ||
        'Dear {{patientName}},\n\n💊 Your prescription from {{clinicName}} is ready!\n\nThe prescription has been attached to this message for your reference.\n\n📋 Please follow the prescribed medication as discussed during your consultation.\n\nFeel better soon! 🌟\n\n- {{clinicName}}';

      const message = template
        .replace('{{patientName}}', currentVisit.patient?.name || '')
        .replace('{{pdfUrl}}', pdfUrl)
        .replace('{{clinicName}}', user.clinic.clinicName);

      const response = await fetch('/.netlify/functions/whatsapp-send-bill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: normalizePhoneNumber(currentVisit.patient?.phone || ''), // Normalized: removes leading 0, will auto-add +91
          fileUrl: pdfUrl,
          caption: message,
          userId: user.id,
          fileName: `Prescription_${currentVisit.patient?.name.replace(/\s+/g, '_')}_${format(currentVisit.date, 'dd-MM-yyyy')}.pdf`,
          patientName: currentVisit.patient?.name,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send WhatsApp message');
      }

      alert('Prescription sent via WhatsApp successfully!');
    } catch (error) {
      console.error('Error sending WhatsApp prescription:', error);
      alert(`Failed to send WhatsApp prescription: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSendingWhatsAppPrescription(false);
    }
  };

  // Handle sending invoice via WhatsApp
  const handleSendWhatsAppInvoice = async (bill: Bill) => {
    if (!visit || !visit.patient || !user?.clinic) {
      alert('Missing required data for WhatsApp invoice');
      return;
    }

    // Check if patient has phone number
    if (!visit.patient.phone) {
      alert('Patient phone number is required to send WhatsApp message');
      return;
    }

    try {
      setSendingWhatsAppInvoice(bill.id);

      let pdfUrl = bill.pdfUrl;

      // If no cached PDF, generate one
      if (!pdfUrl) {
        pdfUrl = await pdfService.generatePdfFromData('bill', {
          bill: bill,
          patient: visit.patient,
          clinicSettings: user.clinic
        });

        // Save PDF URL to database
        if (bill.id) {
          await pdfService.savePdfUrlToDatabase('bill', bill.id, pdfUrl);
          // Reload visit data to update bill list with new PDF URL
          await loadVisitData();
        }
      }

      // Send via WhatsApp using Netlify function
      if (!supabase) {
        throw new Error('Supabase client not initialized');
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      // Get the template message
      const template = user.clinic.whatsappTemplates?.invoice_generated ||
        'Dear {{patientName}},\n\n🧾 **INVOICE DETAILS**\n\nBill Number: #{{billNumber}}\n💰 Total Amount: ₹{{totalAmount}}\n\nYour invoice has been attached to this message.\n\nThank you for visiting {{clinicName}}! 🙏\n\nFor any queries, feel free to contact us.\n\n- {{clinicName}}';

      const message = template
        .replace('{{patientName}}', visit.patient.name)
        .replace('{{billNumber}}', bill.billNumber)
        .replace('{{totalAmount}}', bill.totalAmount.toString())
        .replace('{{pdfUrl}}', pdfUrl)
        .replace('{{clinicName}}', user.clinic.clinicName);

      const response = await fetch('/.netlify/functions/whatsapp-send-bill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: normalizePhoneNumber(visit.patient.phone), // Normalized: removes leading 0, will auto-add +91
          fileUrl: pdfUrl,
          caption: message,
          userId: user.id,
          fileName: `Invoice_${bill.billNumber}_${visit.patient.name.replace(/\s+/g, '_')}.pdf`,
          billNumber: bill.billNumber,
          patientName: visit.patient.name,
          totalAmount: bill.totalAmount,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send WhatsApp message');
      }

      alert('Invoice sent via WhatsApp successfully!');
    } catch (error) {
      console.error('Error sending WhatsApp invoice:', error);
      alert(`Failed to send WhatsApp invoice: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSendingWhatsAppInvoice(null);
    }
  };

  const handleEditVisit = () => {
    setShowEditVisitModal(true);
  };

  const handleVisitUpdated = () => {
    setShowEditVisitModal(false);
    loadVisitData(); // Reload visit data to show changes
  };

  // Handle viewing bill PDF - opens in new tab (uses cached PDF if available)
  const handleViewBillPdf = async (bill: Bill) => {
    // If PDF already exists, use it directly
    if (bill.pdfUrl) {
      window.open(bill.pdfUrl, '_blank');
      return;
    }

    // Otherwise, generate new PDF
    if (!visit?.patient || !user?.clinic) {
      alert('Missing required data for PDF view');
      return;
    }

    try {
      const pdfUrl = await pdfService.generatePdfFromData('bill', {
        bill: bill,
        patient: visit.patient,
        clinicSettings: user.clinic
      });

      // Open the PDF in a new tab
      window.open(pdfUrl, '_blank');
    } catch (error) {
      console.error('Error viewing bill PDF:', error);
      alert('Failed to load bill PDF. Please try again.');
    }
  };

  // Handle printing bill PDF - opens print dialog (uses cached PDF if available)
  const handlePrintBillPdf = async (bill: Bill) => {
    let pdfUrl = bill.pdfUrl;

    // If no cached PDF, generate one
    if (!pdfUrl) {
      if (!visit?.patient || !user?.clinic) {
        alert('Missing required data for PDF print');
        return;
      }

      try {
        pdfUrl = await pdfService.generatePdfFromData('bill', {
          bill: bill,
          patient: visit.patient,
          clinicSettings: user.clinic
        });
      } catch (error) {
        console.error('Error printing bill PDF:', error);
        alert('Failed to load bill PDF for printing. Please try again.');
        return;
      }
    }

    // Open PDF in a new window and trigger print
    const printWindow = window.open(pdfUrl, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  };

  const getVisitStatus = () => {
    if (!visit) return 'Closed';
    return visit.followUpDate && new Date(visit.followUpDate) > new Date() ? 'Open' : 'Closed';
  };

  if (!user) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
        {/* Modal Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-xl">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                Visit Details - {visit ? format(visit.date, 'MMM dd, yyyy') : 'Loading...'}
              </h2>
              {visit && (
                <p className="text-sm text-gray-600 mt-1">
                  {toTitleCase(visit.patient?.name || '')} • Dr. {toTitleCase(visit.doctor?.name || 'Unknown')}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Modal Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading visit details...</p>
            </div>
          ) : error || !visit ? (
            <div className="text-center py-12">
              <div className="text-red-600 mb-4">{error || 'Visit not found'}</div>
              <button
                onClick={onClose}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Visit Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="card-standard p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <User className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Patient</p>
                      <p className="font-semibold text-gray-900">{toTitleCase(visit.patient?.name || '')}</p>
                      <p className="text-sm text-gray-600 flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {visit.patient?.phone}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="card-standard p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                      <Calendar className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Visit Date</p>
                      <p className="font-semibold text-gray-900">{format(visit.date, 'PPP')}</p>
                      <p className="text-sm text-gray-600 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {format(visit.date, 'p')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="card-standard p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <Stethoscope className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Doctor</p>
                      <p className="font-semibold text-gray-900">{toTitleCase(visit.doctor?.name || 'Unknown')}</p>
                      {visit.doctor?.specialization && (
                        <p className="text-sm text-gray-600">{visit.doctor.specialization}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="card-standard p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                      <Activity className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Status</p>
                      <div className="mt-1">
                        <span className={`status-chip ${getVisitStatus() === 'Open' ? 'status-chip-open' : 'status-chip-closed'
                          }`}>
                          {getVisitStatus() === 'Open' ? (
                            <CheckCircle className="w-3 h-3" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          {getVisitStatus()}
                        </span>
                      </div>
                      {visit.followUpDate && (
                        <p className="text-sm text-gray-600 mt-1">
                          Follow-up: {format(visit.followUpDate, 'MMM dd, yyyy')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleEditVisit}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  Edit Visit
                </button>
                <button
                  onClick={handleViewPrescriptionPdf}
                  disabled={exportingPDF}
                  className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  <Eye className="w-4 h-4" />
                  {exportingPDF ? 'Loading...' : visit?.pdf_url ? 'View Prescription' : 'Generate & View'}
                </button>
                <button
                  onClick={handleExportPDF}
                  disabled={exportingPDF}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  {exportingPDF ? 'Exporting...' : 'Download PDF'}
                </button>
                <button
                  onClick={handleGeneratePrintPdf}
                  disabled={generatingPrintPdf}
                  className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                  title="Generate grayscale PDF for printing on letterhead"
                >
                  <Printer className="w-4 h-4" />
                  {generatingPrintPdf ? 'Generating...' : 'Print Version'}
                </button>
                <button
                  onClick={handleSendWhatsAppPrescription}
                  disabled={sendingWhatsAppPrescription || exportingPDF || generatingPrintPdf}
                  className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  <MessageCircle className="w-4 h-4" />
                  {sendingWhatsAppPrescription ? 'Finalizing...' : 'Send WhatsApp Prescription'}
                </button>
                <button
                  onClick={handleAddBill}
                  className="flex items-center gap-2 bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors"
                >
                  <CreditCard className="w-4 h-4" />
                  Add Bill for this Visit
                </button>
                <button
                  onClick={() => setShowDispenseModal(true)}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Pill className="w-4 h-4" />
                  Dispense Medicines
                </button>
              </div>

              {/* Visit Details Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Chief Complaint & Symptoms */}
                <div className="card-standard p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    Chief Complaint & Symptoms
                  </h3>

                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium text-gray-700 mb-2">Chief Complaint</h4>
                      <p className="text-gray-600 bg-gray-50 p-3 rounded-lg">
                        {visit.chiefComplaint || 'No complaint specified'}
                      </p>
                    </div>

                    {visit.symptoms && visit.symptoms.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-700 mb-2">Symptoms</h4>
                        <div className="space-y-2">
                          {visit.symptoms.map(symptom => (
                            <div key={symptom.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                              <span className="text-gray-800 font-medium">{symptom.name}</span>
                              {symptom.severity && (
                                <span className={`px-2 py-1 text-xs rounded-lg font-medium ${symptom.severity === 'severe' ? 'bg-red-100 text-red-700' :
                                  symptom.severity === 'moderate' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-green-100 text-green-700'
                                  }`}>
                                  {symptom.severity}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Vitals */}
                <div className="card-standard p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-green-600" />
                    Vitals
                  </h3>

                  <div className="grid grid-cols-2 gap-4">
                    {visit.vitals.temperature && (
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-sm text-gray-600">Temperature</p>
                        <p className="font-semibold text-gray-900">{visit.vitals.temperature}°F</p>
                      </div>
                    )}
                    {visit.vitals.bloodPressure && (
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-sm text-gray-600">Blood Pressure</p>
                        <p className="font-semibold text-gray-900">{visit.vitals.bloodPressure}</p>
                      </div>
                    )}
                    {visit.vitals.pulse && (
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-sm text-gray-600">Pulse</p>
                        <p className="font-semibold text-gray-900">{visit.vitals.pulse} BPM</p>
                      </div>
                    )}
                    {visit.vitals.weight && (
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-sm text-gray-600">Weight</p>
                        <p className="font-semibold text-gray-900">{visit.vitals.weight} kg</p>
                      </div>
                    )}
                    {visit.vitals.height && (
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-sm text-gray-600">Height</p>
                        <p className="font-semibold text-gray-900">{visit.vitals.height} cm</p>
                      </div>
                    )}
                    {visit.vitals.oxygenSaturation && (
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-sm text-gray-600">Oxygen Saturation</p>
                        <p className="font-semibold text-gray-900">{visit.vitals.oxygenSaturation}%</p>
                      </div>
                    )}
                  </div>

                  {!Object.values(visit.vitals).some(v => v) && (
                    <p className="text-gray-500 italic text-center py-8">No vitals recorded</p>
                  )}
                </div>
              </div>

              {/* Physical Examination */}
              {visit.physicalExamination?.sections && visit.physicalExamination.sections.length > 0 && (
                <div className="card-standard p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-purple-600" />
                    Physical Examination
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {visit.physicalExamination.sections.map(section => (
                      <div key={section.id} className="border border-gray-200 rounded-lg p-4">
                        <h4 className="font-medium text-gray-800 mb-3 text-sm">{section.title}</h4>
                        <div className="space-y-2">
                          {section.fields.filter(field => field.value).map(field => (
                            <div key={field.key} className="bg-gray-50 p-2 rounded">
                              <p className="text-xs text-gray-500">{field.label}</p>
                              <p className="text-sm font-medium text-gray-900">
                                {typeof field.value === 'boolean'
                                  ? (field.value ? 'Present' : 'Absent')
                                  : field.value}
                              </p>
                            </div>
                          ))}
                          {section.fields.filter(field => field.value).length === 0 && (
                            <p className="text-gray-400 text-xs italic">No findings recorded</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Diagnoses & Prescriptions */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Diagnoses */}
                <div className="card-standard p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-red-600" />
                    Diagnoses
                  </h3>

                  {visit.diagnoses && visit.diagnoses.length > 0 ? (
                    <div className="space-y-3">
                      {visit.diagnoses.map(diagnosis => (
                        <div key={diagnosis.id} className="flex items-center justify-between p-4 bg-red-50 border border-red-200 rounded-lg">
                          <div>
                            <p className="font-medium text-red-900">{diagnosis.name}</p>
                            {diagnosis.icd10Code && (
                              <p className="text-sm text-red-700">ICD-10: {diagnosis.icd10Code}</p>
                            )}
                          </div>
                          {diagnosis.isPrimary && (
                            <span className="px-2 py-1 text-xs bg-red-200 text-red-800 rounded-lg font-medium">
                              Primary
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 italic text-center py-8">No diagnoses recorded</p>
                  )}
                </div>

                {/* Prescriptions */}
                <div className="card-standard p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Pill className="w-5 h-5 text-blue-600" />
                    <h3 className="text-lg font-semibold text-gray-900">Prescriptions</h3>
                  </div>

                  {visit.prescriptions && visit.prescriptions.length > 0 ? (
                    <div className="space-y-3">
                      {visit.prescriptions.map(prescription => (
                        <div key={prescription.id} className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                          <p className="font-medium text-blue-900">{prescription.medicine}</p>
                          <p className="text-sm text-blue-700 mt-1">
                            {prescription.dosage} • {prescription.frequency} • {prescription.duration}
                          </p>
                          <p className="text-sm text-blue-600 mt-1">{prescription.instructions}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 italic text-center py-8">No prescriptions recorded</p>
                  )}
                </div>
              </div>

              {/* Tests & Advice */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Tests Ordered */}
                <div className="card-standard p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <TestTube className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900">Tests Ordered</h3>
                  </div>

                  {visit.testsOrdered && visit.testsOrdered.length > 0 ? (
                    <div className="space-y-3">
                      {visit.testsOrdered.map(test => (
                        <div key={test.id} className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-purple-900">{test.testName}</p>
                            <span className={`px-2 py-1 text-xs rounded-lg font-medium ${test.status === 'completed' ? 'bg-green-100 text-green-700' :
                              test.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                              {test.status.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-sm text-purple-700 capitalize mt-1">
                            {test.testType === 'procedure' ? 'Procedure' : test.testType} • {test.urgency}
                          </p>
                          {test.instructions && (
                            <p className="text-sm text-purple-600 mt-1">{test.instructions}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 italic text-center py-8">No tests ordered</p>
                  )}
                </div>

                {/* Advice & Notes */}
                <div className="card-standard p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-gray-600" />
                    Advice & Notes
                  </h3>

                  <div className="space-y-4">
                    {visit.advice && visit.advice.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-700 mb-2">Advice</h4>
                        <ul className="space-y-2">
                          {visit.advice.map((advice, index) => (
                            <li key={index} className="flex items-start gap-2 text-gray-600 bg-gray-50 p-3 rounded-lg">
                              <span className="text-blue-600 mt-1">•</span>
                              {advice}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Regional Language Advice */}
                    {(() => {
                      const adviceLanguage = (visit as any).adviceLanguage || (visit as any).advice_language;
                      const adviceRegional = (visit as any).adviceRegional || (visit as any).advice_regional;

                      if (adviceLanguage && adviceLanguage !== 'english') {
                        return (
                          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                            <h4 className="font-medium text-amber-800 mb-2 flex items-center gap-2">
                              🗣️ Regional Language Advice
                              <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full capitalize">
                                {adviceLanguage}
                              </span>
                            </h4>
                            {adviceRegional ? (
                              <p className="text-amber-900">{adviceRegional}</p>
                            ) : (
                              <p className="text-amber-600 italic text-sm">
                                AI will auto-translate advice to {adviceLanguage} when generating PDF
                              </p>
                            )}
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {visit.doctorNotes && (
                      <div>
                        <h4 className="font-medium text-gray-700 mb-2">Doctor's Notes</h4>
                        <p className="text-gray-600 italic bg-gray-50 p-3 rounded-lg">{visit.doctorNotes}</p>
                      </div>
                    )}

                    {(!visit.advice || visit.advice.length === 0) &&
                      !visit.doctorNotes &&
                      !((visit as any).adviceLanguage || (visit as any).advice_language) && (
                        <p className="text-gray-500 italic text-center py-8">No advice or notes recorded</p>
                      )}
                  </div>
                </div>
              </div>

              {/* Associated Bills */}
              <div className="card-standard p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-green-600" />
                    <h3 className="text-lg font-semibold text-gray-900">Associated Bills</h3>
                  </div>
                  <span className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded-lg">
                    {bills.length} bill(s)
                  </span>
                </div>

                {bills.length > 0 ? (
                  <div className="space-y-3">
                    {bills.map(bill => (
                      <div key={bill.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                        <div>
                          <p className="font-medium text-gray-900">{bill.billNumber}</p>
                          <p className="text-sm text-gray-600">
                            {format(bill.billDate, 'MMM dd, yyyy')} • ₹{bill.totalAmount.toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`px-3 py-1 text-xs rounded-lg font-medium ${getStatusColor(bill.paymentStatus)}`}>
                            {bill.paymentStatus}
                          </span>
                          {bill.balanceAmount > 0 && (
                            <span className="text-sm text-red-600 font-medium">
                              Balance: ₹{bill.balanceAmount.toLocaleString()}
                            </span>
                          )}
                          {/* View PDF Button */}
                          <button
                            onClick={() => handleViewBillPdf(bill)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="View Bill PDF"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {/* Print Button */}
                          <button
                            onClick={() => handlePrintBillPdf(bill)}
                            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Print Bill"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                          {/* WhatsApp Invoice Button */}
                          <button
                            onClick={() => handleSendWhatsAppInvoice(bill)}
                            disabled={sendingWhatsAppInvoice === bill.id}
                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Send Invoice via WhatsApp"
                          >
                            {sendingWhatsAppInvoice === bill.id ? (
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
                            ) : (
                              <MessageCircle className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <CreditCard className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 mb-3">No bills created for this visit yet</p>
                    <button
                      onClick={handleAddBill}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Create First Bill
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bill Modal */}
      {showBillModal && visit && (
        <BillModal
          bill={null}
          patientId={visit.patientId}
          visitId={visit.id}
          prefillItems={dispensedItemsForBilling}
          onSave={handleBillSaved}
          onClose={() => {
            setShowBillModal(false);
            setDispensedItemsForBilling([]);
          }}
        />
      )}

      {/* Dispense Modal */}
      {showDispenseModal && visit && (
        <DispenseModal
          visit={visit}
          onSave={handleDispenseSaved}
          onClose={() => setShowDispenseModal(false)}
        />
      )}

      {/* Edit Visit Modal */}
      {showEditVisitModal && visit && (
        <AddVisitModal
          patient={visit.patient!}
          existingVisit={visit}
          onSave={handleVisitUpdated}
          onClose={() => setShowEditVisitModal(false)}
        />
      )}
    </div>
  );
};

export default VisitDetailsModal;