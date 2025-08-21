import jsPDF from 'jspdf';
import { createRoot } from 'react-dom/client';
import React from 'react';

export interface PDFGenerationOptions {
  filename: string;
  orientation?: 'portrait' | 'landscape';
  format?: 'a4' | 'letter';
  quality?: number;
  margins?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export const generatePDFFromComponent = async (
  component: React.ReactElement,
  options: PDFGenerationOptions
): Promise<void> => {
  const {
    filename,
    orientation = 'portrait',
    format = 'a4',
    quality = 0.95,
    margins = { top: 10, right: 10, bottom: 10, left: 10 }
  } = options;

  // Create a temporary container
  const tempContainer = document.createElement('div');
  tempContainer.style.position = 'absolute';
  tempContainer.style.left = '-9999px';
  tempContainer.style.top = '-9999px';
  tempContainer.style.width = '210mm'; // A4 width
  tempContainer.style.backgroundColor = 'white';
  tempContainer.style.fontFamily = 'Arial, sans-serif';
  tempContainer.style.fontSize = '12px';
  tempContainer.style.lineHeight = '1.4';
  tempContainer.style.color = '#000000';
  document.body.appendChild(tempContainer);

  try {
    // Render the React component into the temporary container
    const root = createRoot(tempContainer);
    
    // Wrap the component rendering in a Promise
    await new Promise<void>((resolve) => {
      root.render(React.cloneElement(component, {
        onRenderComplete: resolve
      }));
      
      // Fallback timeout in case onRenderComplete is not called
      setTimeout(resolve, 1000);
    });

    // Wait a bit more for any async content to load
    await new Promise(resolve => setTimeout(resolve, 500));

    // Create PDF with improved settings
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format,
      compress: true
    });

    // Use jsPDF.html() method for better page break handling
    await new Promise<void>((resolve, reject) => {
      pdf.html(tempContainer, {
        callback: (doc) => {
          try {
            // Save the PDF
            doc.save(filename);
            resolve();
          } catch (error) {
            reject(error);
          }
        },
        margin: [margins.top, margins.right, margins.bottom, margins.left],
        autoPaging: 'text', // Better page breaking at text boundaries
        html2canvas: {
          scale: 2, // Higher scale for better quality
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false, // Disable logging for production
          letterRendering: true, // Better text rendering
          removeContainer: true
        },
        width: orientation === 'portrait' ? 190 : 277, // Page width minus margins
        windowWidth: 800 // Consistent rendering width
      });
    });

    // Clean up
    root.unmount();
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error('Failed to generate PDF. Please try again.');
  } finally {
    // Remove the temporary container
    if (document.body.contains(tempContainer)) {
      document.body.removeChild(tempContainer);
    }
  }
};

export const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
};