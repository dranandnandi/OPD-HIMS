import React, { useState, useEffect } from 'react';
import { Upload, X, FileImage, Save, AlertCircle, LayoutPanelTop, FileText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../Auth/useAuth';
import type { PdfLetterheadMode, PdfLetterheadSpacing } from '../../types';
import toast from 'react-hot-toast';

interface PDFSettingsProps {
    clinicId: string;
}

const A4_INVOICE_MARGINS = '180px 20px 150px 20px';
const A5_INVOICE_MARGINS = '50px 10px 34px 10px';

const DEFAULT_LETTERHEAD_SPACING: PdfLetterheadSpacing = { top: 130, bottom: 130, left: 20, right: 20 };

// The full-page letterhead is fetched by PDF.co over the network rather than
// inlined into a command-line argument, so it is not bound by the band images'
// 128KB budget. A4 at 150dpi is the sweet spot: sharp in print, and roughly 6x
// smaller (and noticeably faster to render) than a 300dpi PNG.
const FULL_LETTERHEAD_WIDTH = 1240;
const FULL_LETTERHEAD_HEIGHT = 1754;
const FULL_LETTERHEAD_TARGET_BYTES = 400 * 1024;

// Letterheads are inlined as base64 into the PDF.co header/footer, which is
// passed to its renderer as a command-line argument capped at 128KB. Downscale
// on upload so the encoded image stays well inside that budget — otherwise the
// PDF falls back to a plain text band. 1000px is ample for a 120px print band.
const LETTERHEAD_MAX_WIDTH = 1000;
const LETTERHEAD_TARGET_BYTES = 60 * 1024;

const downscaleLetterhead = (file: File): Promise<Blob> =>
    new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);

            const scale = Math.min(1, LETTERHEAD_MAX_WIDTH / img.width);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);

            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Canvas unavailable'));

            // Letterheads print onto white paper, so flatten any transparency
            // rather than letting it encode as black.
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // Step the quality down until it fits the budget.
            const qualities = [0.85, 0.7, 0.55, 0.4];
            const tryQuality = (i: number) => {
                canvas.toBlob(
                    (blob) => {
                        if (!blob) return reject(new Error('Encoding failed'));
                        if (blob.size <= LETTERHEAD_TARGET_BYTES || i === qualities.length - 1) {
                            resolve(blob);
                        } else {
                            tryQuality(i + 1);
                        }
                    },
                    'image/jpeg',
                    qualities[i]
                );
            };
            tryQuality(0);
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Could not read image'));
        };

        img.src = objectUrl;
    });

// Forces the artwork onto an exact A4 canvas. The PDF paints it with
// `background-size: 210mm 297mm`, so anything that is not already A4 ratio would
// otherwise be stretched at render time — better to make that visible here, on
// upload, than to have it surprise the clinic on a printed prescription.
const normalizeFullLetterhead = (file: File): Promise<Blob> =>
    new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);

            const canvas = document.createElement('canvas');
            canvas.width = FULL_LETTERHEAD_WIDTH;
            canvas.height = FULL_LETTERHEAD_HEIGHT;

            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Canvas unavailable'));

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const qualities = [0.9, 0.8, 0.7, 0.55];
            const tryQuality = (i: number) => {
                canvas.toBlob(
                    (blob) => {
                        if (!blob) return reject(new Error('Encoding failed'));
                        if (blob.size <= FULL_LETTERHEAD_TARGET_BYTES || i === qualities.length - 1) {
                            resolve(blob);
                        } else {
                            tryQuality(i + 1);
                        }
                    },
                    'image/jpeg',
                    qualities[i]
                );
            };
            tryQuality(0);
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Could not read image'));
        };

        img.src = objectUrl;
    });

