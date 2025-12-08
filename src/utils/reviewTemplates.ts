import { ReviewRequestTemplate } from '../types';

export const defaultReviewRequestTemplates: ReviewRequestTemplate[] = [
  {
    id: 'default-ai-integrated',
    name: 'AI-Powered Review Request',
    templateType: 'ai_integrated',
    messageTemplate: `Hello {patient_name},

We hope you had a satisfying experience with the services at {clinic_name}. Your feedback is highly valuable to us, and we would greatly appreciate it if you could share your review.

Your visit details:
📅 Date: {visit_date}
🏥 Name of Center: {clinic_name}
📍 Location: {clinic_address}

Here's a suggested review based on your visit:

{ai_review_text}

You can submit your review here: {gmb_link}

Best regards,
Team {clinic_name}
📞 {contact_phone}`,
    description: 'AI-generated review suggestion with GMB link in one message'
  },
  {
    id: 'default-simple-thank-you',
    name: 'Simple Thank You & Review Link',
    templateType: 'simple_thank_you',
    messageTemplate: `Hello {patient_name},

Thank you for choosing {clinic_name} for your healthcare needs. We hope you had a positive experience with our services.

Your visit details:
📅 Date: {visit_date}
🏥 Name of Center: {clinic_name}
📍 Location: {clinic_address}

We would greatly appreciate if you could take a moment to share your feedback and leave us a review: {gmb_link}

Your feedback helps us improve our services and assists other patients in making informed decisions.

Best regards,
Team {clinic_name}
📞 {contact_phone}`,
    description: 'Simple thank you message with review link'
  },
  {
    id: 'default-ai-second',
    name: 'AI Review Suggestion Only',
    templateType: 'ai_second',
    messageTemplate: `Hello {patient_name},

Here's your personalized review suggestion for {clinic_name}:

{ai_review_text}

Feel free to modify this review as needed before posting it on Google My Business: {gmb_link}

Best regards,
Team {clinic_name}`,
    description: 'AI-generated review text only with GMB link'
  },
  {
    id: 'default-follow-up',
    name: 'Follow-up Message',
    templateType: 'follow_up',
    messageTemplate: `Hello {patient_name},

This is a gentle reminder about your follow-up appointment scheduled for {follow_up_date} at {clinic_name}.

Please confirm your attendance or let us know if you need to reschedule.

📍 Location: {clinic_address}
📞 Contact: {contact_phone}

We look forward to seeing you soon.

Best regards,
Team {clinic_name}`,
    description: 'Follow-up appointment reminder message'
  },
  {
    id: 'default-gmb-link-only',
    name: 'GMB Link Only',
    templateType: 'gmb_link_only',
    messageTemplate: `Hello {patient_name},

Thank you for visiting {clinic_name}. We would greatly appreciate your feedback.

You can submit your review here: {gmb_link}

Best regards,
Team {clinic_name}`,
    description: 'Direct link to Google My Business review only'
  }
];