import { Handler } from '@netlify/functions';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatRequest {
  agentId: string;
  messages: ChatMessage[];
  stream?: boolean;
}

interface AgentConfig {
  baseUrl: string;
  accessKey: string;
}

// Agent configurations with direct keys
const AGENT_CONFIGS: Record<string, AgentConfig> = {
  'ayurvedic': {
    baseUrl: 'https://gob47zcuxb24jnk7fvvk33zz.agents.do-ai.run',
    accessKey: '4bmm-m2YfILlRTeTlH6pHyNurm3DAXSN'
  },
  'homeopathy': {
    baseUrl: 'https://uqpvf3dzs3veadgdin3ulijl.agents.do-ai.run',
    accessKey: 'iUsYx0jvFzP7s6ZiWu2ELQsVn50qQI95'
  },
  'allopathy': {
    baseUrl: 'https://xiwvk6vcmzhpf4e6ogomhipv.agents.do-ai.run',
    accessKey: 'ZmPaWuGFXfIFv2o2uUBkebaAdYICL4SO'
  }
};

export const handler: Handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { agentId, messages, stream = false }: ChatRequest = JSON.parse(event.body || '{}');

    if (!agentId || !messages || messages.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'agentId and messages are required' })
      };
    }

    const agentConfig = AGENT_CONFIGS[agentId];
    if (!agentConfig) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Unknown agent: ${agentId}` })
      };
    }

    const accessKey = agentConfig.accessKey;

    console.log(`Calling AI agent: ${agentId} at ${agentConfig.baseUrl}`);

    // Call the AI agent
    const response = await fetch(`${agentConfig.baseUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessKey}`
      },
      body: JSON.stringify({
        messages,
        stream,
        include_functions_info: true,
        include_retrieval_info: false,
        include_guardrails_info: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Agent API error:', response.status, errorText);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ 
          error: 'Agent API request failed', 
          status: response.status,
          details: errorText 
        })
      };
    }

    const data = await response.json();

    // Check for PDF in tool_calls
    let pdfData: string | null = null;
    let pdfFilename: string = 'ayurvedic-report.pdf';

    const message = data.choices?.[0]?.message;
    
    // Check different possible locations for tool calls / function results
    if (message?.tool_calls) {
      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.tool_name || toolCall.function?.name || '';
        if (toolName.includes('pdf') || toolName.includes('generate_pdf')) {
          const output = toolCall.output || toolCall.function?.output || toolCall.result;
          if (output?.body) {
            pdfData = output.body;
            const contentDisposition = output.headers?.['Content-Disposition'] || '';
            const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
            if (filenameMatch) {
              pdfFilename = filenameMatch[1];
            }
          }
        }
      }
    }

    // Also check function_call for older API format
    if (!pdfData && message?.function_call) {
      const funcName = message.function_call.name || '';
      if (funcName.includes('pdf')) {
        try {
          const args = JSON.parse(message.function_call.arguments || '{}');
          if (args.body) {
            pdfData = args.body;
          }
        } catch (e) {
          console.error('Failed to parse function_call arguments:', e);
        }
      }
    }

    // Return response with extracted PDF if present
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: message?.content || '',
        role: message?.role || 'assistant',
        pdf: pdfData ? {
          data: pdfData,
          filename: pdfFilename,
          contentType: 'application/pdf'
        } : null
      })
    };

  } catch (error) {
    console.error('AI Chat error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      })
    };
  }
};
