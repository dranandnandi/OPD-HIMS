import { withSuiteClient, guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
/// <reference types="https://deno.land/x/deno@v1.42.0/lib/deno.d.ts" />

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as dsBase_createClient } from "npm:@supabase/supabase-js@^2.47.16";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@^0.24.1";
const createClient=withSuiteClient(dsBase_createClient);


// Env setup
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const allGoogleKey = Deno.env.get("ALLGOOGLE_KEY") ?? "";

// Clients
const supabaseAdmin = createClient(supabaseUrl, serviceKey);
const genAI = new GoogleGenerativeAI(allGoogleKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-application-name, x-requested-with",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
  "Access-Control-Max-Age": "86400"
};

serve(guardEdge(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const { conversationId } = await req.json();
    console.log("Request for conversation:", conversationId);

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(conversationId)) {
      return errorResponse("Invalid conversation ID", 400);
    }

    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return errorResponse("Unauthorized", 401);

    const { data: convo, error } = await supabaseAdmin
      .from("conversation_logs")
      .select("*")
      .eq("id", conversationId)
      .single();
    if (error || !convo) throw new Error("Conversation not found");

    if (!convo.audio_file_url?.includes("supabase.co")) {
      throw new Error("Invalid audio file URL");
    }

    await supabaseAdmin.from("conversation_logs")
      .update({ status: "processing" }).eq("id", conversationId);

    // Download and transcribe the actual audio file
    const transcript = await transcribeAudioFile(convo.audio_file_url);
    
    if (!transcript || transcript.trim().length === 0) {
      throw new Error("Failed to transcribe audio or audio is empty");
    }

    await supabaseAdmin.from("conversation_logs")
      .update({ transcribed_text: transcript, status: "transcribed" })
      .eq("id", conversationId);

    const analysis = await analyzeWithGemini(transcript);
    const summary = await summarizeWithGemini(transcript, analysis);

    await supabaseAdmin.from("conversation_analysis").insert([{
      conversation_log_id: conversationId,
      ...analysis
    }]);
    await supabaseAdmin.from("conversation_logs")
      .update({ ai_summary: summary, status: "analyzed" })
      .eq("id", conversationId);

    return new Response(JSON.stringify({ success: true, conversationId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Function error:", err.message);
    return errorResponse("Processing failed: " + err.message, 500);
  }
}, 'workforce', 'process-conversation'));

function errorResponse(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status
  });
}

async function analyzeWithGemini(text: string) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const prompt = `
Analyze this customer service conversation transcript and provide a comprehensive analysis in JSON format.

Conversation transcript: "${text}"

Please analyze the following aspects and return a JSON object with these exact fields:

{
  "overall_tone": "professional|friendly|neutral|aggressive|dismissive",
  "response_quality": "excellent|good|average|poor|unacceptable",
  "misbehavior_detected": false,
  "red_flags": [],
  "sentiment_score": 0.7,
  "recommendation": "specific actionable recommendation for improvement",
  "communication_effectiveness": 0.8,
  "empathy_level": 0.7,
  "problem_resolution": "resolved|partially_resolved|unresolved|escalated",
  "customer_satisfaction_indicator": 0.8,
  "key_issues": ["example issue"],
  "positive_aspects": ["professional tone"],
  "improvement_areas": ["none noted"],
  "urgency_level": "low|medium|high|critical",
  "follow_up_required": false,
  "compliance_score": 0.9
}

Focus on:
- Professional communication standards
- Customer service quality
- Compliance with company policies
- Empathy and understanding
- Problem-solving approach
- Clear and effective communication

Conversation:
${text}
`;
  const result = await model.generateContent(prompt);
  const responseText = await result.response.text();
  const match = responseText.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : {
    overall_tone: "neutral",
    response_quality: "unknown",
    misbehavior_detected: false,
    red_flags: [],
    sentiment_score: 0.5,
    recommendation: "No recommendation",
    communication_effectiveness: 0.5,
    empathy_level: 0.5,
    problem_resolution: "unresolved",
    customer_satisfaction_indicator: 0.5,
    key_issues: [],
    positive_aspects: [],
    improvement_areas: [],
    urgency_level: "medium",
    follow_up_required: false,
    compliance_score: 0.5
  };
}

async function summarizeWithGemini(text: string, analysis: any) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const prompt = `
Summarize this conversation:

${text}

Analysis:
- Tone: ${analysis.overall_tone}
- Quality: ${analysis.response_quality}
- Red Flags: ${analysis.red_flags?.join(", ") || "None"}

Write a 2–3 sentence summary.
`;
  const result = await model.generateContent(prompt);
  return (await result.response.text()).trim();
}

/**
 * Transcribes audio using Google Cloud Speech-to-Text
 */