export const PDFSettings: React.FC<PDFSettingsProps> = ({ clinicId }) => {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [uploadingHeader, setUploadingHeader] = useState(false);
    const [uploadingFooter, setUploadingFooter] = useState(false);
    const [uploadingLetterhead, setUploadingLetterhead] = useState(false);
    // The full-letterhead columns arrive in a later migration than the band
    // ones. If they are not there yet, that half of the screen goes read-only
    // instead of taking the whole panel down with it.
    const [letterheadSupported, setLetterheadSupported] = useState(true);

    const [settings, setSettings] = useState({
        pdfHeaderUrl: '',
        pdfFooterUrl: '',
        pdfMargins: A4_INVOICE_MARGINS,
        invoicePaperSize: 'A4' as 'A4' | 'A5',
        invoiceMargins: A4_INVOICE_MARGINS,
        letterheadMode: 'bands' as PdfLetterheadMode,
        letterheadUrl: '',
        letterheadSpacing: { ...DEFAULT_LETTERHEAD_SPACING } as PdfLetterheadSpacing,
    });

    const isFullMode = settings.letterheadMode === 'full';

    // Load current settings
    useEffect(() => {
        loadSettings();
    }, [clinicId]);

    const loadSettings = async () => {
        try {
            const { data, error } = await supabase
                .from('clinic_settings')
                .select('pdf_header_url, pdf_footer_url, pdf_margins, invoice_paper_size, invoice_margins')
                .eq('id', clinicId)
                .single();

            if (error) throw error;

            if (data) {
                setSettings(prev => ({
                    ...prev,
                    pdfHeaderUrl: data.pdf_header_url || '',
                    pdfFooterUrl: data.pdf_footer_url || '',
                    pdfMargins: data.pdf_margins || A4_INVOICE_MARGINS,
                    invoicePaperSize: data.invoice_paper_size || 'A4',
                    invoiceMargins: data.invoice_margins || (data.invoice_paper_size === 'A5' ? A5_INVOICE_MARGINS : A4_INVOICE_MARGINS),
                }));
            }
        } catch (error) {
            console.error('Error loading PDF settings:', error);
        }

        // Queried separately so a missing column cannot break the load above.
        try {
            const { data, error } = await supabase
                .from('clinic_settings')
                .select('pdf_letterhead_mode, pdf_letterhead_url, pdf_letterhead_spacing')
                .eq('id', clinicId)
                .single();

            if (error) throw error;

            const saved = data?.pdf_letterhead_spacing || {};
            setSettings(prev => ({
                ...prev,
                letterheadMode: data?.pdf_letterhead_mode === 'full' ? 'full' : 'bands',
                letterheadUrl: data?.pdf_letterhead_url || '',
                letterheadSpacing: {
                    top: Number(saved.top ?? DEFAULT_LETTERHEAD_SPACING.top),
                    bottom: Number(saved.bottom ?? DEFAULT_LETTERHEAD_SPACING.bottom),
                    left: Number(saved.left ?? DEFAULT_LETTERHEAD_SPACING.left),
                    right: Number(saved.right ?? DEFAULT_LETTERHEAD_SPACING.right),
                },
            }));
            setLetterheadSupported(true);
        } catch (error) {
            console.warn('Full-letterhead columns unavailable — feature disabled:', error);
            setLetterheadSupported(false);
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

            // Shrink before upload so the letterhead can be inlined into the PDF
            const resized = await downscaleLetterhead(file);
            console.log(
                `[PDF Settings] ${type}: ${(file.size / 1024).toFixed(0)}KB → ${(resized.size / 1024).toFixed(0)}KB`
            );

            // Create unique filename
            const fileName = `${clinicId}_${type}_${Date.now()}.jpg`;
            const filePath = `clinic-pdf-assets/${clinicId}/${fileName}`;

            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('pdf-assets')
                .upload(filePath, resized, {
                    contentType: 'image/jpeg',
                    cacheControl: '3600',
                    upsert: true
                });

            if (uploadError) throw uploadError;

            // The pdf-assets bucket is public, so this URL is directly fetchable
            // by PDF.co's renderer — no CDN round-trip needed.
            const { data: { publicUrl } } = supabase.storage
                .from('pdf-assets')
                .getPublicUrl(filePath);

            setSettings(prev => ({
                ...prev,
                [type === 'header' ? 'pdfHeaderUrl' : 'pdfFooterUrl']: publicUrl
            }));

            toast.success(`${type === 'header' ? 'Header' : 'Footer'} image uploaded`);

        } catch (error) {
            console.error('Upload error:', error);
            toast.error('Failed to upload image');
        } finally {
            const setUploading = type === 'header' ? setUploadingHeader : setUploadingFooter;
            setUploading(false);
        }
    };

    const handleLetterheadUpload = async (file: File) => {
        try {
            setUploadingLetterhead(true);

            if (!file.type.startsWith('image/')) {
                toast.error('Please upload an image file');
                return;
            }

            if (file.size > 10 * 1024 * 1024) {
                toast.error('File size must be less than 10MB');
                return;
            }

            const normalized = await normalizeFullLetterhead(file);
            console.log(
                `[PDF Settings] letterhead: ${(file.size / 1024).toFixed(0)}KB → ${(normalized.size / 1024).toFixed(0)}KB`
            );

            const fileName = `${clinicId}_letterhead_${Date.now()}.jpg`;
            const filePath = `clinic-pdf-assets/${clinicId}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('pdf-assets')
                .upload(filePath, normalized, {
                    contentType: 'image/jpeg',
                    cacheControl: '3600',
                    upsert: true
                });

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('pdf-assets')
                .getPublicUrl(filePath);

            setSettings(prev => ({ ...prev, letterheadUrl: publicUrl }));
            toast.success('Letterhead uploaded');
        } catch (error) {
            console.error('Upload error:', error);
            toast.error('Failed to upload letterhead');
        } finally {
            setUploadingLetterhead(false);
        }
    };

    const handleRemoveImage = (type: 'header' | 'footer') => {
        setSettings(prev => ({
            ...prev,
            [type === 'header' ? 'pdfHeaderUrl' : 'pdfFooterUrl']: ''
        }));
    };

    const handleSpacingChange = (key: keyof PdfLetterheadSpacing, value: string) => {
        const parsed = parseInt(value, 10);
        setSettings(prev => ({
            ...prev,
            letterheadSpacing: {
                ...prev.letterheadSpacing,
                [key]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0
            }
        }));
    };

    const handleSave = async () => {
        try {
            setLoading(true);

            if (letterheadSupported && settings.letterheadMode === 'full' && !settings.letterheadUrl) {
                toast.error('Upload a full-page letterhead image before switching to that mode');
                return;
            }

            // Both modes are always persisted, so switching back and forth never
            // loses the other mode's artwork or measurements.
            const payload: Record<string, unknown> = {
                pdf_header_url: settings.pdfHeaderUrl,
                pdf_footer_url: settings.pdfFooterUrl,
                pdf_margins: settings.pdfMargins,
                invoice_paper_size: settings.invoicePaperSize,
                invoice_margins: settings.invoiceMargins,
            };

            if (letterheadSupported) {
                payload.pdf_letterhead_mode = settings.letterheadMode;
                payload.pdf_letterhead_url = settings.letterheadUrl;
                payload.pdf_letterhead_spacing = settings.letterheadSpacing;
            }

            const { error } = await supabase
                .from('clinic_settings')
                .update(payload)
                .eq('id', clinicId);

            if (error) throw error;

            toast.success('PDF settings saved. Existing PDFs keep their old layout — regenerate a document to see the change.');
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
                Choose how prescription and invoice PDFs are branded. Both options apply to every page of
                prescriptions and invoices alike.
            </p>

            {/* Branding mode */}
            <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Branding Style
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <button
                        type="button"
                        onClick={() => setSettings(prev => ({ ...prev, letterheadMode: 'bands' }))}
                        className={`text-left border-2 rounded-lg p-4 transition-colors ${!isFullMode ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                            }`}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <LayoutPanelTop className={`w-4 h-4 ${!isFullMode ? 'text-blue-600' : 'text-gray-400'}`} />
                            <span className="text-sm font-semibold text-gray-800">Header &amp; Footer Images</span>
                            {!isFullMode && (
                                <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                                    Active
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-600">
                            Two separate strips — a header band at the top and a footer band at the bottom of every page.
                            This is the default and what your existing PDFs use.
                        </p>
                    </button>

                    <button
                        type="button"
                        disabled={!letterheadSupported}
                        onClick={() => setSettings(prev => ({ ...prev, letterheadMode: 'full' }))}
                        className={`text-left border-2 rounded-lg p-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isFullMode ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                            }`}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <FileText className={`w-4 h-4 ${isFullMode ? 'text-blue-600' : 'text-gray-400'}`} />
                            <span className="text-sm font-semibold text-gray-800">Full-Page Letterhead</span>
                            {isFullMode && (
                                <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                                    Active
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-600">
                            One full A4 letterhead image printed edge-to-edge behind every page — side borders,
                            watermarks and all. Content is kept clear of the artwork by the spacing you set below.
                        </p>
                    </button>
                </div>

                {!letterheadSupported && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
                        Full-page letterhead is not available yet — the database migration
                        <code className="mx-1">20260807100000_pdf_full_letterhead.sql</code>
                        has not been applied to this project.
                    </p>
                )}
            </div>

            {/* ---------- FULL-PAGE LETTERHEAD ---------- */}
            {letterheadSupported && (
                <div className={`border rounded-lg p-4 mb-6 ${isFullMode ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200 bg-gray-50 opacity-70'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <h4 className="text-md font-semibold text-gray-800">Full-Page Letterhead</h4>
                        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${isFullMode ? 'text-blue-700 bg-blue-100' : 'text-gray-500 bg-gray-200'}`}>
                            {isFullMode ? 'In use' : 'Not in use'}
                        </span>
                    </div>

                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Letterhead Image (A4 — full page)
                        </label>

                        {settings.letterheadUrl ? (
                            <div className="relative border-2 border-gray-200 rounded-lg p-4 bg-white">
                                <img
                                    src={settings.letterheadUrl}
                                    alt="Full-page letterhead"
                                    className="max-h-64 mx-auto shadow-sm"
                                />
                                <button
                                    onClick={() => setSettings(prev => ({ ...prev, letterheadUrl: '' }))}
                                    className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors bg-white">
                                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                                <p className="text-sm text-gray-600 mb-2">Click to upload full-page letterhead</p>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => e.target.files?.[0] && handleLetterheadUpload(e.target.files[0])}
                                    className="hidden"
                                    id="letterhead-upload"
                                    disabled={uploadingLetterhead}
                                />
                                <label
                                    htmlFor="letterhead-upload"
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer"
                                >
                                    {uploadingLetterhead ? 'Uploading...' : 'Choose File'}
                                </label>
                            </div>
                        )}
                        <p className="text-xs text-gray-500 mt-1">
                            Use a scan or design of the whole A4 sheet (1:1.414 ratio, at least 1240px wide).
                            It is resized to A4 at 150 dpi on upload; anything not in A4 proportions will be stretched to fit.
                        </p>
                    </div>

                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Content Spacing (px)
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                        {([
                            { key: 'top' as const, label: 'Top', hint: 'Clears header art' },
                            { key: 'bottom' as const, label: 'Bottom', hint: 'Clears footer art' },
                            { key: 'left' as const, label: 'Left', hint: 'Side padding' },
                            { key: 'right' as const, label: 'Right', hint: 'Side padding' },
                        ]).map(({ key, label, hint }) => (
                            <div key={key}>
                                <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                                <input
                                    type="number"
                                    min={0}
                                    value={settings.letterheadSpacing[key]}
                                    onChange={(e) => handleSpacingChange(key, e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                                <p className="text-[11px] text-gray-500 mt-1">{hint}</p>
                            </div>
                        ))}
                    </div>

                    <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
                        <p className="font-medium text-gray-700 mb-1">How to pick these numbers</p>
                        <p className="mb-1">
                            An A4 page is 1123px tall on screen. Measure your artwork:
                            <code className="mx-1 bg-gray-100 px-1 rounded">
                                spacing = (band height in image ÷ image height) × 1123
                            </code>
                            then add 10–15px of breathing room.
                        </p>
                        <p>
                            Typical values — slim logo strip: 90–110 top / 60–80 bottom · standard letterhead: 130–160 / 100–130 ·
                            heavy header, footer and side border: 170–200 / 140–170. Left and right are usually 20–40.
                            A5 invoices scale these down automatically.
                        </p>
                    </div>
                </div>
            )}

            {/* ---------- HEADER / FOOTER BANDS ---------- */}
            <div className={`border rounded-lg p-4 mb-6 ${!isFullMode ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200 bg-gray-50 opacity-70'}`}>
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-md font-semibold text-gray-800">Header &amp; Footer Images</h4>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${!isFullMode ? 'text-blue-700 bg-blue-100' : 'text-gray-500 bg-gray-200'}`}>
                        {!isFullMode ? 'In use' : 'Not in use'}
                    </span>
                </div>

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
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
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
            </div>
            {/* ---------- END HEADER / FOOTER BANDS ---------- */}

            {/* Invoice/Bill Settings */}
            <div className="border-t border-gray-200 pt-6 mt-6">
                <h4 className="text-md font-semibold text-gray-800 mb-4">Invoice / Bill Settings</h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Invoice Paper Size
                        </label>
                        <select
                            value={settings.invoicePaperSize}
                            onChange={(e) => {
                                const nextPaperSize = e.target.value as 'A4' | 'A5';
                                setSettings(prev => ({
                                    ...prev,
                                    invoicePaperSize: nextPaperSize,
                                    invoiceMargins: prev.invoiceMargins === A4_INVOICE_MARGINS || prev.invoiceMargins === A5_INVOICE_MARGINS
                                        ? (nextPaperSize === 'A5' ? A5_INVOICE_MARGINS : A4_INVOICE_MARGINS)
                                        : prev.invoiceMargins
                                }));
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                            <option value="A4">A4 (210 x 297 mm)</option>
                            <option value="A5">A5 (148 x 210 mm)</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                            A5 is half the size of A4, good for compact invoices
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Invoice Margins (Top Right Bottom Left)
                        </label>
                        <input
                            type="text"
                            value={settings.invoiceMargins}
                            onChange={(e) => setSettings(prev => ({ ...prev, invoiceMargins: e.target.value }))}
                            placeholder={settings.invoicePaperSize === 'A5' ? A5_INVOICE_MARGINS : A4_INVOICE_MARGINS}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Default for {settings.invoicePaperSize}: {settings.invoicePaperSize === 'A5' ? A5_INVOICE_MARGINS : A4_INVOICE_MARGINS}
                        </p>
                    </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                    <p className="text-sm text-blue-800">
                        <strong>Note:</strong> Invoices use the same branding as prescriptions —
                        {isFullMode
                            ? ' the full-page letterhead is applied to invoice PDFs automatically, scaled down for A5.'
                            : ' the header and footer images appear on invoice PDFs automatically.'}
                        {' '}Invoice margins are ignored in full-page letterhead mode, where spacing comes from the settings above.
                    </p>
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
