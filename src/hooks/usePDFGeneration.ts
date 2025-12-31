import { useState, useCallback } from 'react';

type PDFStage = 'idle' | 'generating' | 'downloading' | 'complete' | 'failed';

interface UsePDFGenerationReturn {
    isGenerating: boolean;
    stage: PDFStage;
    progress: number;
    error: string | null;
    generatePDF: (generateFn: () => Promise<void>) => Promise<void>;
    resetState: () => void;
}

export const usePDFGeneration = (): UsePDFGenerationReturn => {
    const [isGenerating, setIsGenerating] = useState(false);
    const [stage, setStage] = useState<PDFStage>('idle');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const resetState = useCallback(() => {
        setIsGenerating(false);
        setStage('idle');
        setProgress(0);
        setError(null);
    }, []);

    const generatePDF = useCallback(async (generateFn: () => Promise<void>) => {
        try {
            // Reset state
            setIsGenerating(true);
            setStage('generating');
            setProgress(0);
            setError(null);

            // Simulate progress during generation
            const progressInterval = setInterval(() => {
                setProgress(prev => {
                    if (prev < 40) return prev + 10; // Quick initial progress
                    if (prev < 70) return prev + 5;  // Slower middle  progress
                    return prev + 2; // Very slow near end
                });
            }, 500);

            try {
                // Call the actual PDF generation function
                await generateFn();

                // Move to downloading stage
                clearInterval(progressInterval);
                setStage('downloading');
                setProgress(75);

                // Simulate download progress
                await new Promise(resolve => setTimeout(resolve, 500));
                setProgress(90);

                await new Promise(resolve => setTimeout(resolve, 300));
                setProgress(100);

                // Complete
                setStage('complete');

            } catch (err) {
                clearInterval(progressInterval);
                throw err;
            }

        } catch (err) {
            console.error('PDF Generation Error:', err);
            setStage('failed');
            setProgress(0);
            setError(err instanceof Error ? err.message : 'Failed to generate PDF');
        }
    }, []);

    return {
        isGenerating,
        stage,
        progress,
        error,
        generatePDF,
        resetState
    };
};
