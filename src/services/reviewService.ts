import { supabase } from '../lib/supabase';
import { Review, ClinicSetting, ReviewRequestTemplate, SentMessageLog } from '../types';
import { defaultReviewRequestTemplates } from '../utils/reviewTemplates';
import { getCurrentProfile } from './profileService';
import { formatPhoneForWhatsApp } from '../utils/phoneUtils';

export interface AIReviewParams {
  clinicName: string;
  doctorName: string;
  treatment: string;
  date: string;
  patientName?: string;
}

export interface MessageGenerationParams {
  review: Review;
  messageType: 'ai_first' | 'ai_second' | 'simple_thank_you' | 'gmb_link' | 'follow_up';
  clinicSettings: ClinicSetting;
  reviewRequestTemplates?: ReviewRequestTemplate[];
  followUpDate?: string;
}

export interface MessageGenerationResult {
  messageContent: string;
  aiReviewText?: string;
}

export const reviewService = {
  // Log sent message to database
  async logSentMessage(params: {
    patientId: string;
    visitId?: string;
    messageType: string;
    messageContent: string;
    status: 'sent' | 'failed' | 'pending';
    deliveryMethod: 'manual_whatsapp' | 'blueticks_api';
    errorDetails?: string;
    sentBy?: string;
  }): Promise<SentMessageLog> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { data, error } = await supabase
        .from('sent_messages_log')
        .insert([{
          clinic_id: profile.clinicId,

          patient_id: params.patientId,
          visit_id: params.visitId || null,
          message_type: params.messageType,
          message_content: params.messageContent,
          status: params.status,
          delivery_method: params.deliveryMethod,
          error_details: params.errorDetails || null,
          sent_by: params.sentBy || null
        }])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to log sent message: ${error.message}`);
      }

      return {
        id: data.id,
        patientId: data.patient_id,
        visitId: data.visit_id,
        messageType: data.message_type,
        sentAt: new Date(data.sent_at),
        messageContent: data.message_content,
        status: data.status,
        deliveryMethod: data.delivery_method,
        errorDetails: data.error_details,
        sentBy: data.sent_by,
        createdAt: new Date(data.created_at)
      };
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error logging sent message:', error);
      }
      throw error;
    }
  },

  // Generate AI review using Supabase Edge Function
  async generateAIReview(params: AIReviewParams): Promise<string> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    try {
      // Get session token for authentication
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) throw new Error('Not authenticated');
      const token = session.access_token;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-review-generator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(params)
      });

      if (!response.ok) {
        throw new Error(`AI review generation failed: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error);
      }

      return result.reviewText;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error generating AI review:', error);
      }
      throw error;
    }
  },

  // Generate message content based on type
  async generateReviewMessageContent({
    review,
    messageType,
    clinicSettings,
    reviewRequestTemplates = defaultReviewRequestTemplates,
    followUpDate
  }: MessageGenerationParams): Promise<MessageGenerationResult> {
    let messageContent = '';
    let aiReviewText: string | undefined = review.aiReviewText;

    const formatDate = (dateString: string) => {
      return new Date(dateString).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    switch (messageType) {
      case 'ai_first': {
        const template = reviewRequestTemplates.find(t => t.templateType === 'ai_integrated');
        if (!template) throw new Error('AI integrated template not found.');

        if (!aiReviewText) {
          aiReviewText = await this.generateAIReview({
            clinicName: clinicSettings.clinicName,
            doctorName: review.doctorName || 'our medical team',
            treatment: review.treatment || 'consultation',
            date: formatDate(review.appointmentDate),
            patientName: review.patientName
          });
        }

        messageContent = template.messageTemplate
          .replace(/{patient_name}/g, review.patientName)
          .replace(/{clinic_name}/g, clinicSettings.clinicName)
          .replace(/{clinic_address}/g, clinicSettings.address)
          .replace(/{gmb_link}/g, clinicSettings.gmbLink || '')
          .replace(/{contact_phone}/g, clinicSettings.phone)
          .replace(/{visit_date}/g, formatDate(review.appointmentDate))
          .replace(/{ai_review_text}/g, aiReviewText);
        break;
      }

      case 'ai_second': {
        if (!aiReviewText) {
          aiReviewText = await this.generateAIReview({
            clinicName: clinicSettings.clinicName,
            doctorName: review.doctorName || 'our medical team',
            treatment: review.treatment || 'consultation',
            date: formatDate(review.appointmentDate),
            patientName: review.patientName
          });
        }

        const template = reviewRequestTemplates.find(t => t.templateType === 'ai_second');
        if (template) {
          messageContent = template.messageTemplate
            .replace(/{patient_name}/g, review.patientName)
            .replace(/{clinic_name}/g, clinicSettings.clinicName)
            .replace(/{ai_review_text}/g, aiReviewText)
            .replace(/{gmb_link}/g, clinicSettings.gmbLink || '');
        } else {
          messageContent = `Hello ${review.patientName},

Here's your personalized review suggestion for ${clinicSettings.clinicName}:

${aiReviewText}

Feel free to modify this review as needed before posting it on Google My Business: ${clinicSettings.gmbLink || ''}

Best regards,
Team ${clinicSettings.clinicName}`;
        }
        break;
      }

      case 'simple_thank_you': {
        const template = reviewRequestTemplates.find(t => t.templateType === 'simple_thank_you');
        if (!template) throw new Error('Simple thank you template not found.');

        messageContent = template.messageTemplate
          .replace(/{patient_name}/g, review.patientName)
          .replace(/{clinic_name}/g, clinicSettings.clinicName)
          .replace(/{clinic_address}/g, clinicSettings.address)
          .replace(/{gmb_link}/g, clinicSettings.gmbLink || '')
          .replace(/{contact_phone}/g, clinicSettings.phone)
          .replace(/{visit_date}/g, formatDate(review.appointmentDate));
        break;
      }

      case 'follow_up': {
        const template = reviewRequestTemplates.find(t => t.templateType === 'follow_up');
        if (!template) throw new Error('Follow-up template not found.');

        messageContent = template.messageTemplate
          .replace(/{patient_name}/g, review.patientName)
          .replace(/{clinic_name}/g, clinicSettings.clinicName)
          .replace(/{clinic_address}/g, clinicSettings.address)
          .replace(/{contact_phone}/g, clinicSettings.phone)
          .replace(/{follow_up_date}/g, followUpDate ? formatDate(followUpDate) : 'your scheduled date');
        break;
      }

      case 'gmb_link': {
        if (!clinicSettings.gmbLink) throw new Error('Google My Business link not configured.');
        messageContent = `Hello ${review.patientName},

Thank you for visiting ${clinicSettings.clinicName}. We would greatly appreciate your feedback.

You can submit your review here: ${clinicSettings.gmbLink}

Best regards,
Team ${clinicSettings.clinicName}`;
        break;
      }

      case 'gmb_link_only': {
        const template = reviewRequestTemplates.find(t => t.templateType === 'gmb_link_only');
        if (!template) throw new Error('GMB link only template not found.');

        messageContent = template.messageTemplate
          .replace(/{patient_name}/g, review.patientName)
          .replace(/{clinic_name}/g, clinicSettings.clinicName)
          .replace(/{gmb_link}/g, clinicSettings.gmbLink || '');
        break;
      }

      default:
        throw new Error('Invalid message type');
    }

    return { messageContent, aiReviewText };
  },

  // Send message manually via WhatsApp
  sendManually(phoneNumber: string, message: string): void {
    // Format phone number for WhatsApp
    const formattedPhone = formatPhoneForWhatsApp(phoneNumber);
    const encodedMessage = encodeURIComponent(message);
    
    // Detect if mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const baseUrl = isMobile ? 'whatsapp://send' : 'https://web.whatsapp.com/send';
    
    const whatsappUrl = `${baseUrl}?phone=${formattedPhone}&text=${encodedMessage}`;
    
    // Open WhatsApp
    window.open(whatsappUrl, '_blank');
  },

  // Send message directly via Blueticks API
  async sendDirectly(phoneNumber: string, message: string, apiKey: string): Promise<void> {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Blueticks API key not configured');
    }

    try {
      // Format phone number for API
      const formattedPhone = formatPhoneForWhatsApp(phoneNumber);
      
      const response = await fetch('https://api.blueticks.co/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiKey: apiKey,
          to: formattedPhone,
          message: message
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Blueticks API Error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      if (import.meta.env.DEV) {
        console.log('Message sent successfully via Blueticks:', result);
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error sending message via Blueticks:', error);
      }
      throw error;
    }
  },

  // Convert Visit to Review object
  visitToReview(visit: any): Review {
    return {
      id: visit.id,
      patientId: visit.patientId,
      patientName: visit.patient?.name || 'Unknown Patient',
      contactNumber: visit.patient?.phone || '',
      appointmentDate: visit.date.toISOString(),
      treatment: visit.chiefComplaint || 'consultation',
      visitId: visit.id,
      doctorId: visit.doctorId,
      doctorName: visit.doctor?.name || 'Doctor',
      aiReviewText: undefined,
      aiReviewFirstMessageSent: false,
      createdAt: visit.createdAt,
      updatedAt: visit.updatedAt,
      // Initialize message tracking fields
      followUpSent: false,
      thankYouSent: false,
      lastMessageSentAt: undefined
    };
  },

  // Check if messages have been sent for a visit
  async checkMessagesSent(visitId: string): Promise<{ followUpSent: boolean; thankYouSent: boolean }> {
    if (!supabase) throw new Error('Supabase client not initialized');

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('sent_messages_log')
      .select('message_type')
      .eq('visit_id', visitId)
      .eq('clinic_id', profile.clinicId)

      .eq('status', 'sent');

    if (error) {
      if (import.meta.env.DEV) {
        console.error('Error checking sent messages:', error);
      }
      return { followUpSent: false, thankYouSent: false };
    }

    const followUpSent = data.some(msg => msg.message_type === 'follow_up');
    const thankYouSent = data.some(msg => 
      ['ai_first', 'ai_second', 'simple_thank_you', 'gmb_link_only'].includes(msg.message_type)
    );

    return { followUpSent, thankYouSent };
  }
};