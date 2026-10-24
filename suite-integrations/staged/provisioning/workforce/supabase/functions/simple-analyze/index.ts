import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient as dsBase_createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.17.1"
const createClient=withSuiteClient(dsBase_createClient);


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(guardEdge(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { conversationId, transcript } = await req.json()
    
    if (!transcript || !conversationId) {
      return new Response(JSON.stringify({ error: 'Missing conversationId or transcript' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('Analyzing conversation:', conversationId)
    console.log('Transcript length:', transcript.length)

    const genAI = new GoogleGenerativeAI(Deno.env.get('ALLGOOGLE_KEY')!)
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

    const prompt = `
Analyze this customer service conversation transcript. This is a recording of an employee talking with a customer, captured as one continuous transcript.

Transcript: "${transcript}"

Please analyze this conversation and identify:
1. Speaker patterns (employee vs customer dialogue)
2. Conversation flow and turn-taking
3. Communication effectiveness
4. Problem resolution quality

Return JSON with these exact fields:
{
  "overall_tone": "professional|friendly|neutral|aggressive|dismissive",
  "response_quality": "excellent|good|average|poor|unacceptable",
  "sentiment_score": 0.7,
  "recommendation": "specific improvement recommendation",
  "communication_effectiveness": 0.8,
  "problem_resolution": "resolved|partially_resolved|unresolved|escalated",
  "key_issues": ["list of issues identified"],
  "positive_aspects": ["good practices noted"],
  "conversation_flow": "natural|choppy|one_sided|interrupted",
  "customer_satisfaction_indicators": ["indicators of customer mood/satisfaction"],
  "employee_performance": "excellent|good|average|needs_improvement",
  "dialogue_balance": "employee_dominated|customer_dominated|balanced",
  "conversation_summary": "brief summary of what was discussed"
}

Even though speakers aren't explicitly labeled, try to infer the conversation dynamics, customer concerns, and employee responses based on context, question patterns, and tone changes.
Provide realistic scores between 0-1 and actionable recommendations.
`

    const result = await model.generateContent(prompt)
    const responseText = result.response.text()
    
    console.log('AI response:', responseText)

    // Parse JSON from AI response
    let analysisData;
    try {
      // Clean the response text to extract JSON
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in AI response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      // Fallback analysis
      analysisData = {
        overall_tone: "neutral",
        response_quality: "average",
        sentiment_score: 0.5,
        recommendation: "Review conversation for quality improvement opportunities",
        communication_effectiveness: 0.5,
        problem_resolution: "unresolved",
        key_issues: ["Analysis parsing failed"],
        positive_aspects: ["Conversation recorded successfully"]
      };
    }

    // Save analysis to database
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Update conversation log
    const { error: updateError } = await supabase
      .from('conversation_logs')
      .update({ 
        ai_summary: JSON.stringify(analysisData),
        status: 'analyzed'
      })
      .eq('id', conversationId)

    if (updateError) {
      console.error('Database update error:', updateError)
      throw updateError
    }

    // Save to conversation_analysis table with enhanced fields
    const { error: insertError } = await supabase
      .from('conversation_analysis')
      .insert({
        conversation_id: conversationId,
        overall_tone: analysisData.overall_tone,
        response_quality: analysisData.response_quality,
        sentiment_score: analysisData.sentiment_score,
        recommendation: analysisData.recommendation,
        communication_effectiveness: analysisData.communication_effectiveness,
        problem_resolution: analysisData.problem_resolution,
        key_issues: analysisData.key_issues,
        positive_aspects: analysisData.positive_aspects,
        // Enhanced conversation analysis fields
        conversation_flow: analysisData.conversation_flow || 'natural',
        customer_satisfaction_indicators: analysisData.customer_satisfaction_indicators || [],
        employee_performance: analysisData.employee_performance || 'average',
        dialogue_balance: analysisData.dialogue_balance || 'balanced',
        conversation_summary: analysisData.conversation_summary || 'Conversation analysis completed'
      })

    if (insertError) {
      console.error('Analysis insert error:', insertError)
      // Don't throw here, analysis was saved to conversation_logs
    }

    console.log('Analysis completed successfully')

    return new Response(JSON.stringify({ success: true, analysis: analysisData }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Analysis error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}, 'workforce', 'simple-analyze'))
