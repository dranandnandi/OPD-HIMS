import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { extractedData, rawText, cleanedMedicalText } = await req.json()
    
    if (!extractedData) {
      return new Response(
        JSON.stringify({ error: 'Extracted data is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log('🔍 Starting validation and refinement of extracted data...')

    // Initialize validation report and refined data
    const validationReport = {
      isValid: true,
      missingFields: [] as string[],
      errors: [] as string[],
      recommendations: [] as string[],
      qualityScore: 0.0,
      completenessScore: 0.0,
      accuracyScore: 0.0,
      details: {
        symptomsValidation: { found: 0, issues: [] as string[] },
        vitalsValidation: { found: 0, issues: [] as string[] },
        diagnosesValidation: { found: 0, issues: [] as string[] },
        prescriptionsValidation: { found: 0, issues: [] as string[] },
        adviceValidation: { found: 0, issues: [] as string[] }
      }
    }

    // Create a deep copy of extracted data for refinement
    const refinedData = JSON.parse(JSON.stringify(extractedData))

    // Ensure all required arrays exist
    if (!refinedData.symptoms) refinedData.symptoms = []
    if (!refinedData.diagnoses) refinedData.diagnoses = []
    if (!refinedData.prescriptions) refinedData.prescriptions = []
    if (!refinedData.advice) refinedData.advice = []
    if (!refinedData.vitals) refinedData.vitals = {}
    if (!refinedData.testsOrdered) refinedData.testsOrdered = []
    if (!refinedData.unmappedFindings) refinedData.unmappedFindings = []
    if (!refinedData.examination) refinedData.examination = {}

    const symptomName = (s: any) => (typeof s === 'string' ? s : s?.name || '')

    // 1. VALIDATE STRUCTURE AND FIELD PRESENCE
    const requiredFields = ['symptoms', 'vitals', 'diagnoses', 'prescriptions', 'advice']
    let completenessPoints = 0
    const maxCompletenessPoints = 10

    // Check symptoms
    if (!refinedData.symptoms || !Array.isArray(refinedData.symptoms) || refinedData.symptoms.length === 0) {
      validationReport.missingFields.push('symptoms')
      
      // Check if raw text mentions common symptoms
      if (rawText || cleanedMedicalText) {
        const textToCheck = (cleanedMedicalText || rawText || '').toLowerCase()
        const commonSymptoms = ['fever', 'headache', 'cough', 'cold', 'pain', 'ache', 'nausea', 'vomiting', 'diarrhea', 'constipation', 'fatigue', 'weakness', 'dizziness', 'hair fall', 'hair loss', 'thinning', 'itching', 'rash', 'swelling', 'burning', 'discharge']
        
        const foundSymptoms = commonSymptoms.filter(symptom => textToCheck.includes(symptom))
        if (foundSymptoms.length > 0) {
          validationReport.errors.push(`Symptoms mentioned in text but not extracted: ${foundSymptoms.join(', ')}`)
          validationReport.recommendations.push(`Extract symptoms: ${foundSymptoms.join(', ')}`)
          
          // REFINEMENT: Add missing symptoms
          foundSymptoms.forEach(symptom => {
            const existingSymptom = refinedData.symptoms.find((s: any) =>
              symptomName(s).toLowerCase() === symptom.toLowerCase()
            )
            if (!existingSymptom) {
              // Keyword-matched, not model-extracted — flag it so the doctor
              // verifies rather than trusting a substring hit like "no pain".
              refinedData.symptoms.push({
                name: symptom,
                severity: null,
                duration: null,
                notes: 'Auto-detected from case paper text — please verify'
              })
            }
          })
          console.log(`✅ Added missing symptoms: ${foundSymptoms.join(', ')}`)
        }
      }
    } else {
      validationReport.details.symptomsValidation.found = refinedData.symptoms.length
      completenessPoints += 2
    }

    // Check vitals
    if (!refinedData.vitals || typeof refinedData.vitals !== 'object') {
      validationReport.missingFields.push('vitals')
    } else {
      // REFINEMENT: Convert string vitals to appropriate types
      if (refinedData.vitals.temperature && typeof refinedData.vitals.temperature === 'string') {
        const tempMatch = refinedData.vitals.temperature.match(/(\d+\.?\d*)/);
        if (tempMatch) {
          refinedData.vitals.temperature = parseFloat(tempMatch[1]);
        }
      }
      
      if (refinedData.vitals.pulse && typeof refinedData.vitals.pulse === 'string') {
        const pulseMatch = refinedData.vitals.pulse.match(/(\d+)/);
        if (pulseMatch) {
          refinedData.vitals.pulse = parseInt(pulseMatch[1]);
        }
      }
      
      if (refinedData.vitals.weight && typeof refinedData.vitals.weight === 'string') {
        const weightMatch = refinedData.vitals.weight.match(/(\d+\.?\d*)/);
        if (weightMatch) {
          refinedData.vitals.weight = parseFloat(weightMatch[1]);
        }
      }
      
      if (refinedData.vitals.height && typeof refinedData.vitals.height === 'string') {
        const heightMatch = refinedData.vitals.height.match(/(\d+\.?\d*)/);
        if (heightMatch) {
          refinedData.vitals.height = parseFloat(heightMatch[1]);
        }
      }
      
      const vitalCount = Object.values(refinedData.vitals).filter(v => v !== null && v !== undefined && v !== '').length
      validationReport.details.vitalsValidation.found = vitalCount
      if (vitalCount > 0) completenessPoints += 1
    }

    // Check diagnoses
    if (!refinedData.diagnoses || !Array.isArray(refinedData.diagnoses) || refinedData.diagnoses.length === 0) {
      validationReport.missingFields.push('diagnoses')
    } else {
      validationReport.details.diagnosesValidation.found = refinedData.diagnoses.length
      completenessPoints += 3

      // Check for missing ICD-10 codes for common diagnoses
      refinedData.diagnoses.forEach((diagnosis: any, index: number) => {
        if (diagnosis.name && !diagnosis.icd10Code) {
          const diagnosisName = diagnosis.name.toLowerCase()
          
          // Common diagnoses that should have ICD-10 codes
          const commonDiagnoses = {
            'male pattern baldness': 'L64.0',
            'androgenetic alopecia': 'L64.0',
            'mpb': 'L64.0',
            'hypertension': 'I10',
            'diabetes': 'E11.9',
            'fever': 'R50.9',
            'headache': 'R51',
            'gastritis': 'K29.7',
            'upper respiratory tract infection': 'J06.9',
            'urti': 'J06.9',
            'viral fever': 'A99',
            'common cold': 'J00'
          }
          
          for (const [condition, icdCode] of Object.entries(commonDiagnoses)) {
            if (diagnosisName.includes(condition)) {
              validationReport.recommendations.push(`Add ICD-10 code ${icdCode} for diagnosis "${diagnosis.name}"`)
              
              // REFINEMENT: Add the ICD-10 code
              refinedData.diagnoses[index].icd10Code = icdCode
              console.log(`✅ Added ICD-10 code ${icdCode} for diagnosis "${diagnosis.name}"`)
              break
            }
          }
        }
      })
    }

    // Check prescriptions
    if (!refinedData.prescriptions || !Array.isArray(refinedData.prescriptions) || refinedData.prescriptions.length === 0) {
      validationReport.missingFields.push('prescriptions')
    } else {
      validationReport.details.prescriptionsValidation.found = refinedData.prescriptions.length
      completenessPoints += 3

      // Check for dosage form mismatches
      refinedData.prescriptions.forEach((prescription: any, index: number) => {
        if (prescription.medicine) {
          const medicineName = prescription.medicine.toLowerCase()
          
          // Check for topical applications incorrectly marked as tablets
          const topicalKeywords = ['shampoo', 'serum', 'lotion', 'cream', 'ointment', 'gel', 'solution', 'foam', 'oil']
          const oralKeywords = ['tablet', 'capsule', 'pill']
          
          const isTopical = topicalKeywords.some(keyword => medicineName.includes(keyword))
          const markedAsOral = prescription.dosage && oralKeywords.some(keyword => prescription.dosage.toLowerCase().includes(keyword))
          
          if (isTopical && markedAsOral) {
            validationReport.errors.push(`"${prescription.medicine}" appears to be a topical application but is marked as "${prescription.dosage}"`)
            validationReport.recommendations.push(`Correct dosage form for "${prescription.medicine}" - should be topical application, not oral`)
            validationReport.details.prescriptionsValidation.issues.push(`Dosage form mismatch for ${prescription.medicine}`)
            
            // REFINEMENT: Correct the dosage form
            if (medicineName.includes('shampoo')) {
              refinedData.prescriptions[index].dosage = 'Apply to scalp'
              refinedData.prescriptions[index].instructions = 'Use as directed, massage gently and rinse'
            } else if (medicineName.includes('serum') || medicineName.includes('solution')) {
              refinedData.prescriptions[index].dosage = 'Apply topically'
              refinedData.prescriptions[index].instructions = 'Apply to affected area as directed'
            } else if (medicineName.includes('cream') || medicineName.includes('ointment')) {
              refinedData.prescriptions[index].dosage = 'Apply thin layer'
              refinedData.prescriptions[index].instructions = 'Apply to affected area and massage gently'
            }
            console.log(`✅ Corrected dosage form for "${prescription.medicine}"`)
          }

          // Check for missing or generic dosage information
          if (!prescription.dosage || prescription.dosage.trim() === '') {
            validationReport.recommendations.push(`Add specific dosage for "${prescription.medicine}"`)
            
            // REFINEMENT: Add default dosage based on medicine type
            if (isTopical) {
              refinedData.prescriptions[index].dosage = 'Apply as directed'
            } else {
              refinedData.prescriptions[index].dosage = '1 tablet'
            }
          }

          // Check for missing frequency
          if (!prescription.frequency || prescription.frequency.trim() === '') {
            validationReport.recommendations.push(`Add frequency for "${prescription.medicine}"`)
            
            // REFINEMENT: Add default frequency
            refinedData.prescriptions[index].frequency = isTopical ? 'BD' : 'BD'
          }

          // Check for missing duration
          if (!prescription.duration || prescription.duration.trim() === '') {
            validationReport.recommendations.push(`Add duration for "${prescription.medicine}"`)
            
            // REFINEMENT: Add default duration
            refinedData.prescriptions[index].duration = isTopical ? '2 weeks' : '5 days'
          }
          
          // Check for missing instructions
          if (!prescription.instructions || prescription.instructions.trim() === '') {
            // REFINEMENT: Add default instructions
            refinedData.prescriptions[index].instructions = isTopical ? 'Apply to affected area' : 'After meals'
          }
        }
      })
    }

    // Check advice
    if (!refinedData.advice || !Array.isArray(refinedData.advice) || refinedData.advice.length === 0) {
      validationReport.missingFields.push('advice')
    } else {
      validationReport.details.adviceValidation.found = refinedData.advice.length
      completenessPoints += 1
    }

    // 2. CHECK FOR MISSING TEST ORDERS IN ADVICE
    if (rawText || cleanedMedicalText) {
      const textToCheck = (cleanedMedicalText || rawText || '').toLowerCase()
      const commonTests = ['cbc', 'complete blood count', 'lft', 'liver function', 'kft', 'kidney function', 'rft', 'renal function', 'tsh', 'thyroid', 'hba1c', 'blood sugar', 'lipid profile', 'ecg', 'ekg', 'x-ray', 'ultrasound', 'ct scan', 'mri', 'ferritin', 'vitamin d', 'vitamin b12']
      
      const mentionedTests = commonTests.filter(test => textToCheck.includes(test))
      if (mentionedTests.length > 0) {
        // Investigations are first-class now — check testsOrdered, not advice.
        const orderedText = [
          ...(refinedData.testsOrdered || []).map((t: any) => (typeof t === 'string' ? t : t?.testName || '')),
          ...(refinedData.advice || [])
        ].join(' ').toLowerCase()
        const missingTests = mentionedTests.filter(test => !orderedText.includes(test))

        if (missingTests.length > 0) {
          validationReport.recommendations.push(`Add test orders: ${missingTests.join(', ')}`)
          validationReport.details.adviceValidation.issues.push(`Missing test orders: ${missingTests.join(', ')}`)

          // REFINEMENT: Add missing test orders as real orders
          const isImaging = (t: string) => ['x-ray', 'ultrasound', 'ct scan', 'mri'].includes(t)
          missingTests.forEach(test => {
            refinedData.testsOrdered.push({
              testName: test.toUpperCase(),
              testType: isImaging(test) ? 'radiology' : 'lab',
              urgency: 'routine',
              instructions: 'Auto-detected from case paper text — please verify'
            })
          })
          console.log(`✅ Added missing test orders: ${missingTests.join(', ')}`)
        }
      }
    }

    // 3. VALIDATE CHIEF COMPLAINT
    if (!refinedData.chiefComplaint || refinedData.chiefComplaint.trim() === '') {
      validationReport.missingFields.push('chiefComplaint')
      
      // REFINEMENT: Try to extract chief complaint from symptoms or first few words of raw text
      const namedSymptoms = (refinedData.symptoms || []).map(symptomName).filter(Boolean)
      if (namedSymptoms.length > 0) {
        refinedData.chiefComplaint = namedSymptoms.slice(0, 2).join(' and ')
        console.log(`✅ Generated chief complaint from symptoms`)
      } else if (rawText) {
        // Extract first meaningful sentence as chief complaint
        const sentences = rawText.split(/[.!?]/).filter((s: string) => s.trim().length > 10)
        if (sentences.length > 0) {
          refinedData.chiefComplaint = sentences[0].trim()
          console.log(`✅ Extracted chief complaint from raw text`)
        }
      }
    } else {
      completenessPoints += 1
    }

    // 4. ADDITIONAL REFINEMENTS
    
    // Ensure doctor notes is a string
    if (!refinedData.doctorNotes) {
      refinedData.doctorNotes = ''
    }
    
    // Clean up and standardize prescription frequencies
    if (refinedData.prescriptions && Array.isArray(refinedData.prescriptions)) {
      refinedData.prescriptions.forEach((prescription: any, index: number) => {
        if (prescription.frequency) {
          const freq = prescription.frequency.toLowerCase()
          if (freq.includes('once') || freq.includes('daily') || freq.includes('1 time')) {
            refinedData.prescriptions[index].frequency = 'OD'
          } else if (freq.includes('twice') || freq.includes('2 time')) {
            refinedData.prescriptions[index].frequency = 'BD'
          } else if (freq.includes('thrice') || freq.includes('3 time')) {
            refinedData.prescriptions[index].frequency = 'TID'
          } else if (freq.includes('four') || freq.includes('4 time')) {
            refinedData.prescriptions[index].frequency = 'QID'
          }
        }
      })
    }
    
    // Standardize diagnosis names
    if (refinedData.diagnoses && Array.isArray(refinedData.diagnoses)) {
      refinedData.diagnoses.forEach((diagnosis: any, index: number) => {
        if (diagnosis.name) {
          const diagnosisName = diagnosis.name.toLowerCase()
          
          // Standardize common diagnosis names
          if (diagnosisName.includes('male pattern') || diagnosisName.includes('mpb')) {
            refinedData.diagnoses[index].name = 'Male Pattern Baldness'
          } else if (diagnosisName.includes('androgenetic')) {
            refinedData.diagnoses[index].name = 'Androgenetic Alopecia'
          } else if (diagnosisName.includes('upper respiratory') || diagnosisName.includes('urti')) {
            refinedData.diagnoses[index].name = 'Upper Respiratory Tract Infection'
          }
        }
      })
    }
    // 5. CALCULATE SCORES (after refinements)
    validationReport.completenessScore = Math.min(completenessPoints / maxCompletenessPoints, 1.0)

    // Calculate accuracy score based on errors found
    const totalErrors = validationReport.errors.length
    const totalRecommendations = validationReport.recommendations.length
    validationReport.accuracyScore = Math.max(0, 1.0 - (totalErrors * 0.2) - (totalRecommendations * 0.1))

    // Overall quality score (weighted average)
    validationReport.qualityScore = (validationReport.completenessScore * 0.6) + (validationReport.accuracyScore * 0.4)

    // 6. DETERMINE OVERALL VALIDITY
    validationReport.isValid = validationReport.errors.length === 0 && validationReport.missingFields.length <= 2

    console.log('✅ Validation and refinement completed:', {
      isValid: validationReport.isValid,
      qualityScore: validationReport.qualityScore,
      errorsCount: validationReport.errors.length,
      recommendationsCount: validationReport.recommendations.length,
      symptomsRefined: refinedData.symptoms?.length || 0,
      diagnosesRefined: refinedData.diagnoses?.length || 0,
      prescriptionsRefined: refinedData.prescriptions?.length || 0,
      adviceRefined: refinedData.advice?.length || 0
    })

    return new Response(
      JSON.stringify({ 
        success: true, 
        validationReport: validationReport,
        refinedData: refinedData
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('💥 Validation and Refinement Error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to validate and refine extracted data',
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})