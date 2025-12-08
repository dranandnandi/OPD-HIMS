import React, { useState, useEffect } from 'react';
import { Upload, Camera, FileText, Loader2, CheckCircle, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { supabase } from '../../lib/supabase';
import InvoiceReviewModal from './InvoiceReviewModal';
import { pharmacyService } from '../../services/pharmacyService';
import { masterDataService } from '../../services/masterDataService';

interface Supplier {
  id: string;
  name: string;
}

interface MedicineWithPrice {
  id: string;
  name: string;
}

interface InvoiceData {
  invoiceInfo: {
    supplierName: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    totalAmount: number | null;
  };
  medicines: Array<{
    medicineName: string;
    quantity: number;
    unitCostPrice: number;
    totalCostPrice: number | null;
    batchNumber: string | null;
    expiryDate: string | null;
    manufacturer: string | null;
    strength: string | null;
    packSize: string | null;
  }>;
}

const InvoiceUpload: React.FC = () => {
  const { user } = useAuth();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<{
    step: number;
    total: number;
    message: string;
    detail?: string;
  }>({ step: 0, total: 4, message: '', detail: '' });
  const [extractedData, setExtractedData] = useState<InvoiceData | null>(null);
  const [rawText, setRawText] = useState<string>('');
  const [confidence, setConfidence] = useState<number>(0);
  const [step, setStep] = useState<'method' | 'upload' | 'processing' | 'review' | 'manual'>('method');
  const [error, setError] = useState<string | null>(null);
  const [entryMethod, setEntryMethod] = useState<'ai' | 'manual'>('ai');

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !user) return;

    setIsProcessing(true);
    setStep('processing');
    setError(null);

    try {
      // Step 1: Convert file to base64
      setProcessingStage({
        step: 1,
        total: 4,
        message: 'Preparing file for processing...',
        detail: 'Converting file to base64 format'
      });
      
      // Convert file to base64
      const base64 = await fileToBase64(selectedFile);
      
      // Step 2: Get authentication token
      setProcessingStage({
        step: 2,
        total: 4,
        message: 'Authenticating request...',
        detail: 'Obtaining secure access token'
      });
      
      // Get session token for authentication
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) throw new Error('Not authenticated');
      const token = session.access_token;

      // Step 3: Extract text from invoice
      setProcessingStage({
        step: 3,
        total: 4,
        message: 'Extracting text from invoice...',
        detail: selectedFile.type === 'application/pdf' ? 'Processing PDF document' : 'Analyzing image with OCR'
      });

      // Call the appropriate edge function based on file type
      let response;
      if (selectedFile.type === 'application/pdf') {
        response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-pharmacy-pdf`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ 
            pdfBase64: base64,
            fileName: selectedFile.name,
            fileType: selectedFile.type
          })
        });
      } else {
        response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-pharmacy-invoice`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ 
            imageBase64: base64,
            fileName: selectedFile.name,
            fileType: selectedFile.type
          })
        });
      }

      // Step 4: Processing AI analysis
      setProcessingStage({
        step: 4,
        total: 4,
        message: 'AI analyzing invoice data...',
        detail: 'Extracting medicine information and pricing'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error', details: response.statusText }));
        throw new Error(`Invoice processing failed: ${errorData.error}${errorData.details ? ` - ${errorData.details}` : ''}`);
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error);
      }

      setExtractedData(result.extractedData);
      setRawText(result.rawText);
      setConfidence(result.confidence);
      setStep('review');

    } catch (err) {
      console.error('Invoice processing error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process invoice');
      setStep('upload');
    } finally {
      setIsProcessing(false);
      setProcessingStage({ step: 0, total: 4, message: '', detail: '' });
    }
  };

  const handleStartOver = () => {
    setSelectedFile(null);
    setExtractedData(null);
    setRawText('');
    setConfidence(0);
    setStep('method');
    setError(null);
    setEntryMethod('ai');
  };

  const handleReviewComplete = () => {
    handleStartOver();
  };

  const handleMethodSelection = (method: 'ai' | 'manual') => {
    setEntryMethod(method);
    if (method === 'ai') {
      setStep('upload');
    } else {
      setStep('manual');
    }
  };

  // Convert File to base64 string
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to upload invoices.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Invoice Upload & Processing</h2>
          <p className="text-gray-600">Upload supplier invoices for automated data extraction</p>
        </div>
        {step !== 'upload' && (
          <button
            onClick={handleStartOver}
            className="text-blue-600 hover:text-blue-700 transition-colors"
          >
            Start Over
          </button>
        )}
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-4 mb-8">
        {['Method', 'Upload/Entry', 'Processing', 'Review'].map((stepName, index) => {
          const stepValue = ['method', entryMethod === 'ai' ? 'upload' : 'manual', 'processing', 'review'][index];
          const isActive = step === stepValue;
          const isCompleted = ['method', entryMethod === 'ai' ? 'upload' : 'manual', 'processing', 'review'].indexOf(step) > index;
          
          return (
            <div key={stepName} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                isCompleted ? 'bg-green-500 text-white' : 
                isActive ? 'bg-blue-500 text-white' : 
                'bg-gray-200 text-gray-600'
              }`}>
                {isCompleted ? <CheckCircle className="w-4 h-4" /> : index + 1}
              </div>
              <span className={`ml-2 text-sm ${isActive ? 'text-blue-600 font-medium' : 'text-gray-600'}`}>
                {stepName}
              </span>
              {index < 3 && <div className="w-8 h-px bg-gray-300 mx-4" />}
            </div>
          );
        })}
      </div>

      {/* Method Selection Step */}
      {step === 'method' && (
        <div className="space-y-6">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">How would you like to process the invoice?</h3>
            <p className="text-gray-600">Choose your preferred method for entering invoice data</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <button
              onClick={() => handleMethodSelection('ai')}
              className="p-8 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors group"
            >
              <div className="text-center space-y-4">
                <Camera className="w-16 h-16 text-gray-400 group-hover:text-blue-500 mx-auto transition-colors" />
                <div>
                  <h4 className="text-lg font-medium text-gray-800">AI-Powered Processing</h4>
                  <p className="text-gray-600">Upload invoice image for automatic data extraction</p>
                  <p className="text-sm text-blue-600 mt-2">Recommended for faster processing</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => handleMethodSelection('manual')}
              className="p-8 border-2 border-dashed border-gray-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors group"
            >
              <div className="text-center space-y-4">
                <FileText className="w-16 h-16 text-gray-400 group-hover:text-green-500 mx-auto transition-colors" />
                <div>
                  <h4 className="text-lg font-medium text-gray-800">Manual Entry</h4>
                  <p className="text-gray-600">Enter invoice details manually using forms</p>
                  <p className="text-sm text-green-600 mt-2">Full control over data entry</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Upload Step */}
      {step === 'upload' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">AI-Powered Invoice Processing</h3>
            <button
              onClick={() => setStep('method')}
              className="text-blue-600 hover:text-blue-700 text-sm"
            >
              ← Back to method selection
            </button>
          </div>
          
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <div className="space-y-4">
              {selectedFile ? (
                <>
                  <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
                  <div>
                    <p className="text-lg font-medium text-gray-800">Invoice Selected</p>
                    <p className="text-gray-600">{selectedFile.name}</p>
                    <p className="text-sm text-gray-500">
                      Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <button
                    onClick={handleUpload}
                    className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 mx-auto"
                  >
                    <FileText className="w-5 h-5" />
                    Process Invoice with AI
                  </button>
                </>
              ) : (
                <>
                  <Upload className="w-16 h-16 text-gray-400 mx-auto" />
                  <div>
                    <p className="text-lg font-medium text-gray-800">Upload Supplier Invoice</p>
                    <p className="text-gray-600">Take a photo or select an image/PDF of the supplier invoice</p>
                    <p className="text-sm text-gray-500 mt-2">
                      Supported formats: JPG, PNG, PDF • Max size: 10MB
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <label className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors cursor-pointer flex items-center gap-2">
                      <Camera className="w-5 h-5" />
                      Take Photo (Image)
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                    </label>
                    <label className="border border-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer flex items-center gap-2">
                      <Upload className="w-5 h-5" />
                      Select Image
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                    </label>
                    <label className="border border-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      Select PDF
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                    </label>
                  </div>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <div>
                <p className="text-red-800 font-medium">Processing Failed</p>
                <p className="text-red-700 text-sm">{error}</p>
                {error.includes('No text could be extracted') && (
                  <p className="text-red-600 text-sm mt-1">
                    Try uploading a clearer image or use the 'Start Over' button above to choose Manual Entry instead.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual Entry Step */}
      {step === 'manual' && (
        <ManualInvoiceEntry
          onComplete={(data) => {
            setExtractedData(data);
            setRawText('Manual entry - no OCR text');
            setConfidence(1.0);
            setStep('review');
          }}
          onBack={() => setStep('method')}
        />
      )}

      {/* Processing Step */}
      {step === 'processing' && (
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <div className="mb-6">
            <Loader2 className="w-16 h-16 text-blue-500 mx-auto mb-4 animate-spin" />
            <h3 className="text-lg font-medium text-gray-800 mb-2">Processing Invoice with AI</h3>
            
            {/* Progress Bar */}
            <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${(processingStage.step / processingStage.total) * 100}%` }}
              />
            </div>
            
            {/* Current Step */}
            <div className="space-y-2">
              <p className="text-blue-600 font-medium">
                Step {processingStage.step} of {processingStage.total}: {processingStage.message}
              </p>
              {processingStage.detail && (
                <p className="text-gray-600 text-sm">{processingStage.detail}</p>
              )}
            </div>
          </div>
          
          {/* Processing Steps Overview */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h4 className="font-medium text-blue-800 mb-3">Processing Steps:</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div className={`flex items-center gap-2 ${processingStage.step >= 1 ? 'text-blue-700' : 'text-gray-500'}`}>
                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-xs ${
                  processingStage.step > 1 ? 'bg-green-500 text-white' : 
                  processingStage.step === 1 ? 'bg-blue-500 text-white' : 'bg-gray-300'
                }`}>
                  {processingStage.step > 1 ? '✓' : '1'}
                </div>
                <span>File preparation</span>
              </div>
              <div className={`flex items-center gap-2 ${processingStage.step >= 2 ? 'text-blue-700' : 'text-gray-500'}`}>
                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-xs ${
                  processingStage.step > 2 ? 'bg-green-500 text-white' : 
                  processingStage.step === 2 ? 'bg-blue-500 text-white' : 'bg-gray-300'
                }`}>
                  {processingStage.step > 2 ? '✓' : '2'}
                </div>
                <span>Authentication</span>
              </div>
              <div className={`flex items-center gap-2 ${processingStage.step >= 3 ? 'text-blue-700' : 'text-gray-500'}`}>
                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-xs ${
                  processingStage.step > 3 ? 'bg-green-500 text-white' : 
                  processingStage.step === 3 ? 'bg-blue-500 text-white' : 'bg-gray-300'
                }`}>
                  {processingStage.step > 3 ? '✓' : '3'}
                </div>
                <span>Text extraction</span>
              </div>
              <div className={`flex items-center gap-2 ${processingStage.step >= 4 ? 'text-blue-700' : 'text-gray-500'}`}>
                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-xs ${
                  processingStage.step > 4 ? 'bg-green-500 text-white' : 
                  processingStage.step === 4 ? 'bg-blue-500 text-white' : 'bg-gray-300'
                }`}>
                  {processingStage.step > 4 ? '✓' : '4'}
                </div>
                <span>AI data analysis</span>
              </div>
            </div>
          </div>
          
          <div className="text-sm text-gray-500">
            This may take 15-45 seconds depending on invoice complexity
          </div>
          
          <div className="mt-6">
            <button
              onClick={() => {
                setIsProcessing(false);
                setStep('upload');
                setProcessingStage({ step: 0, total: 4, message: '', detail: '' });
                setError('Processing was cancelled by user');
              }}
              className="text-gray-600 hover:text-gray-800 text-sm underline"
            >
              Cancel Processing
            </button>
          </div>
        </div>
      )}

      {/* Review Step */}
      {step === 'review' && extractedData && (
        <InvoiceReviewModal
          extractedData={extractedData}
          rawText={rawText}
          confidence={confidence}
          fileName={selectedFile?.name || 'invoice'}
          onComplete={handleReviewComplete}
          onClose={handleStartOver}
        />
      )}
    </div>
  );
};

