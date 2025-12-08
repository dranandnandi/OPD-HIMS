import { OCRResult } from '../types';
import { supabase } from '../lib/supabase';


// Convert File to base64 string
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

export const processCasePaperWithAI = async (imageFile: File, patientId?: string, visitId?: string): Promise<OCRResult> => {
  let ocrUploadId: string = '';
  const startTime = Date.now();

  try {
    if (!supabase) throw new Error('Supabase client not initialized');

    // Note: Progress updates would need to be passed via callback
    // For now, we'll add console logs that could be used for progress tracking
    console.log('🔄 [OCR] Step 1/5: Getting user profile and session...');
    
    // ✅ Get current user & session token
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) throw new Error('Not authenticated');
    const user = session.user;
    const token = session.access_token;

    console.log('🔄 [OCR] Step 2/5: Uploading image to storage...');
    
    // Step 1: Upload image to Supabase storage
    const fileName = `${Date.now()}_${imageFile.name}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('ocruploads')
      .upload(fileName, imageFile);

    if (uploadError) throw new Error(`Failed to upload to storage: ${uploadError.message}`);

    const { data: { publicUrl } } = supabase.storage
      .from('ocruploads')
      .getPublicUrl(fileName);

    // Step 2: Insert entry in `ocr_uploads` table
    const { data: ocrUpload, error: dbError } = await supabase
      .from('ocr_uploads')
      .insert([{
        clinic_id: profile.clinicId,
        patient_id: patientId || null,
        visit_id: visitId || null,
        file_name: imageFile.name,
        file_url: publicUrl,
        file_size: imageFile.size,
        mime_type: imageFile.type,
        uploaded_by: user.id,
        status: 'processing'
      }])
      .select()
      .single();

    if (dbError) throw new Error(`Failed to save to ocr_uploads table: ${dbError.message}`);
    ocrUploadId = ocrUpload.id;

    console.log('🔄 [OCR] Step 3/5: Converting image to base64...');
    
    // Step 3: Convert image to base64
    const imageBase64 = await fileToBase64(imageFile);

    console.log('🔄 [OCR] Step 4/5: Extracting text with Vision AI...');
    
    // Step 4: Call Vision OCR function ✅ with Authorization
    const visionResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ imageBase64 })
    });

    if (!visionResponse.ok) throw new Error(`Vision API call failed: ${visionResponse.statusText}`);
    const visionData = await visionResponse.json();
    if (visionData.error) throw new Error(`Vision API error: ${visionData.error}`);

    const rawText = visionData.extractedText || '';
    if (!rawText.trim()) throw new Error('No text could be extracted from the image');

    console.log('🔄 [OCR] Step 5/5: Cleaning and analyzing medical text...');
    
    // Step 5: Call Gemini Clean Medical Text function ✅ with Authorization
    const cleanResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-clean-medical-text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ rawText })
    });

    if (!cleanResponse.ok) throw new Error(`Clean Medical Text API call failed: ${cleanResponse.statusText}`);
    const cleanData = await cleanResponse.json();
    if (cleanData.error) throw new Error(`Clean Medical Text API error: ${cleanData.error}`);

    const cleanedMedicalText = cleanData.cleanedMedicalText || '';
    if (!cleanedMedicalText.trim()) throw new Error('No medical content could be extracted from the text');

    // Step 6: Call Gemini NLP function ✅ with Authorization (now using cleaned text)
    const geminiResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-nlp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ cleanedMedicalText })
    });

    if (!geminiResponse.ok) throw new Error(`Gemini API call failed: ${geminiResponse.statusText}`);
    const geminiData = await geminiResponse.json();
    if (geminiData.error) throw new Error(`Gemini API error: ${geminiData.error}`);

    // Step 7: Call Validation and Refinement function ✅ with Authorization
    const validationResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-extracted-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ 
        extractedData: geminiData.extractedData,
        rawText,
        cleanedMedicalText
      })
    });

    if (!validationResponse.ok) throw new Error(`Validation and Refinement API call failed: ${validationResponse.statusText}`);
    const validationData = await validationResponse.json();
    if (validationData.error) throw new Error(`Validation and Refinement API error: ${validationData.error}`);

    // Use refined data instead of raw extracted data
    const finalExtractedData = validationData.refinedData || geminiData.extractedData;

    console.log('✅ [OCR] Processing completed successfully!');
    
    // Step 8: Build OCRResult object
    const result: OCRResult = {
      id: ocrUploadId || `temp_${Date.now()}`,
      ocrUploadId,
      rawText,
      cleanedMedicalText,
      extractedData: {
        symptoms: finalExtractedData.symptoms || [],
        vitals: {
          temperature: finalExtractedData.vitals?.temperature || '',
          bloodPressure: finalExtractedData.vitals?.bloodPressure || '',
          pulse: finalExtractedData.vitals?.pulse || '',
          weight: finalExtractedData.vitals?.weight || '',
          height: finalExtractedData.vitals?.height || ''
        },
        diagnoses: finalExtractedData.diagnoses || [],
        prescriptions: finalExtractedData.prescriptions || [],
        testsOrdered: finalExtractedData.testsOrdered || [],
        advice: finalExtractedData.advice || []
      },
      confidence: 0.85,
      processingTime: Date.now() - startTime,
      createdAt: new Date(),
      validationReport: validationData.validationReport
    };

    // Step 9: Save result to `ocr_results` table (using refined data)
    await supabase
      .from('ocr_results')
      .insert([{
        ocr_upload_id: ocrUploadId,
        raw_text: rawText,
        cleaned_medical_text: cleanedMedicalText,
        extracted_data: finalExtractedData,
        confidence: result.confidence,
        processing_time: result.processingTime,
        validation_report: result.validationReport
      }]);

    // Update status in `ocr_uploads`
    await supabase
      .from('ocr_uploads')
      .update({ status: 'completed', processed_at: new Date().toISOString() })
      .eq('id', ocrUploadId);

    return result;

  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('OCR Processing Error:', error);
    }

    if (ocrUploadId) {
      await supabase
        .from('ocr_uploads')
        .update({ status: 'failed' })
        .eq('id', ocrUploadId);
    }

    return {
      id: `error_${Date.now()}`,
      ocrUploadId: ocrUploadId || '',
      rawText: `Error processing image: ${error instanceof Error ? error.message : 'Unknown error'}`,
      cleanedMedicalText: '',
      extractedData: {
        symptoms: [],
        vitals: {},
        diagnoses: [],
        prescriptions: [],
        advice: ['Please try uploading the image again or contact support.']
      },
      confidence: 0,
      processingTime: 0,
      createdAt: new Date()
    };
  }
};

// OCR History
export const getOcrHistory = async (): Promise<OCRResult[]> => {
  const { data, error } = await supabase
    .from('ocr_results')
    .select(`*, clinic_id, ocr_uploads (*)`)
    .order('created_at', { ascending: false });

  if (error) throw new Error('Failed to fetch OCR history');

  const profile = await getCurrentProfile();
  if (!profile?.clinicId) {
    throw new Error('User not assigned to a clinic.');
  }
  query = query.eq('clinic_id', profile.clinicId);


  return data.map(result => ({
    id: result.id,
    ocrUploadId: result.ocr_upload_id,
    rawText: result.raw_text,
    extractedData: result.extracted_data,
    confidence: result.confidence,
    processingTime: result.processing_time,
    createdAt: new Date(result.created_at)
  }));
};

export const simulateOCR = processCasePaperWithAI;