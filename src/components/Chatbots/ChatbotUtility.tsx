import React, { useState, useRef, useEffect } from 'react';
import { 
  Bot, 
  X, 
  MessageCircle, 
  Send, 
  Download, 
  FileText, 
  Loader2, 
  Trash2,
  Sparkles,
  User
} from 'lucide-react';
import jsPDF from 'jspdf';
import { aiChatService, ChatMessage, AgentId } from '../../services/aiChatService';

// Chatbot configurations
interface ChatbotConfig {
  id: string;
  agentId: AgentId;
  name: string;
  description: string;
  icon: string;
  gradientFrom: string;
  gradientTo: string;
  bgLight: string;
  textColor: string;
  features: string[];
  exampleQuestions: string[];
  systemPrompt: string;
}

const CHATBOTS: ChatbotConfig[] = [
  {
    id: 'ayurvedic-health-guide',
    agentId: 'ayurvedic',
    name: 'Ayurvedic Health Guide',
    description: 'Get personalized Ayurvedic health advice, dosha balancing tips, and natural remedies based on ancient Indian wisdom.',
    icon: '🌱',
    gradientFrom: 'from-green-500',
    gradientTo: 'to-emerald-600',
    bgLight: 'bg-green-50',
    textColor: 'text-green-700',
    features: [
      'Dosha Assessment',
      'Diet Recommendations',
      'Herbal Remedies',
      'PDF Reports'
    ],
    exampleQuestions: [
      'What is my dosha type?',
      'Natural remedies for digestion',
      'How to balance Pitta dosha?',
      'Remedies for headache'
    ],
    systemPrompt: 'You are an expert Ayurvedic health guide. Provide advice based on traditional Ayurvedic principles including dosha assessment, diet recommendations, herbal remedies, and lifestyle guidance. Always recommend consulting a qualified Ayurvedic practitioner for serious health conditions. Give direct, helpful answers without asking users to choose options. Provide comprehensive wellness information in a clear, organized format with sections and bullet points.'
  },
  {
    id: 'homeopathy-assistant',
    agentId: 'homeopathy',
    name: 'Homeopathy Assistant',
    description: 'Expert guidance on homeopathic remedies, potencies, and natural healing approaches.',
    icon: '💊',
    gradientFrom: 'from-purple-500',
    gradientTo: 'to-violet-600',
    bgLight: 'bg-purple-50',
    textColor: 'text-purple-700',
    features: [
      'Remedy Selection',
      'Potency Guidance',
      'Constitutional Treatment',
      'PDF Reports'
    ],
    exampleQuestions: [
      'Remedy for cold and flu',
      'What potency should I use?',
      'Remedies for anxiety',
      'Treatment for allergies'
    ],
    systemPrompt: 'You are a homeopathy assistant. Provide guidance on homeopathic remedies, potencies, and treatment approaches. Always recommend consulting a qualified homeopath for proper treatment. Give direct, helpful answers without asking users to choose options. Provide comprehensive remedy information in a clear, organized format.'
  },
  {
    id: 'allopathy-assistant',
    agentId: 'allopathy',
    name: 'Allopathy Assistant',
    description: 'Evidence-based medical guidance including history-taking, examinations, and treatment protocols.',
    icon: '⚕️',
    gradientFrom: 'from-blue-500',
    gradientTo: 'to-indigo-600',
    bgLight: 'bg-blue-50',
    textColor: 'text-blue-700',
    features: [
      'Clinical History',
      'Examination Steps',
      'Investigations',
      'Treatment Protocols'
    ],
    exampleQuestions: [
      'History-taking for respiratory symptoms',
      'Examination steps for chest pain',
      'Investigations for suspected diabetes',
      'Treatment for hypertension'
    ],
    systemPrompt: 'You are a medical assistant providing evidence-based guidance. Help with history-taking, examination steps, investigations, and treatment protocols. Always recommend consulting a qualified physician for diagnosis and treatment. Give direct, helpful answers without asking users to choose options. Provide comprehensive medical information in a clear, organized format.'
  }
];