async function transcribeAudioFile(audioUrl: string): Promise<string> {
  try {
    console.log("Starting transcription for:", audioUrl);
    
    // Download the audio file
    const audioResponse = await runtimeFetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download audio: ${audioResponse.status}`);
    }
    
    const audioBlob = await audioResponse.blob();
    console.log("Audio file downloaded, size:", audioBlob.size, "bytes");
    
    if (audioBlob.size === 0) {
      throw new Error("Downloaded audio file is empty");
    }
    
    // Check for reasonable file size (prevent processing huge files)
    const maxSizeBytes = 25 * 1024 * 1024; // 25MB limit
    if (audioBlob.size > maxSizeBytes) {
      throw new Error(`Audio file too large: ${audioBlob.size} bytes (max: ${maxSizeBytes} bytes)`);
    }

    // Check if Google Cloud API key is available
    if (!allGoogleKey) {
      console.warn("ALLGOOGLE_KEY not found, using fallback transcription");
      return generateFallbackTranscript(audioUrl);
    }

    // Convert audio blob to base64 safely (handle large files)
    console.log("Converting audio to base64...");
    let base64Audio: string;
    
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBytes = new Uint8Array(arrayBuffer);
      console.log("Audio buffer size:", audioBytes.length, "bytes");
      
      // For small files (< 1MB), try direct conversion first
      if (audioBytes.length < 1024 * 1024) {
        console.log("Small file detected, using byte-by-byte conversion");
        let binaryString = '';
        for (let i = 0; i < audioBytes.length; i++) {
          binaryString += String.fromCharCode(audioBytes[i]);
        }
        base64Audio = btoa(binaryString);
        console.log("Direct conversion successful, base64 length:", base64Audio.length);
      } else {
        console.log("Large file detected, using chunked processing");
        // Process in chunks to avoid call stack overflow (for larger files)
        let binaryString = '';
        const chunkSize = 8192; // Process 8KB at a time
        console.log("Processing audio in chunks of", chunkSize, "bytes");
        
        for (let i = 0; i < audioBytes.length; i += chunkSize) {
          const chunk = audioBytes.slice(i, i + chunkSize);
          binaryString += String.fromCharCode.apply(null, Array.from(chunk));
          
          // Log progress for files > 100KB
          if (i % (chunkSize * 10) === 0) {
            console.log(`Processed ${i} / ${audioBytes.length} bytes (${Math.round(i/audioBytes.length*100)}%)`);
          }
        }
        
        console.log("Converting binary string to base64...");
        base64Audio = btoa(binaryString);
        console.log("Base64 conversion complete, length:", base64Audio.length);
      }
      
    } catch (conversionError) {
      const errorMsg = conversionError instanceof Error ? conversionError.message : String(conversionError);
      console.error("Base64 conversion failed:", errorMsg);
      throw new Error(`Failed to convert audio to base64: ${errorMsg}`);
    }

    // Create request for Google Cloud Speech-to-Text API
    const speechRequest = {
      config: {
        encoding: "WEBM_OPUS",
        sampleRateHertz: 48000,
        languageCode: "en-US",
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: false,
        model: "latest_long"
      },
      audio: {
        content: base64Audio
      }
    };
    
    // Call Google Cloud Speech-to-Text API
    const speechResponse = await runtimeFetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${allGoogleKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(speechRequest)
      }
    );
    
    if (!speechResponse.ok) {
      const errorText = await speechResponse.text();
      console.error("Google Speech API error:", errorText);
      throw new Error(`Google Speech API failed: ${speechResponse.status}`);
    }
    
    const result = await speechResponse.json();
    console.log("Transcription completed successfully");
    
    // Extract transcript from Google Speech API response
    if (result.results && result.results.length > 0) {
      const transcript = result.results
        .map((result: any) => result.alternatives[0]?.transcript || "")
        .join(" ")
        .trim();
      
      return transcript || "No speech detected in audio";
    }
    
    return "No speech detected in audio";
    
  } catch (error) {
    // Safe error logging to prevent circular reference issues
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Transcription error:", errorMessage);
    return generateFallbackTranscript(audioUrl);
  }
}

/**
 * Generates a fallback transcript when real transcription fails
 */
function generateFallbackTranscript(audioUrl: string): string {
  const timestamp = new Date().toISOString();
  return `[Audio Recording] - Conversation recorded at ${timestamp}
  
Note: This is a placeholder transcript. The actual audio content could not be transcribed automatically. 
Audio file: ${audioUrl}

To analyze this conversation properly, please:
1. Set up speech-to-text transcription service (OpenAI Whisper API key)
2. Or manually transcribe the audio content
3. Update this conversation log with the actual transcript

For manual transcription, listen to the audio file and replace this text with the actual conversation content.`;
}
