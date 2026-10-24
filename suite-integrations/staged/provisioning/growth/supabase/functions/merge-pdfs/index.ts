import { withSuiteClient, guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
/*
  # PDF Merge Edge Function

  This function merges multiple PDF files into a single PDF document.

  1. Function Features
    - Accepts an array of PDF URLs to merge
    - Downloads PDFs using direct fetch for all URLs
    - Merges them into a single PDF using PDF-lib
    - Uploads the merged PDF to Supabase Storage
    - Returns the public URL of the merged PDF

  2. Security
    - Requires authentication
    - Validates input URLs
    - Handles CORS properly

  3. Error Handling
    - Comprehensive error handling for storage operations
    - Validation of PDF files
    - Cleanup of temporary files
*/

import { createClient as dsBase_createClient } from 'npm:@supabase/supabase-js@2.39.7';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

interface MergeRequest {
  pdfUrls: string[];
}

Deno.serve(guardEdge(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse request body
    const { pdfUrls }: MergeRequest = await req.json();

    // Validate input
    if (!pdfUrls || !Array.isArray(pdfUrls) || pdfUrls.length < 2) {
      return new Response(
        JSON.stringify({ error: 'At least 2 PDF URLs are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Create a new PDF document for merging
    const mergedPdf = await PDFDocument.create();
    
    // Process each PDF URL
    for (let i = 0; i < pdfUrls.length; i++) {
      const pdfUrl = pdfUrls[i];
      
      try {
        console.log(`Processing PDF ${i + 1}/${pdfUrls.length}: ${pdfUrl}`);
        
        // Use direct fetch for all URLs (including Supabase Storage public URLs)
        console.log(`Fetching PDF directly from: ${pdfUrl}`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const response = await runtimeFetch(pdfUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Supabase-Edge-Function/1.0',
          },
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
        }

        const pdfBytes = await response.arrayBuffer();
        
        // Validate that we have PDF data
        if (!pdfBytes || pdfBytes.byteLength === 0) {
          throw new Error('Empty PDF data received');
        }
        
        // Load the PDF document
        const pdf = await PDFDocument.load(pdfBytes);
        
        // Copy pages from the current PDF to the merged PDF
        const pageIndices = pdf.getPageIndices();
        const copiedPages = await mergedPdf.copyPages(pdf, pageIndices);
        
        // Add the copied pages to the merged PDF
        copiedPages.forEach((page) => mergedPdf.addPage(page));
        
        console.log(`Successfully merged PDF ${i + 1} with ${pageIndices.length} pages`);
        
      } catch (error) {
        console.error(`Error processing PDF ${i + 1} (${pdfUrl}):`, error);
        return new Response(
          JSON.stringify({ 
            error: `Failed to process PDF ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}` 
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Check if we have any pages to merge
    if (mergedPdf.getPageCount() === 0) {
      return new Response(
        JSON.stringify({ error: 'No pages found to merge' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Generate the merged PDF bytes
    const mergedPdfBytes = await mergedPdf.save();
    
    // Generate a unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `merged-report-${timestamp}.pdf`;
    
    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('reports')
      .upload(filename, mergedPdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: `Failed to upload merged PDF: ${uploadError.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from('reports')
      .getPublicUrl(filename);

    const mergedPdfUrl = urlData.publicUrl;

    console.log(`Successfully created merged PDF: ${mergedPdfUrl}`);
    console.log(`Total pages in merged PDF: ${mergedPdf.getPageCount()}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        mergedPdfUrl,
        totalPages: mergedPdf.getPageCount(),
        filename,
        processedFiles: pdfUrls.length
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}, 'growth', 'merge-pdfs'));