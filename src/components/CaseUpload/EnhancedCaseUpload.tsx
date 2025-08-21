import React, { useState } from 'react';
import { Upload, Camera, FileText, Loader2, CheckCircle, AlertCircle, RefreshCw, Scan } from 'lucide-react';
import { processCasePaperWithAI } from '../../services/ocrService';
import { OCRResult } from '../../types';
import EMRForm from './EMRForm';
import DocumentScanner from '../ScanbotScanner/DocumentScanner';

const EnhancedCaseUpload: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [step, setStep] = useState<'method' | 'upload' | 'scan' | 'processing' | 'review' | 'emr'>('method');
  const [processingError, setProcessingError] = useState<string | null>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setProcessingError(null);
    }
  };

  const handleScannedImage = (scannedBlob: Blob) => {
    // Convert blob to File object
    const scannedFile = new File([scannedBlob], `scanned-document-${Date.now()}.jpg`, {
      type: 'image/jpeg'
    });
    setSelectedFile(scannedFile);
    setStep('processing');
    processImage(scannedFile);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setStep('processing');
    await processImage(selectedFile);
  };

  const processImage = async (file: File) => {
    setIsProcessing(true);
    setProcessingError(null);

    try {
      const result = await processCasePaperWithAI(file);
      
      if (result.confidence === 0) {
        setProcessingError(result.rawText);
        setStep('upload');
        return;
      }
      
      setOcrResult(result);
      setStep('review');
    } catch (error) {
      console.error('OCR processing failed:', error);
      setProcessingError(error instanceof Error ? error.message : 'An unexpected error occurred during processing');
      setStep('upload');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProceedToEMR = () => {
    setStep('emr');
  };

  const handleStartOver = () => {
    setSelectedFile(null);
    setOcrResult(null);
    setStep('method');
    setProcessingError(null);
  };

  const handleRetryUpload = () => {
    setProcessingError(null);
    if (selectedFile) {
      handleUpload();
    }
  };

  const handleMethodSelection = (method: 'upload' | 'scan') => {
    setStep(method);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Enhanced Case Paper Upload</h2>
        {step !== 'method' && (
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
        {['Method', 'Capture/Upload', 'Processing', 'Review', 'EMR'].map((stepName, index) => {
          const stepValue = ['method', step === 'scan' ? 'scan' : 'upload', 'processing', 'review', 'emr'][index];
          const isActive = step === stepValue;
          const isCompleted = ['method', step === 'scan' ? 'scan' : 'upload', 'processing', 'review', 'emr'].indexOf(step) > index;
          
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
              {index < 4 && <div className="w-8 h-px bg-gray-300 mx-4" />}
            </div>
          );
        })}
      </div>

      {/* Error Display */}
      {processingError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-lg font-medium text-red-800 mb-2">Processing Failed</h3>
              <p className="text-red-700 mb-4">{processingError}</p>
              <div className="flex gap-3">
                <button
                  onClick={handleRetryUpload}
                  disabled={!selectedFile}
                  className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try Again
                </button>
                <button
                  onClick={handleStartOver}
                  className="px-4 py-2 text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Select Different Method
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Method Selection */}
      {step === 'method' && (
        <div className="space-y-6">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">How would you like to capture the case paper?</h3>
            <p className="text-gray-600">Choose your preferred method for capturing the document</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <button
              onClick={() => handleMethodSelection('scan')}
              className="p-8 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors group"
            >
              <div className="text-center space-y-4">
                <Scan className="w-16 h-16 text-gray-400 group-hover:text-blue-500 mx-auto transition-colors" />
                <div>
                  <h4 className="text-lg font-medium text-gray-800">Document Scanner</h4>
                  <p className="text-gray-600">Use advanced scanning with automatic enhancement</p>
                  <p className="text-sm text-blue-600 mt-2">✨ Recommended for best quality</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => handleMethodSelection('upload')}
              className="p-8 border-2 border-dashed border-gray-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors group"
            >
              <div className="text-center space-y-4">
                <Camera className="w-16 h-16 text-gray-400 group-hover:text-green-500 mx-auto transition-colors" />
                <div>
                  <h4 className="text-lg font-medium text-gray-800">Simple Upload</h4>
                  <p className="text-gray-600">Take photo or select existing image</p>
                  <p className="text-sm text-green-600 mt-2">Quick and easy method</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Document Scanner */}
      {step === 'scan' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <DocumentScanner
            onImageScanned={handleScannedImage}
            onClose={() => setStep('method')}
          />
        </div>
      )}

      {/* Simple Upload */}
      {step === 'upload' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Upload Case Paper</h3>
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
                    <p className="text-lg font-medium text-gray-800">File Selected</p>
                    <p className="text-gray-600">{selectedFile.name}</p>
                  </div>
                  <button
                    onClick={handleUpload}
                    disabled={isProcessing}
                    className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 mx-auto disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    <FileText className="w-5 h-5" />
                    {isProcessing ? 'Processing...' : 'Process with OCR'}
                  </button>
                </>
              ) : (
                <>
                  <Upload className="w-16 h-16 text-gray-400 mx-auto" />
                  <div>
                    <p className="text-lg font-medium text-gray-800">Upload Case Paper</p>
                    <p className="text-gray-600">Take a photo or select an image of the handwritten case paper</p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <label className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors cursor-pointer flex items-center gap-2">
                      <Camera className="w-5 h-5" />
                      Take Photo
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
                      Select File
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                    </label>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Processing */}
      {step === 'processing' && (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <Loader2 className="w-16 h-16 text-blue-500 mx-auto mb-4 animate-spin" />
          <h3 className="text-lg font-medium text-gray-800 mb-2">Processing Case Paper with AI</h3>
          <p className="text-gray-600 mb-2">Step 1: Extracting text from image...</p>
          <p className="text-gray-600">Step 2: Analyzing medical content with AI...</p>
          <div className="mt-4 text-sm text-gray-500">
            This may take 10-30 seconds depending on image complexity
          </div>
          <div className="mt-6">
            <button
              onClick={() => {
                setIsProcessing(false);
                setStep('method');
                setProcessingError('Processing was cancelled by user');
              }}
              className="text-gray-600 hover:text-gray-800 text-sm underline"
            >
              Cancel Processing
            </button>
          </div>
        </div>
      )}

      {/* Review */}
      {step === 'review' && ocrResult && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Raw OCR Output</h3>
            <div className="bg-gray-50 p-4 rounded-lg">
              <pre className="text-sm text-gray-700 whitespace-pre-wrap">{ocrResult.rawText}</pre>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Extracted Medical Data</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Symptoms</h4>
                <ul className="list-disc list-inside text-sm text-gray-600">
                  {ocrResult.extractedData.symptoms.map((symptom, index) => (
                    <li key={index}>{symptom}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-medium text-gray-700 mb-2">Vitals</h4>
                <div className="text-sm text-gray-600 space-y-1">
                  {Object.entries(ocrResult.extractedData.vitals).map(([key, value]) => (
                    <div key={key}>
                      <strong className="capitalize">{key}:</strong> {value}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-medium text-gray-700 mb-2">Diagnosis</h4>
                <ul className="list-disc list-inside text-sm text-gray-600">
                  {ocrResult.extractedData.diagnoses.map((diagnosis, index) => (
                    <li key={index}>{diagnosis}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-medium text-gray-700 mb-2">Prescriptions</h4>
                <ul className="list-disc list-inside text-sm text-gray-600">
                  {ocrResult.extractedData.prescriptions.map((prescription, index) => (
                    <li key={index}>{prescription}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-6">
              <h4 className="font-medium text-gray-700 mb-2">Advice</h4>
              <ul className="list-disc list-inside text-sm text-gray-600">
                {ocrResult.extractedData.advice.map((advice, index) => (
                  <li key={index}>{advice}</li>
                ))}
              </ul>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={handleProceedToEMR}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create EMR Entry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EMR */}
      {step === 'emr' && ocrResult && (
        <EMRForm ocrData={ocrResult.extractedData} />
      )}
    </div>
  );
};

export default EnhancedCaseUpload;