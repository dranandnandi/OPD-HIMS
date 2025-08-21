import React, { useState, useEffect, useRef } from 'react';
import { Camera, FileText, Loader2, CheckCircle, AlertCircle, Download, Scan } from 'lucide-react';

const LICENSE_KEY =
  "C63dABqY8UapVXDCTiW77CRn7p4bMi" +
  "tJvYkntfdnr9nv/ehsLke9JbaaPVRi" +
  "4ATrju4WzJXWu03WtGET5KKhtUPBvm" +
  "4h3BiuJYlcLf1FoxQ0sgtxB/PaGc+9" +
  "iln1dKDzvYHi0uonxVCYoM9UWtHwAS" +
  "Fv47Ws+v98tsnL8O0YWemvmUTN4i8C" +
  "d/FiXYfR+H7aLJIoKOedlEutYv2nh/" +
  "E1Q/ndFMj8w/+UPyWNB8/QZein8wjJ" +
  "KYPbTqeNDoT2tSAQDEh81M3wfo8nsn" +
  "Sq3O9AXq7v8E8R2+rb+HC9Ng8YBHC8" +
  "ebt7nxEVHXyl3Fz1lA16CvvvasyKpM" +
  "L08Soqw/bb5g==U2NhbmJvdFNESwps" +
  "b2NhbGhvc3R8ZG9jcHJlbmV1ci5hY2" +
  "FkZW15CjE3NTQzNTE5OTkKODM4ODYw" +
  "Nwo4";

// Extend Window interface to include ScanbotSDK
declare global {
  interface Window {
    ScanbotSDK: any;
  }
}

interface DocumentScannerProps {
  onImageScanned?: (scannedImageBlob: Blob) => void;
  onClose?: () => void;
}

