import React from 'react';
import { Loader2, CheckCircle2, XCircle, FileText, Download, Server } from 'lucide-react';

interface PDFProgressModalProps {
    isVisible: boolean;
    stage: 'idle' | 'generating' | 'downloading' | 'complete' | 'failed';
    progress: number;
    error?: string;
    onClose: () => void;
}

export const PDFProgressModal: React.FC<PDFProgressModalProps> = ({
    isVisible,
    stage,
    progress,
    error,
    onClose
}) => {
    if (!isVisible) return null;

    const isComplete = stage === 'complete';
    const isFailed = stage === 'failed';
    const canClose = isComplete || isFailed;

    // Map stages to steps
    const steps = [
        { key: 'generating', label: 'PDF Generation', icon: FileText, minProgress: 0 },
        { key: 'downloading', label: 'Download from Server', icon: Server, minProgress: 50 },
        { key: 'complete', label: 'Ready', icon: Download, minProgress: 100 },
    ];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-gray-900">
                        {isFailed ? 'PDF Generation Failed' : 'Generating PDF'}
                    </h3>
                    {canClose && (
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                        >
                            ✕
                        </button>
                    )}
                </div>

                {/* Spinner (only while processing) */}
                {!isComplete && !isFailed && (
                    <div className="flex justify-center mb-6">
                        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                    </div>
                )}

                {/* Success Icon */}
                {isComplete && (
                    <div className="flex justify-center mb-6">
                        <CheckCircle2 className="w-12 h-12 text-green-600" />
                    </div>
                )}

                {/* Error Icon */}
                {isFailed && (
                    <div className="flex justify-center mb-6">
                        <XCircle className="w-12 h-12 text-red-600" />
                    </div>
                )}

                {/* Progress Bar */}
                <div className="mb-6">
                    <div className="flex justify-between text-sm text-gray-600 mb-2">
                        <span>Progress</span>
                        <span>{Math.round(progress)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                            className={`h-full transition-all duration-300 rounded-full ${isFailed ? 'bg-red-600' : progress >= 100 ? 'bg-green-600' : 'bg-blue-600'
                                }`}
                            style={{ width: `${Math.min(progress, 100)}%` }}
                        />
                    </div>
                </div>

                {/* Step Indicators */}
                <div className="space-y-3 mb-6">
                    {steps.map((step, index) => {
                        const isStepComplete = progress >= step.minProgress;
                        const isCurrentStep = stage === step.key;
                        const StepIcon = step.icon;

                        return (
                            <div
                                key={step.key}
                                className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${isStepComplete
                                        ? 'bg-green-50 border border-green-200'
                                        : isCurrentStep
                                            ? 'bg-blue-50 border border-blue-200'
                                            : 'bg-gray-50 border border-gray-200'
                                    }`}
                            >
                                {isStepComplete ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                                ) : isCurrentStep ? (
                                    <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
                                ) : (
                                    <StepIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                                )}
                                <span className={`text-sm font-medium ${isStepComplete
                                        ? 'text-green-700'
                                        : isCurrentStep
                                            ? 'text-blue-700'
                                            : 'text-gray-500'
                                    }`}>
                                    {step.label}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {/* Error Message */}
                {isFailed && error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                        <p className="text-sm text-red-800">{error}</p>
                    </div>
                )}

                {/* Help Text */}
                {!isComplete && !isFailed && (
                    <p className="text-sm text-gray-500 text-center">
                        Please wait while we generate your PDF. This may take a few moments...
                    </p>
                )}

                {/* Done Button */}
                {canClose && (
                    <button
                        onClick={onClose}
                        className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${isFailed
                                ? 'bg-red-600 hover:bg-red-700 text-white'
                                : 'bg-green-600 hover:bg-green-700 text-white'
                            }`}
                    >
                        {isFailed ? 'Close' : 'Done'}
                    </button>
                )}
            </div>
        </div>
    );
};
