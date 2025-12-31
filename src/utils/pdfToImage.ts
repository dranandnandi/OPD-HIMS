import * as pdfjsLib from 'pdfjs-dist';

// Set up the worker using the public folder copy
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';

export interface PDFToImageOptions {
  scale?: number; // Scale factor for rendering (default: 2.0 for higher quality)
  outputFormat?: 'image/jpeg' | 'image/png'; // Output format (default: image/jpeg)
  quality?: number; // JPEG quality 0-1 (default: 0.92)
}

/**
 * Convert a PDF file to an array of image files (one per page)
 * @param pdfFile - The PDF file to convert
 * @param options - Conversion options
 * @returns Array of image File objects, one for each page
 */
export async function convertPDFToImages(
  pdfFile: File,
  options: PDFToImageOptions = {}
): Promise<File[]> {
  const {
    scale = 2.0,
    outputFormat = 'image/jpeg',
    quality = 0.92
  } = options;

  try {
    // Read PDF file as ArrayBuffer
    const arrayBuffer = await pdfFile.arrayBuffer();
    
    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    const imageFiles: File[] = [];
    
    // Process each page
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      
      // Get the viewport
      const viewport = page.getViewport({ scale });
      
      // Create canvas
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      if (!context) {
        throw new Error('Failed to get canvas context');
      }
      
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      // Render the page to canvas
      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };
      
      await page.render(renderContext).promise;
      
      // Convert canvas to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to convert canvas to blob'));
            }
          },
          outputFormat,
          quality
        );
      });
      
      // Create File from blob
      const fileName = pdf.numPages > 1 
        ? `${pdfFile.name.replace('.pdf', '')}_page${pageNum}.jpg`
        : `${pdfFile.name.replace('.pdf', '')}.jpg`;
      
      const imageFile = new File([blob], fileName, { type: outputFormat });
      imageFiles.push(imageFile);
    }
    
    return imageFiles;
  } catch (error) {
    console.error('Error converting PDF to images:', error);
    throw new Error(`Failed to convert PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Convert a PDF file to a single image (first page only)
 * Useful for single-page documents
 * @param pdfFile - The PDF file to convert
 * @param options - Conversion options
 * @returns Single image File object
 */
export async function convertPDFToSingleImage(
  pdfFile: File,
  options: PDFToImageOptions = {}
): Promise<File> {
  const images = await convertPDFToImages(pdfFile, options);
  if (images.length === 0) {
    throw new Error('No images generated from PDF');
  }
  return images[0];
}

/**
 * Check if a file is a PDF
 * @param file - File to check
 * @returns true if file is a PDF
 */
export function isPDF(file: File): boolean {
  return file.type === 'application/pdf';
}
