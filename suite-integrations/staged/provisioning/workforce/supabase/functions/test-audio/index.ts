import { guardEdge, runtimeFetch } from '../_shared/suite-runtime-guard.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

serve(guardEdge(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    console.log("Test function called");
    
    const audioUrl = "https://hnyqfasddflqzfibtjjz.supabase.co/storage/v1/object/public/conversation-recordings/00000000-0000-0000-0000-000000000018_2025-08-18T09-33-13-141Z.webm";
    
    console.log("Testing audio download and conversion...");
    
    // Download the audio file
    const audioResponse = await runtimeFetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download audio: ${audioResponse.status}`);
    }
    
    const audioBlob = await audioResponse.blob();
    console.log("Audio file downloaded, size:", audioBlob.size, "bytes");
    console.log("Audio type:", audioBlob.type);
    
    // Test base64 conversion
    console.log("Testing base64 conversion...");
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBytes = new Uint8Array(arrayBuffer);
    console.log("Audio buffer size:", audioBytes.length, "bytes");
    
    // Use byte-by-byte conversion for this small file
    let binaryString = '';
    for (let i = 0; i < audioBytes.length; i++) {
      binaryString += String.fromCharCode(audioBytes[i]);
      
      // Log progress every 50KB
      if (i % 50000 === 0 && i > 0) {
        console.log(`Processed ${i} / ${audioBytes.length} bytes`);
      }
    }
    
    console.log("Converting to base64...");
    const base64Audio = btoa(binaryString);
    console.log("Base64 conversion successful, length:", base64Audio.length);
    
    // Test Google Speech API call (without actually sending)
    const allGoogleKey = Deno.env.get("ALLGOOGLE_KEY");
    
    const result = {
      success: true,
      audioSize: audioBlob.size,
      audioType: audioBlob.type,
      base64Length: base64Audio.length,
      hasApiKey: !!allGoogleKey,
      apiKeySource: allGoogleKey ? "ALLGOOGLE_KEY" : "none"
    };
    
    console.log("Test completed successfully:", result);
    
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Test failed:", errorMessage);
    
    return new Response(JSON.stringify({ 
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
}, 'workforce', 'test-audio'));
