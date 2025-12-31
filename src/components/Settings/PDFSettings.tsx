import React, { useState, useEffect } from 'react';
import { Upload, X, FileImage, Save, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../Auth/useAuth';
import toast from 'react-hot-toast';

interface PDFSettingsProps {
    clinicId: string;
}

export const PDFSettings: React.FC<PDFSettingsProps> = ({ clinicId }) => {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [uploadingHeader, setUploadingHeader] = useState(false);
    const [uploadingFooter, setUploadingFooter] = useState(false);

    const [settings, setSettings] = useState({
        pdfHeaderUrl: '',
        pdfFooterUrl: '',
        pdfMargins: '180px 20px 150px 20px',
    });

    // Load current settings
    useEffect(() => {
        loadSettings();
    }, [clinicId]);

    const loadSettings = async () => {
        try {
            const { data, error } = await supabase
                .from('clinic_settings')
                .select('pdf_header_url, pdf_footer_url, pdf_margins')
                .eq('id', clinicId)
                .single();

            if (error) throw error;

            if (data) {
                setSettings({
                    pdfHeaderUrl: data.pdf_header_url || '',
                    pdfFooterUrl: data.pdf_footer_url || '',
                    pdfMargins: data.pdf_margins || '180px 20px 150px 20px',
                });
            }
        } catch (error) {
            console.error('Error loading PDF settings:', error);
        }
    };

    const handleFileUpload = async (file: File, type: 'header' | 'footer') => {
        try {
            const setUploading = type === 'header' ? setUploadingHeader : setUploadingFooter;
            setUploading(true);

            // Validate file
            if (!file.type.startsWith('image/')) {
                toast.error('Please upload an image file');
                return;
            }

            if (file.size > 5 * 1024 * 1024) {
                toast.error('File size must be less than 5MB');
                return;
            }

            // Create unique filename
            const fileExt = file.name.split('.').pop();
            const fileName = `${clinicId}_${type}_${Date.now()}.${fileExt}`;
            const filePath = `clinic-pdf-assets/${clinicId}/${fileName}`;

            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('pdf-assets')
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: true
                });

            if (uploadError) throw uploadError;

            // Get public URL (temporary, will be replaced by ImageKit)
            const { data: { publicUrl } } = supabase.storage
                .from('pdf-assets')
                .getPublicUrl(filePath);

            // Update local state with temporary URL
            setSettings(prev => ({
                ...prev,
                [type === 'header' ? 'pdfHeaderUrl' : 'pdfFooterUrl']: publicUrl
            }));

            toast.success(`${type === 'header' ? 'Header' : 'Footer'} image uploaded. Processing...`);

            // Trigger ImageKit processing in background
            try {
                const { data: { session } } = await supabase.auth.getSession();

                const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/imagekit-process`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${session?.access_token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        assetId: clinicId,
                        assetType: type,
                        storagePath: filePath
                    })
                });

                if (!response.ok) {
                    throw new Error('ImageKit processing failed');
                }

                const result = await response.json();

                // Update with optimized ImageKit URL
                if (result.success && result.optimizedUrl) {
                    setSettings(prev => ({
                        ...prev,
                        [type === 'header' ? 'pdfHeaderUrl' : 'pdfFooterUrl']: result.optimizedUrl
                    }));

                    toast.success(`Image optimized successfully!`);
                }
            } catch (imagekitError) {
                console.error('ImageKit processing error:', imagekitError);
                // Image is still uploaded to Supabase, just not optimized
                toast('Image uploaded (optimization pending)', { icon: '⚠️' });
            }

        } catch (error) {
            console.error('Upload error:', error);
            toast.error('Failed to upload image');
        } finally {
            const setUploading = type === 'header' ? setUploadingHeader : setUploadingFooter;
            setUploading(false);
        }
    };

    const handleRemoveImage = (type: 'header' | 'footer') => {
        setSettings(prev => ({
            ...prev,
            [type === 'header' ? 'pdfHeaderUrl' : 'pdfFooterUrl']: ''
        }));
    };

    const handleSave = async () => {
        try {
            setLoading(true);

            const { error } = await supabase
                .from('clinic_settings')
                .update({
                    pdf_header_url: settings.pdfHeaderUrl,
                    pdf_footer_url: settings.pdfFooterUrl,
                    pdf_margins: settings.pdfMargins,
                })
                .eq('id', clinicId);

            if (error) throw error;

            toast.success('PDF settings saved successfully');
        } catch (error) {
            console.error('Save error:', error);
            toast.error('Failed to save settings');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
                <FileImage className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold">PDF Settings</h3>
            </div>

            <p className="text-sm text-gray-600 mb-6">
                Add custom header and footer images to your prescription/visit PDFs. These will appear on every page.
            </p>

            {/* PDF Margins */}
            <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    PDF Margins (Top Right Bottom Left)
                </label>
                <input
                    type="text"
                    value={settings.pdfMargins}
                    onChange={(e) => setSettings(prev => ({ ...prev, pdfMargins: e.target.value }))}
                    placeholder="180px 20px 150px 20px"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                    Default: 180px 20px 150px 20px (provides space for header and footer)
                </p>
            </div>

            {/* Header Image Upload */}
            <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Header Image
                </label>

                {settings.pdfHeaderUrl ? (
                    <div className="relative border-2 border-gray-200 rounded-lg p-4 bg-gray-50">
                        <img
                            src={settings.pdfHeaderUrl}
                            alt="Header"
                            className="max-h-24 mx-auto"
                        />
                        <button
                            onClick={() => handleRemoveImage('header')}
                            className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                ) : (
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                        <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                        <p className="text-sm text-gray-600 mb-2">Click to upload header image</p>
                        <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'header')}
                            className="hidden"
                            id="header-upload"
                            disabled={uploadingHeader}
                        />
                        <label
                            htmlFor="header-upload"
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer disabled:bg-gray-400"
                        >
                            {uploadingHeader ? 'Uploading...' : 'Choose File'}
                        </label>
                    </div>
                )}
            </div>

            {/* Footer Image Upload */}
            <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Footer Image
                </label>

                {settings.pdfFooterUrl ? (
                    <div className="relative border-2 border-gray-200 rounded-lg p-4 bg-gray-50">
                        <img
                            src={settings.pdfFooterUrl}
                            alt="Footer"
                            className="max-h-20 mx-auto"
                        />
                        <button
                            onClick={() => handleRemoveImage('footer')}
                            className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                ) : (
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                        <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                        <p className="text-sm text-gray-600 mb-2">Click to upload footer image</p>
                        <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'footer')}
                            className="hidden"
                            id="footer-upload"
                            disabled={uploadingFooter}
                        />
                        <label
                            htmlFor="footer-upload"
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer disabled:bg-gray-400"
                        >
                            {uploadingFooter ? 'Uploading...' : 'Choose File'}
                        </label>
                    </div>
                )}
            </div>

            {/* Tips */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                <div className="flex gap-2">
                    <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-800">
                        <p className="font-medium mb-1">Tip: For best results, use images with:</p>
                        <ul className="list-disc list-inside space-y-1">
                            <li>Width: 800-1000 pixels</li>
                            <li>Height: 100-150 pixels for header, 80-100 pixels for footer</li>
                            <li>Format: PNG with transparent background</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Save Button */}
            <button
                onClick={handleSave}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
                <Save className="w-4 h-4" />
                {loading ? 'Saving...' : 'Save PDF Settings'}
            </button>
        </div>
    );
};
