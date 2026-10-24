import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as dsBase_createClient } from "npm:@supabase/supabase-js@^2.47.16";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@^0.24.1";
const createClient=withSuiteClient(dsBase_createClient);


// Env setup
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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
    const { conversationId, transcriptText } = await req.json();
    console.log("Manual analysis request for conversation:", conversationId);

    // Validate input
    if (!conversationId || !transcriptText) {
      return errorResponse("Missing conversationId or transcriptText", 400);
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(conversationId)) {
      return errorResponse("Invalid conversation ID", 400);
    }

    // Authentication check
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return errorResponse("Unauthorized", 401);

    // Verify conversation exists
    const { data: convo, error } = await supabaseAdmin
      .from("conversation_logs")
      .select("*")
      .eq("id", conversationId)
      .single();
    if (error || !convo) throw new Error("Conversation not found");

    // Update status to processing
    await supabaseAdmin.from("conversation_logs")
      .update({ status: "processing" }).eq("id", conversationId);

    // Update transcript if provided
    await supabaseAdmin.from("conversation_logs")
      .update({ 
        transcribed_text: transcriptText,
        status: "transcribed" 
      })
      .eq("id", conversationId);

    // Analyze with Gemini
    const analysis = await analyzeWithGemini(transcriptText);
    const summary = await summarizeWithGemini(transcriptText, analysis);

    // Store analysis results
    const { error: insertError } = await supabaseAdmin
      .from("conversation_analysis")
      .upsert([{
        conversation_log_id: conversationId,
        ...analysis
      }], { 
        onConflict: 'conversation_log_id' 
      });

    if (insertError) {
      console.error("Analysis insert error:", insertError);
    }

    // Update conversation with summary
    await supabaseAdmin.from("conversation_logs")
      .update({ 
        ai_summary: summary,
        status: "analyzed" 
      })
      .eq("id", conversationId);

    return new Response(JSON.stringify({ 
      success: true, 
      conversationId,
      analysis,
      summary 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Analysis function error:", err.message);
    return errorResponse("Analysis failed: " + err.message, 500);
  }
}, 'workforce', 'analyze-conversation'));

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
  "misbehavior_detected": boolean,
  "red_flags": array of specific concerning behaviors or phrases,
  "sentiment_score": number between 0-1 (0=very negative, 1=very positive),
  "recommendation": "specific actionable recommendation for improvement",
  "communication_effectiveness": number between 0-1,
  "empathy_level": number between 0-1,
  "problem_resolution": "resolved|partially_resolved|unresolved|escalated",
  "customer_satisfaction_indicator": number between 0-1,
  "key_issues": array of main issues discussed,
  "positive_aspects": array of things done well,
  "improvement_areas": array of specific areas needing improvement,
  "urgency_level": "low|medium|high|critical",
  "follow_up_required": boolean,
  "compliance_score": number between 0-1
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
  
  try {
    const result = await model.generateContent(prompt);
    const responseText = await result.response.text();
    const match = responseText.match(/\{[\s\S]*\}/);
    
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("No valid JSON found in response");
  } catch (error) {
    console.error("Gemini analysis error:", error);
    return getDefaultAnalysis();
  }
}

function getDefaultAnalysis() {
  return {
    overall_tone: "neutral",
    response_quality: "average",
    misbehavior_detected: false,
    red_flags: [],
    sentiment_score: 0.5,
    recommendation: "Unable to analyze conversation automatically. Manual review recommended.",
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
  
  try {
    const result = await model.generateContent(prompt);
    return (await result.response.text()).trim();
  } catch (error) {
    console.error("Summary generation error:", error);
    return "Conversation analysis completed. Manual review may be required for detailed insights.";
  }
}
