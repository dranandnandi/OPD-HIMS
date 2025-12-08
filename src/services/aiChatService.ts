// AI Chat Service for communicating with AI agents via backend
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  pdf?: {
    data: string;
    filename: string;
  };
  isLoading?: boolean;
}

export interface ChatResponse {
  success: boolean;
  message: string;
  role: string;
  pdf?: {
    data: string;
    filename: string;
    contentType: string;
  };
  error?: string;
  details?: string;
}

export type AgentId = 'ayurvedic' | 'homeopathy' | 'allopathy';

class AIChatService {
  private baseUrl = '/.netlify/functions/ai-chat';

  /**
   * Send a message to the AI agent
   * @param agentId - The ID of the agent to communicate with
   * @param messages - Array of messages (conversation history)
   * @returns ChatResponse with AI response and optional PDF
   */
  async sendMessage(
    agentId: AgentId,
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): Promise<ChatResponse> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          agentId,
          messages,
          stream: false
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to get response from AI');
      }

      return data as ChatResponse;

    } catch (error) {
      console.error('AI Chat Service error:', error);
      return {
        success: false,
        message: '',
        role: 'assistant',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Download a PDF from base64 data
   * @param base64Data - Base64 encoded PDF data
   * @param filename - Name for the downloaded file
   */
  downloadPdf(base64Data: string, filename: string): void {
    try {
      // Convert base64 to blob
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('PDF download error:', error);
      throw new Error('Failed to download PDF');
    }
  }

  /**
   * Open PDF in a new tab
   * @param base64Data - Base64 encoded PDF data
   */
  openPdfInNewTab(base64Data: string): void {
    try {
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      console.error('PDF open error:', error);
      throw new Error('Failed to open PDF');
    }
  }

  /**
   * Generate unique message ID
   */
  generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export const aiChatService = new AIChatService();