const DocumentScanner: React.FC<DocumentScannerProps> = ({ onImageScanned, onClose }) => {
  const [sdkInitialized, setSdkInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scannedImages, setScannedImages] = useState<string[]>([]);
  const scannerContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sdk, setSdk] = useState<any>(null);

  useEffect(() => {
    initializeScanbot();
  }, []);

  const initializeScanbot = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check if ScanbotSDK is available from CDN
      if (!window.ScanbotSDK) {
        throw new Error('Scanbot SDK not loaded from CDN. Please check your internet connection.');
      }

      if (import.meta.env.DEV) {
        console.log('🔍 Scanbot SDK found on window object');
      }

      // Initialize the SDK
      const sdkInstance = await window.ScanbotSDK.initialize({
        licenseKey: LICENSE_KEY,
        engine: {
          wasm: '/engine/scanbot-sdk-wasm.js',
          wasmModule: '/engine/scanbot-sdk-wasm.wasm',
        },
        logging: {
          level: 'info'
        }
      });

      setSdk(sdkInstance);
      setSdkInitialized(true);
      if (import.meta.env.DEV) {
        console.log('✅ Scanbot SDK initialized successfully', sdkInstance);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('❌ Failed to initialize Scanbot SDK:', err);
      }
      setError(err instanceof Error ? err.message : 'Failed to initialize document scanner');
    } finally {
      setLoading(false);
    }
  };

  const startDocumentScanner = async () => {
    if (!sdk || !scannerContainerRef.current) {
      setError('SDK not initialized or container not available');
      return;
    }

    try {
      setScanning(true);
      setError(null);

      if (import.meta.env.DEV) {
        console.log('🚀 Starting document scanner...');
      }

      // Create the document scanner UI
      const result = await sdk.createDocumentScanner({
        containerId: scannerContainerRef.current.id,
        onDocumentDetected: (detectionResult: any) => {
          if (import.meta.env.DEV) {
            console.log('📄 Document detected:', detectionResult);
          }
        },
        style: {
          window: {
            width: '100%',
            height: '500px'
          }
        }
      });

      if (import.meta.env.DEV) {
        console.log('📸 Scanning completed:', result);
      }

      if (result && result.pages && result.pages.length > 0) {
        // Convert base64 images to blobs and store them
        const imageUrls: string[] = [];
        
        for (const page of result.pages) {
          // Convert base64 to blob
          const blob = await base64ToBlob(page, 'image/jpeg');
          const imageUrl = URL.createObjectURL(blob);
          imageUrls.push(imageUrl);
          
          // Call the callback with the first scanned image
          if (onImageScanned && imageUrls.length === 1) {
            onImageScanned(blob);
          }
        }
        
        setScannedImages(imageUrls);
        if (import.meta.env.DEV) {
          console.log(`✅ Successfully processed ${result.pages.length} page(s)`);
        }
      } else {
        setError('No pages were scanned. Please try again.');
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('❌ Error during document scanning:', err);
      }
      setError(err instanceof Error ? err.message : 'Failed to scan document');
    } finally {
      setScanning(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !sdk) return;

    try {
      setLoading(true);
      setError(null);

      // Convert file to base64
      const base64 = await fileToBase64(file);
      
      // Process the uploaded image with Scanbot SDK
      const image = await sdk.imageUtils.loadImage(base64);
      const detectionResult = await sdk.documentDetector.detectDocument(image);
      
      if (detectionResult.polygon && detectionResult.polygon.length > 0) {
        // Crop and enhance the document
        const croppedImage = await sdk.imageUtils.cropAndWarpImage(image, detectionResult.polygon);
        const filteredImage = await sdk.imageFilters.applyFilter(croppedImage, 'BINARIZED');
        
        // Convert back to blob
        const processedBase64 = await sdk.imageUtils.toBase64(filteredImage, 'image/jpeg', 0.9);
        const processedBlob = await base64ToBlob(processedBase64, 'image/jpeg');
        
        // Set preview and call callback
        const previewUrl = URL.createObjectURL(processedBlob);
        setScannedImages([previewUrl]);
        
        if (onImageScanned) {
          onImageScanned(processedBlob);
        }
        
        if (import.meta.env.DEV) {
          console.log('✅ File processed successfully');
        }
      } else {
        setError('No document detected in the uploaded image. Please try a clearer image.');
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('❌ Error processing uploaded file:', err);
      }
      setError('Failed to process uploaded image');
    } finally {
      setLoading(false);
    }
  };

  const base64ToBlob = (base64: string, mimeType: string): Promise<Blob> => {
    return new Promise((resolve) => {
      // Remove data URL prefix if present
      const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      resolve(new Blob([byteArray], { type: mimeType }));
    });
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]); // Remove data URL prefix
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const downloadScannedImage = (imageUrl: string, index: number) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `scanned-document-${index + 1}-${Date.now()}.jpg`;
    link.click();
  };

  const resetScanner = () => {
    setScannedImages([]);
    setError(null);
    setScanning(false);
  };

  if (loading && !sdkInitialized) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-spin" />
          <h3 className="text-lg font-medium text-gray-800 mb-2">Initializing Document Scanner</h3>
          <p className="text-gray-600">Loading Scanbot SDK from CDN...</p>
        </div>
      </div>
    );
  }

  if (error && !sdkInitialized) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-800 mb-2">Scanner Initialization Failed</h3>
          <p className="text-red-600 mb-4">{error}</p>
          <div className="space-y-2 text-sm text-gray-600 mb-4">
            <p>Please ensure:</p>
            <ul className="list-disc list-inside space-y-1 text-left">
              <li>Internet connection is available (for CDN script)</li>
              <li>Engine files are in <code>/public/engine/</code>:</li>
              <li className="ml-4"><code>scanbot-sdk-wasm.js</code></li>
              <li className="ml-4"><code>scanbot-sdk-wasm.wasm</code></li>
            </ul>
          </div>
          <button
            onClick={initializeScanbot}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Retry Initialization
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Scanbot Document Scanner</h3>
          <p className="text-gray-600">Professional document scanning with automatic enhancement</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-800 text-xl font-bold"
          >
            ×
          </button>
        )}
      </div>

      {/* Status Indicator */}
      <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
        <CheckCircle className="w-5 h-5 text-green-600" />
        <span className="text-green-700 font-medium">Scanbot SDK Ready</span>
        <span className="text-green-600 text-sm">• Professional scanning enabled</span>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Scanning Interface */}
      {scannedImages.length === 0 && (
        <div className="space-y-4">
          {/* Scanner Container */}
          <div 
            id="scanbot-scanner-container" 
            ref={scannerContainerRef}
            className="w-full h-96 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center"
          >
            {scanning ? (
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-blue-600 mx-auto mb-2 animate-spin" />
                <p className="text-gray-600">Scanner is active...</p>
              </div>
            ) : (
              <div className="text-center">
                <Scan className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">Scanner will appear here</p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={startDocumentScanner}
              disabled={!sdkInitialized || scanning}
              className="flex items-center justify-center gap-3 p-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Camera className="w-8 h-8 text-gray-400" />
              <div className="text-left">
                <h4 className="font-medium text-gray-800">Start Scanner</h4>
                <p className="text-sm text-gray-600">Launch professional document scanner</p>
              </div>
            </button>

            <label className="flex items-center justify-center gap-3 p-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors cursor-pointer">
              <FileText className="w-8 h-8 text-gray-400" />
              <div className="text-left">
                <h4 className="font-medium text-gray-800">Upload & Process</h4>
                <p className="text-sm text-gray-600">Select image and enhance it</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
                disabled={!sdkInitialized}
              />
            </label>
          </div>

          {/* Instructions */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-medium text-blue-800 mb-2">📋 How to use:</h4>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• <strong>Start Scanner</strong>: Opens professional camera interface with automatic document detection</li>
              <li>• <strong>Upload & Process</strong>: Select existing image and apply document enhancement</li>
              <li>• <strong>Automatic Enhancement</strong>: Applies perspective correction and binarization for better OCR</li>
              <li>• <strong>Multiple Pages</strong>: Can scan multiple pages in one session</li>
            </ul>
          </div>
        </div>
      )}

      {/* Scanned Images Preview */}
      {scannedImages.length > 0 && (
        <div className="space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-medium text-gray-800">
                Scanned Documents ({scannedImages.length})
              </h4>
              <button
                onClick={resetScanner}
                className="text-blue-600 hover:text-blue-700 text-sm"
              >
                Scan More
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {scannedImages.map((imageUrl, index) => (
                <div key={index} className="space-y-2">
                  <img
                    src={imageUrl}
                    alt={`Scanned document ${index + 1}`}
                    className="w-full max-h-64 object-contain rounded-lg border border-gray-300 bg-white"
                  />
                  <button
                    onClick={() => downloadScannedImage(imageUrl, index)}
                    className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download Page {index + 1}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="text-green-700 font-medium">
                Document(s) processed successfully! 
                {onImageScanned && " The enhanced image has been sent for OCR processing."}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentScanner;