import React, { useState, useEffect } from 'react';
import { Save, Bell, MessageSquare, DollarSign, Star, Calendar, TestTube, ClipboardList } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../Auth/useAuth';
import type { WhatsAppEventType, WhatsAppAutoSendRule, WhatsAppMessageTemplate } from '../../types/whatsapp';

const EVENT_TYPES: { type: WhatsAppEventType; label: string; icon: React.ElementType; description: string }[] = [
  {
    type: 'appointment_confirmed',
    label: 'Appointment Confirmed',
    icon: Calendar,
    description: 'Send confirmation when appointment is booked'
  },
  {
    type: 'appointment_reminder',
    label: 'Appointment Reminder',
    icon: Bell,
    description: 'Remind patients before appointment'
  },
  {
    type: 'bill_created',
    label: 'Bill Created',
    icon: DollarSign,
    description: 'Send bill details after visit'
  },
  {
    type: 'payment_received',
    label: 'Payment Received',
    icon: DollarSign,
    description: 'Confirm payment receipt'
  },
  {
    type: 'gmb_review_request',
    label: 'Google Review Request',
    icon: Star,
    description: 'Request Google My Business review'
  },
  {
    type: 'prescription_ready',
    label: 'Prescription Ready',
    icon: ClipboardList,
    description: 'Notify when prescription is ready'
  },
  {
    type: 'test_result_ready',
    label: 'Test Results Ready',
    icon: TestTube,
    description: 'Notify when test results are available'
  }
];

// Define formatBalanceMessage before using it in DEFAULT_TEMPLATES
const formatBalanceMessage = '{{#if balanceAmount}}Balance: {{balanceAmount}} - Please pay at the reception.{{else}}Fully paid. Thank you!{{/if}}';

const DEFAULT_TEMPLATES: Record<WhatsAppEventType, string> = {
  appointment_confirmed: `Dear {{patientName}},

Your appointment has been confirmed at {{clinicName}}.

📅 Date & Time: {{appointmentDate}}
👨‍⚕️ Doctor: {{doctorName}}
📍 Type: {{appointmentType}}

Please arrive 10 minutes early. If you need to reschedule, please call us.

Thank you!`,

  appointment_reminder: `Dear {{patientName}},

This is a friendly reminder about your appointment at {{clinicName}}.

📅 Date & Time: {{appointmentDate}}
👨‍⚕️ Doctor: {{doctorName}}

See you soon!`,

  bill_created: `Dear {{patientName}},

Thank you for visiting {{clinicName}}.

Bill #{{billNumber}}
Total: {{totalAmount}}
Paid: {{paidAmount}}
Balance: {{balanceAmount}}

${formatBalanceMessage}

Thank you!`,

  payment_received: `Dear {{patientName}},

Payment Received - {{clinicName}}

Bill #{{billNumber}}
Amount Paid: {{amountPaid}}
Remaining Balance: {{balanceAmount}}

Thank you for your payment!`,

  gmb_review_request: `Dear {{patientName}},

Thank you for visiting {{clinicName}}! We hope you had a great experience.

We would greatly appreciate if you could share your feedback on Google:
{{reviewLink}}

Your review helps us serve you better.

Thank you!`,

  prescription_ready: `Dear {{patientName}},

Your prescription from {{clinicName}} is ready for collection.

Please collect it during our working hours.

Thank you!`,

  test_result_ready: `Dear {{patientName}},

Your test results from {{clinicName}} are ready.

Please visit us to collect your reports or call us for details.

Thank you!`,

  appointment_cancelled: `Dear {{patientName}},

Your appointment at {{clinicName}} has been cancelled.

If you would like to reschedule, please contact us.

Thank you!`,

  follow_up_reminder: `Dear {{patientName}},

This is a reminder for your follow-up visit at {{clinicName}}.

Please schedule an appointment at your earliest convenience.

Thank you!`
};

const WhatsAppAutoSendSettings: React.FC = () => {
  const { user } = useAuth();
  const [rules, setRules] = useState<Record<WhatsAppEventType, WhatsAppAutoSendRule | null>>({} as any);
  const [templates, setTemplates] = useState<Record<WhatsAppEventType, string>>({} as any);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<WhatsAppEventType | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (user?.clinicId) {
      loadSettings();
    }
  }, [user?.clinicId]);

  const loadSettings = async () => {
    if (!user?.clinicId) return;

    try {
      setLoading(true);

      // Load rules
      const { data: rulesData } = await supabase
        .from('whatsapp_auto_send_rules')
        .select('*')
        .eq('clinic_id', user.clinicId);

      const rulesMap: Record<string, WhatsAppAutoSendRule> = {};
      rulesData?.forEach(rule => {
        rulesMap[rule.event_type] = rule as WhatsAppAutoSendRule;
      });

      setRules(rulesMap as any);

      // Load templates
      const { data: templatesData } = await supabase
        .from('whatsapp_message_templates')
        .select('*')
        .eq('clinic_id', user.clinicId);

      const templatesMap: Record<string, string> = {};
      templatesData?.forEach(template => {
        templatesMap[template.event_type] = template.message_content;
      });

      // Merge with default templates
      const finalTemplates: Record<string, string> = {};
      EVENT_TYPES.forEach(({ type }) => {
        finalTemplates[type] = templatesMap[type] || DEFAULT_TEMPLATES[type] || '';
      });

      setTemplates(finalTemplates as any);
    } catch (error) {
      console.error('Failed to load settings:', error);
      setMessage({ type: 'error', text: 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  };

  const toggleRule = async (eventType: WhatsAppEventType) => {
    if (!user?.clinicId) return;

    try {
      const currentRule = rules[eventType];
      const newEnabled = !currentRule?.enabled;

      if (currentRule) {
        // Update existing rule
        await supabase
          .from('whatsapp_auto_send_rules')
          .update({ enabled: newEnabled })
          .eq('id', currentRule.id);
      } else {
        // Create new rule
        await supabase
          .from('whatsapp_auto_send_rules')
          .insert({
            clinic_id: user.clinicId,
            event_type: eventType,
            enabled: newEnabled,
            delay_minutes: 0
          });
      }

      await loadSettings();
      setMessage({ type: 'success', text: 'Setting updated successfully' });
    } catch (error) {
      console.error('Failed to toggle rule:', error);
      setMessage({ type: 'error', text: 'Failed to update setting' });
    }
  };

  const saveTemplate = async () => {
    if (!user?.clinicId || !selectedEvent) return;

    try {
      setSaving(true);

      const { data: existing } = await supabase
        .from('whatsapp_message_templates')
        .select('id')
        .eq('clinic_id', user.clinicId)
        .eq('event_type', selectedEvent)
        .single();

      if (existing) {
        await supabase
          .from('whatsapp_message_templates')
          .update({
            message_content: templates[selectedEvent],
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('whatsapp_message_templates')
          .insert({
            clinic_id: user.clinicId,
            event_type: selectedEvent,
            name: EVENT_TYPES.find(e => e.type === selectedEvent)?.label || selectedEvent,
            message_content: templates[selectedEvent],
            variables: extractVariables(templates[selectedEvent]),
            is_default: true
          });
      }

      setMessage({ type: 'success', text: 'Template saved successfully' });
      setSelectedEvent(null);
    } catch (error) {
      console.error('Failed to save template:', error);
      setMessage({ type: 'error', text: 'Failed to save template' });
    } finally {
      setSaving(false);
    }
  };

  const extractVariables = (template: string): string[] => {
    const regex = /\{\{(\w+)\}\}/g;
    const variables: string[] = [];
    let match;
    while ((match = regex.exec(template)) !== null) {
      if (!variables.includes(match[1])) {
        variables.push(match[1]);
      }
    }
    return variables;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-2">
          <MessageSquare className="w-6 h-6 text-green-600" />
          <h2 className="text-xl font-semibold text-gray-800">WhatsApp Auto-Send Management</h2>
        </div>
        <p className="text-sm text-gray-600">
          Configure automatic WhatsApp message sending for different events. Messages are sent via your connected WhatsApp session.
        </p>
      </div>

      {/* Rules List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Auto-Send Rules</h3>
        <div className="space-y-3">
          {EVENT_TYPES.map(({ type, label, icon: Icon, description }) => {
            const rule = rules[type];
            const enabled = rule?.enabled || false;

            return (
              <div
                key={type}
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <div className="flex items-start gap-3 flex-1">
                  <Icon className={`w-5 h-5 mt-0.5 ${enabled ? 'text-green-600' : 'text-gray-400'}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-gray-800">{label}</h4>
                      {enabled && (
                        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelectedEvent(type)}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Edit Template
                  </button>
                  <button
                    onClick={() => toggleRule(type)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-green-600' : 'bg-gray-300'
                      }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Template Editor Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800">
                Edit Template: {EVENT_TYPES.find(e => e.type === selectedEvent)?.label}
              </h3>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Message Template
                </label>
                <textarea
                  value={templates[selectedEvent]}
                  onChange={(e) => setTemplates({ ...templates, [selectedEvent]: e.target.value })}
                  rows={12}
                  className="input-field font-mono text-sm"
                  placeholder="Enter your message template..."
                />
                <p className="text-xs text-gray-500 mt-2">
                  Use variables like {`{{patientName}}, {{clinicName}}, {{appointmentDate}}`} etc.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-blue-800 mb-2">Available Variables:</h4>
                <div className="flex flex-wrap gap-2">
                  {extractVariables(templates[selectedEvent]).map(variable => (
                    <code key={variable} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                      {`{{${variable}}}`}
                    </code>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setSelectedEvent(null)}
                className="secondary-button"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                onClick={saveTemplate}
                className="primary-button"
                disabled={saving}
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Saving...' : 'Save Template'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Message */}
      {message && (
        <div
          className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg ${message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
            }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
};

export default WhatsAppAutoSendSettings;