// Manual Invoice Entry Component
interface ManualInvoiceEntryProps {
  onComplete: (data: InvoiceData) => void;
  onBack: () => void;
}

const ManualInvoiceEntry: React.FC<ManualInvoiceEntryProps> = ({ onComplete, onBack }) => {
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [medicines, setMedicines] = useState<MedicineWithPrice[]>([]);
  const [loading, setLoading] = useState(true);

  const [invoiceInfo, setInvoiceInfo] = useState({
    supplierName: '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    totalAmount: 0
  });

  const [medicineItems, setMedicineItems] = useState([{
    id: 'manual_1',
    medicineName: '',
    quantity: 1,
    unitCostPrice: 0,
    totalCostPrice: 0,
    batchNumber: '',
    expiryDate: '',
    manufacturer: '',
    strength: '',
    packSize: ''
  }]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const clinicId = user?.clinicId;
      const [suppliersData, medicinesData] = await Promise.all([
        pharmacyService.getSuppliers(),
        masterDataService.getMedicines(clinicId)
      ]);
      setSuppliers(suppliersData);
      setMedicines(medicinesData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const addMedicineItem = () => {
    setMedicineItems([...medicineItems, {
      id: `manual_${Date.now()}`,
      medicineName: '',
      quantity: 1,
      unitCostPrice: 0,
      totalCostPrice: 0,
      batchNumber: '',
      expiryDate: '',
      manufacturer: '',
      strength: '',
      packSize: ''
    }]);
  };

  const updateMedicineItem = (index: number, field: string, value: any) => {
    setMedicineItems(prev => prev.map((item, i) => {
      if (i === index) {
        const updatedItem = { ...item, [field]: value };
        
        // Auto-calculate total cost price
        if (field === 'quantity' || field === 'unitCostPrice') {
          updatedItem.totalCostPrice = updatedItem.quantity * updatedItem.unitCostPrice;
        }
        
        return updatedItem;
      }
      return item;
    }));
  };

  const removeMedicineItem = (index: number) => {
    if (medicineItems.length > 1) {
      setMedicineItems(prev => prev.filter((_, i) => i !== index));
    }
  };

  const calculateTotalAmount = () => {
    return medicineItems.reduce((sum, item) => sum + item.totalCostPrice, 0);
  };

  const handleSubmit = () => {
    // Validate required fields
    if (!invoiceInfo.supplierName.trim()) {
      alert('Please enter supplier name');
      return;
    }

    if (!invoiceInfo.invoiceNumber.trim()) {
      alert('Please enter invoice number');
      return;
    }

    const validItems = medicineItems.filter(item => 
      item.medicineName.trim() && item.quantity > 0 && item.unitCostPrice > 0
    );

    if (validItems.length === 0) {
      alert('Please add at least one valid medicine item');
      return;
    }

    // Create the data structure expected by InvoiceReviewModal
    const data: InvoiceData = {
      invoiceInfo: {
        supplierName: invoiceInfo.supplierName,
        invoiceNumber: invoiceInfo.invoiceNumber,
        invoiceDate: invoiceInfo.invoiceDate,
        totalAmount: calculateTotalAmount()
      },
      medicines: validItems.map(item => ({
        medicineName: item.medicineName,
        quantity: item.quantity,
        unitCostPrice: item.unitCostPrice,
        totalCostPrice: item.totalCostPrice,
        batchNumber: item.batchNumber || null,
        expiryDate: item.expiryDate || null,
        manufacturer: item.manufacturer || null,
        strength: item.strength || null,
        packSize: item.packSize || null
      }))
    };

    onComplete(data);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading suppliers and medicines...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">Manual Invoice Entry</h3>
        <button
          onClick={onBack}
          className="text-blue-600 hover:text-blue-700 text-sm"
        >
          ← Back to method selection
        </button>
      </div>

      {/* Invoice Information */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-800 mb-4">Invoice Information</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Name *</label>
            <input
              type="text"
              list="suppliers-list"
              required
              value={invoiceInfo.supplierName}
              onChange={(e) => setInvoiceInfo({ ...invoiceInfo, supplierName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter or select supplier"
            />
            <datalist id="suppliers-list">
              {suppliers.map(supplier => (
                <option key={supplier.id} value={supplier.name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Number *</label>
            <input
              type="text"
              required
              value={invoiceInfo.invoiceNumber}
              onChange={(e) => setInvoiceInfo({ ...invoiceInfo, invoiceNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter invoice number"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Date *</label>
            <input
              type="date"
              required
              value={invoiceInfo.invoiceDate}
              onChange={(e) => setInvoiceInfo({ ...invoiceInfo, invoiceDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount (₹)</label>
            <input
              type="number"
              value={calculateTotalAmount()}
              readOnly
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
            />
          </div>
        </div>
      </div>

      {/* Medicine Items */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-medium text-gray-800">Medicine Items</h4>
          <button
            onClick={addMedicineItem}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Item
          </button>
        </div>

        <div className="space-y-4">
          {medicineItems.map((item, index) => (
            <div key={item.id} className="border border-gray-200 rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Medicine Name *</label>
                  <input
                    type="text"
                    list={`medicines-list-${index}`}
                    required
                    value={item.medicineName}
                    onChange={(e) => updateMedicineItem(index, 'medicineName', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter or select medicine"
                  />
                  <datalist id={`medicines-list-${index}`}>
                    {medicines.map(medicine => (
                      <option key={medicine.id} value={medicine.name} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={item.quantity}
                    onChange={(e) => updateMedicineItem(index, 'quantity', parseInt(e.target.value) || 0)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Unit Cost (₹) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={item.unitCostPrice}
                    onChange={(e) => updateMedicineItem(index, 'unitCostPrice', parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div className="flex items-end">
                  <div className="w-full">
                    <label className="block text-xs text-gray-600 mb-1">Total (₹)</label>
                    <input
                      type="number"
                      value={item.totalCostPrice}
                      readOnly
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50"
                    />
                  </div>
                  {medicineItems.length > 1 && (
                    <button
                      onClick={() => removeMedicineItem(index)}
                      className="ml-2 p-1 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Additional Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Batch Number</label>
                  <input
                    type="text"
                    value={item.batchNumber}
                    onChange={(e) => updateMedicineItem(index, 'batchNumber', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={item.expiryDate}
                    onChange={(e) => updateMedicineItem(index, 'expiryDate', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Manufacturer</label>
                  <input
                    type="text"
                    value={item.manufacturer}
                    onChange={(e) => updateMedicineItem(index, 'manufacturer', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Strength</label>
                  <input
                    type="text"
                    value={item.strength}
                    onChange={(e) => updateMedicineItem(index, 'strength', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., 500mg"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Total Summary */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex justify-between items-center">
          <span className="text-lg font-semibold text-gray-800">Total Invoice Amount:</span>
          <span className="text-xl font-bold text-blue-600">₹{calculateTotalAmount().toLocaleString()}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        <button
          onClick={onBack}
          className="px-6 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleSubmit}
          className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <CheckCircle className="w-4 h-4" />
          Continue to Review
        </button>
      </div>
    </div>
  );
};

export default InvoiceUpload;