const ChatbotUtility: React.FC = () => {
  const [activeChatbot, setActiveChatbot] = useState<ChatbotConfig | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (activeChatbot) {
      inputRef.current?.focus();
    }
  }, [activeChatbot]);

  const handleLaunchChatbot = (chatbot: ChatbotConfig) => {
    setActiveChatbot(chatbot);
    // Add welcome message
    const welcomeMessage: ChatMessage = {
      id: aiChatService.generateMessageId(),
      role: 'assistant',
      content: `🌱 **Namaste! Welcome to ${chatbot.name}!**\n\n${chatbot.description}\n\n**I can help you with:**\n${chatbot.features.map(f => `• ${f}`).join('\n')}\n\n**Try asking:**\n${chatbot.exampleQuestions.slice(0, 3).map(q => `• "${q}"`).join('\n')}\n\nHow can I assist you today?`,
      timestamp: new Date()
    };
    setMessages([welcomeMessage]);
  };

  const handleCloseChatbot = () => {
    setActiveChatbot(null);
    setMessages([]);
    setInputValue('');
  };

  const handleClearChat = () => {
    if (activeChatbot) {
      const welcomeMessage: ChatMessage = {
        id: aiChatService.generateMessageId(),
        role: 'assistant',
        content: `Chat cleared. How can I help you?`,
        timestamp: new Date()
      };
      setMessages([welcomeMessage]);
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !activeChatbot || isLoading) return;

    const userMessage: ChatMessage = {
      id: aiChatService.generateMessageId(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date()
    };

    // Add user message
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    // Add loading message
    const loadingId = aiChatService.generateMessageId();
    setMessages(prev => [...prev, {
      id: loadingId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true
    }]);

    try {
      // Build conversation history for context
      const conversationHistory = [
        { role: 'system' as const, content: activeChatbot.systemPrompt },
        ...messages
          .filter(m => !m.isLoading)
          .map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: userMessage.content }
      ];

      const response = await aiChatService.sendMessage(
        activeChatbot.agentId,
        conversationHistory
      );

      // Remove loading message and add response
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== loadingId);
        const assistantMessage: ChatMessage = {
          id: aiChatService.generateMessageId(),
          role: 'assistant',
          content: response.success 
            ? response.message || 'I received your message but have no response to show.'
            : `❌ **Error:** ${response.error || 'Something went wrong. Please try again.'}`,
          timestamp: new Date(),
          pdf: response.pdf ? {
            data: response.pdf.data,
            filename: response.pdf.filename
          } : undefined
        };
        return [...filtered, assistantMessage];
      });

    } catch (error) {
      // Remove loading message and add error
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== loadingId);
        return [...filtered, {
          id: aiChatService.generateMessageId(),
          role: 'assistant',
          content: `❌ **Error:** ${error instanceof Error ? error.message : 'Failed to get response'}`,
          timestamp: new Date()
        }];
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleExampleClick = (question: string) => {
    setInputValue(question);
    inputRef.current?.focus();
  };

  // Check if the AI response mentions PDF generation
  const detectPdfMention = (content: string): boolean => {
    const pdfKeywords = [
      'pdf generated',
      'generating pdf',
      'pdf report',
      'download link',
      'pdf contents',
      'generate standard pdf',
      'generating pdf... please wait',
      'pdf generation',
      'wellness pdf',
      'filename:',
      'pages:',
      'pdf sections'
    ];
    const lowerContent = content.toLowerCase();
    return pdfKeywords.some(keyword => lowerContent.includes(keyword));
  };

  // Generate actual PDF from conversation content
  const generatePdfFromConversation = async () => {
    if (!activeChatbot) return;
    
    setIsGeneratingPdf(true);
    
    try {
      // Get all assistant messages (excluding welcome and loading)
      const assistantMessages = messages.filter(
        m => m.role === 'assistant' && !m.isLoading && m.content.length > 100
      );
      
      if (assistantMessages.length === 0) {
        alert('No content available to generate PDF. Please ask a health question first.');
        return;
      }

      // Create PDF
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      const lineHeight = 7;
      let yPosition = margin;

      // Helper function to add text with word wrap
      const addText = (text: string, fontSize: number, isBold: boolean = false, color: [number, number, number] = [0, 0, 0]) => {
        pdf.setFontSize(fontSize);
        pdf.setFont('helvetica', isBold ? 'bold' : 'normal');
        pdf.setTextColor(color[0], color[1], color[2]);
        
        const lines = pdf.splitTextToSize(text, pageWidth - 2 * margin);
        
        for (const line of lines) {
          if (yPosition > pageHeight - margin) {
            pdf.addPage();
            yPosition = margin;
          }
          pdf.text(line, margin, yPosition);
          yPosition += lineHeight;
        }
      };

      // Header with gradient effect (simulated)
      const headerColor: [number, number, number] = activeChatbot.agentId === 'ayurvedic' 
        ? [34, 197, 94] // Green
        : activeChatbot.agentId === 'homeopathy' 
        ? [168, 85, 247] // Purple
        : [59, 130, 246]; // Blue

      pdf.setFillColor(headerColor[0], headerColor[1], headerColor[2]);
      pdf.rect(0, 0, pageWidth, 50, 'F');
      
      // Add Doctorpreneur Logo/Branding
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text('DOCTORPRENEUR ACADEMY', margin, 12);
      
      // Title - without emoji
      pdf.setFontSize(22);
      pdf.setFont('helvetica', 'bold');
      pdf.text(activeChatbot.name, margin, 28);
      
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Health & Wellness Report', margin, 38);
      
      // Date
      pdf.setFontSize(10);
      pdf.text(`Generated: ${new Date().toLocaleDateString('en-IN', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}`, pageWidth - margin - 60, 38);
      
      yPosition = 60;

      // Disclaimer - without emoji
      pdf.setFillColor(255, 243, 205);
      pdf.rect(margin - 5, yPosition - 5, pageWidth - 2 * margin + 10, 20, 'F');
      pdf.setTextColor(133, 100, 4);
      pdf.setFontSize(9);
      pdf.text('DISCLAIMER: This information is for educational purposes only.', margin, yPosition + 3);
      pdf.text('Always consult a qualified healthcare professional for medical advice.', margin, yPosition + 10);
      yPosition += 30;

      // Content sections
      pdf.setTextColor(0, 0, 0);
      
      // Process each assistant message
      assistantMessages.forEach((msg, index) => {
        // Clean up the content - remove ALL emojis and unicode symbols for cleaner PDF
        let content = msg.content
          // Remove all emojis using unicode ranges
          .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{2B06}]|[\u{2934}-\u{2935}]|[\u{25AA}-\u{25AB}]|[\u{25B6}]|[\u{25C0}]|[\u{25FB}-\u{25FE}]|[\u{2614}-\u{2615}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}-\u{26AB}]|[\u{26BD}-\u{26BE}]|[\u{26C4}-\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}-\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2702}]|[\u{2705}]|[\u{2708}-\u{270D}]|[\u{270F}]|[\u{2712}]|[\u{2714}]|[\u{2716}]|[\u{271D}]|[\u{2721}]|[\u{2728}]|[\u{2733}-\u{2734}]|[\u{2744}]|[\u{2747}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2763}-\u{2764}]|[\u{2795}-\u{2797}]|[\u{27A1}]|[\u{27B0}]|[\u{27BF}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{2B55}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}]|[\u{FE00}-\u{FE0F}]|[\u{200D}]/gu, '')
          // Also remove common text emojis
          .replace(/[🌱🌿🔥✅✓💬✨📄🍃🧘‍♂️🔹💊⚕️❌📊🎯💡🏥🩺💉🌡️🔬🏋️‍♂️🧘‍♀️]/g, '')
          .replace(/\*\*/g, '')
          .trim();

        // Skip welcome messages and PDF generation messages
        if (content.includes('Welcome to') || content.includes('PDF GENERATED') || content.includes('Generating PDF') || content.includes('PDF Downloaded')) {
          return;
        }

        // Add section separator if not first
        if (index > 0) {
          yPosition += 5;
          pdf.setDrawColor(200, 200, 200);
          pdf.line(margin, yPosition, pageWidth - margin, yPosition);
          yPosition += 10;
        }

        // Process content line by line
        const lines = content.split('\n');
        
        lines.forEach(line => {
          const trimmedLine = line.trim();
          if (!trimmedLine) {
            yPosition += 3;
            return;
          }

          // Check for headers (lines that end with colon or start with numbers)
          if (trimmedLine.endsWith(':') || /^\d+\./.test(trimmedLine)) {
            yPosition += 3;
            addText(trimmedLine, 12, true, headerColor);
          }
          // Bullet points
          else if (trimmedLine.startsWith('•') || trimmedLine.startsWith('-')) {
            addText(`  ${trimmedLine}`, 10, false);
          }
          // Regular text
          else {
            addText(trimmedLine, 10, false);
          }
        });
      });

      // Footer with Doctorpreneur branding
      const totalPages = pdf.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(128, 128, 128);
        pdf.text(
          `Page ${i} of ${totalPages} | ${activeChatbot.name} | Doctorpreneur Academy | docpreneur.academy`,
          pageWidth / 2,
          pageHeight - 10,
          { align: 'center' }
        );
      }

      // Generate filename with branding
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `Doctorpreneur_${activeChatbot.name.replace(/\s+/g, '_')}_Report_${timestamp}.pdf`;
      
      // Save the PDF
      pdf.save(filename);

      // Add success message to chat
      setMessages(prev => [...prev, {
        id: aiChatService.generateMessageId(),
        role: 'assistant',
        content: `✅ **PDF Downloaded Successfully!**\n\n📄 **Filename:** ${filename}\n📊 **Pages:** ${totalPages}\n\nYour wellness report has been downloaded. Check your downloads folder.`,
        timestamp: new Date()
      }]);

    } catch (error) {
      console.error('PDF generation error:', error);
      setMessages(prev => [...prev, {
        id: aiChatService.generateMessageId(),
        role: 'assistant',
        content: `❌ **Error generating PDF:** ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
        timestamp: new Date()
      }]);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // Format message content with markdown-like styling
  const formatMessage = (content: string) => {
    return content
      .split('\n')
      .map((line, idx) => {
        // Bold text
        line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // Bullet points
        if (line.startsWith('• ') || line.startsWith('- ')) {
          return `<div class="ml-4">${line}</div>`;
        }
        return line;
      })
      .join('<br/>');
  };

  return (
    <div className="p-6 bg-gradient-to-br from-green-50 via-blue-50 to-purple-50 min-h-screen">
      {/* Header */}
      <div className="mb-6 text-center">
        <div className="flex items-center justify-center gap-3 mb-2">
          <Bot className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">AI Health Assistants</h1>
          <Sparkles className="w-6 h-6 text-yellow-500" />
        </div>
        <p className="text-sm text-gray-600">
          Choose a specialized AI assistant for personalized health guidance
        </p>
      </div>

      {/* Chatbot Cards Grid */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {CHATBOTS.map((chatbot) => (
          <div 
            key={chatbot.id} 
            className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200 hover:shadow-xl transition-all hover:scale-[1.02]"
          >
            {/* Header */}
            <div className={`p-4 text-white bg-gradient-to-r ${chatbot.gradientFrom} ${chatbot.gradientTo}`}>
              <div className="flex items-center gap-3">
                <div className="text-4xl">{chatbot.icon}</div>
                <div>
                  <h3 className="text-lg font-bold">{chatbot.name}</h3>
                  <p className="text-xs opacity-90">AI-Powered Assistant</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-4">
              <p className="text-sm text-gray-600 mb-4">{chatbot.description}</p>
              
              {/* Features */}
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-700 mb-2">Features:</p>
                <div className="flex flex-wrap gap-1">
                  {chatbot.features.map((feature, idx) => (
                    <span 
                      key={idx} 
                      className={`text-xs px-2 py-1 rounded ${chatbot.bgLight} ${chatbot.textColor}`}
                    >
                      {feature}
                    </span>
                  ))}
                </div>
              </div>

              {/* Launch Button */}
              <button
                onClick={() => handleLaunchChatbot(chatbot)}
                className={`w-full py-2.5 rounded-lg text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 bg-gradient-to-r ${chatbot.gradientFrom} ${chatbot.gradientTo} hover:opacity-90`}
              >
                <MessageCircle className="w-4 h-4" />
                Start Chat
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Info Note */}
      <div className="mt-6 max-w-6xl mx-auto">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p className="text-xs text-yellow-800 text-center">
            <span className="font-semibold">⚠️ Note:</span> These AI assistants provide educational information. 
            Always consult qualified healthcare professionals for medical diagnosis and treatment.
            <br />
            <span className="font-semibold">✨ Pro Tip:</span> Ask the assistant to generate a PDF report for detailed wellness plans!
          </p>
        </div>
      </div>

      {/* Chat Modal */}
      {activeChatbot && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className={`p-4 text-white flex items-center justify-between bg-gradient-to-r ${activeChatbot.gradientFrom} ${activeChatbot.gradientTo}`}>
              <div className="flex items-center gap-3">
                <div className="text-3xl">{activeChatbot.icon}</div>
                <div>
                  <h2 className="text-xl font-bold">{activeChatbot.name}</h2>
                  <p className="text-sm opacity-90">AI-powered health guidance</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Download PDF Button - Show when there's substantial content */}
                {messages.filter(m => m.role === 'assistant' && !m.isLoading && m.content.length > 100).length > 1 && (
                  <button
                    onClick={generatePdfFromConversation}
                    disabled={isGeneratingPdf}
                    className="flex items-center gap-1 px-3 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors text-sm"
                    title="Download conversation as PDF"
                  >
                    {isGeneratingPdf ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    <span className="hidden sm:inline">PDF</span>
                  </button>
                )}
                <button
                  onClick={handleClearChat}
                  className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                  title="Clear chat"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                <button
                  onClick={handleCloseChatbot}
                  className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                  title="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl p-4 ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-md'
                        : 'bg-white text-gray-800 shadow-md rounded-bl-md border border-gray-100'
                    }`}
                  >
                    {/* Avatar */}
                    <div className={`flex items-start gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        message.role === 'user' 
                          ? 'bg-blue-500' 
                          : `bg-gradient-to-r ${activeChatbot.gradientFrom} ${activeChatbot.gradientTo}`
                      }`}>
                        {message.role === 'user' ? (
                          <User className="w-4 h-4 text-white" />
                        ) : (
                          <span className="text-lg">{activeChatbot.icon}</span>
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        {message.isLoading ? (
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                            <span className="text-gray-500 text-sm">Thinking...</span>
                          </div>
                        ) : (
                          <>
                            <div 
                              className="prose prose-sm max-w-none"
                              dangerouslySetInnerHTML={{ __html: formatMessage(message.content) }}
                            />
                            
                            {/* Show PDF Download button when AI mentions PDF generation or has substantial content */}
                            {message.role === 'assistant' && detectPdfMention(message.content) && (
                              <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
                                <div className="flex items-center gap-2 mb-2">
                                  <FileText className="w-5 h-5 text-green-600" />
                                  <span className="text-sm font-medium text-green-800">
                                    Generate Your PDF Report
                                  </span>
                                </div>
                                <button
                                  onClick={generatePdfFromConversation}
                                  disabled={isGeneratingPdf}
                                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                                >
                                  {isGeneratingPdf ? (
                                    <>
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                      Generating PDF...
                                    </>
                                  ) : (
                                    <>
                                      <Download className="w-4 h-4" />
                                      Download PDF Report
                                    </>
                                  )}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                        
                        {/* Timestamp */}
                        {!message.isLoading && (
                          <p className={`text-xs mt-2 ${message.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Example Questions */}
            {messages.length <= 1 && (
              <div className="px-4 py-2 bg-white border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-2">Try asking:</p>
                <div className="flex flex-wrap gap-2">
                  {activeChatbot.exampleQuestions.map((question, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleExampleClick(question)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${activeChatbot.bgLight} ${activeChatbot.textColor} border-current hover:opacity-80`}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-gray-200">
              <div className="flex items-center gap-3">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type your health question..."
                  disabled={isLoading}
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || isLoading}
                  className={`p-3 rounded-xl text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r ${activeChatbot.gradientFrom} ${activeChatbot.gradientTo} hover:opacity-90`}
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2 text-center">
                Press Enter to send • Click the PDF button in header to download your wellness report
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatbotUtility;
