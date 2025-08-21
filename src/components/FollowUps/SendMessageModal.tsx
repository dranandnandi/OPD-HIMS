import React, { useState, useEffect } from 'react';
import { X, MessageCircle, Send, Bot, Heart, Star, Link, User, Calendar, Phone, MapPin, Loader2, CheckCircle, AlertCircle, Zap } from 'lucide-react';
import { Review, ClinicSetting } from '../../types';
import { reviewService } from '../../services/reviewService';
import { clinicSettingsService } from '../../services/clinicSettingsService';
import { format } from 'date-fns';
import { toTitleCase } from '../../utils/stringUtils';
import { useAuth } from '../Auth/useAuth';

interface SendMessageModalProps {
  review: Review;
  followUpDate?: string;
  onClose: () => void;
  messageType?: 'follow_up' | 'thank_you';
  visitId?: string;
  onMessageSent?: (visitId: string, messageType: 'follow_up' | 'thank_you') => void;
}

interface MessageOption {
  id: string;
  type: 'follow_up' | 'ai_first' | 'ai_second' | 'simple_thank_you' | 'gmb_link_only';
  label: string;
  description: string;
  icon: React.ReactNode;
  enabled: boolean;
  disabledReason?: string;
}

const SendMessageModal: React.FC<SendMessageModalProps> = ({ 
  review, 
  followUpDate,
  messageType = 'follow_up',
  visitId,
  onClose, 
  onMessageSent 
}) => {
  const { user } = useAuth();
  const [clinicSettings, setClinicSettings] = useState<ClinicSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMessageTypes, setSelectedMessageTypes] = useState<string[]>([]);
  const [messageContents, setMessageContents] = useState<{ [key: string]: string }>({});
  const [generatingMessage, setGeneratingMessage] = useState<string | null>(null);
  const [sendingManually, setSendingManually] = useState<string | null>(null);
  const [sendingDirectly, setSendingDirectly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  // Auto-select message types based on messageType prop
  useEffect(() => {
    if (clinicSettings) {
      if (messageType === 'follow_up') {
        setSelectedMessageTypes(['follow_up']);
      } else if (messageType === 'thank_you') {
        // Auto-select the first available thank you message type
        const availableThankYouTypes = getMessageOptions()
          .filter(opt => ['ai_first', 'simple_thank_you', 'gmb_link_only'].includes(opt.type))
          .map(opt => opt.id);
        
        if (availableThankYouTypes.length > 0) {
          setSelectedMessageTypes([availableThankYouTypes[0]]);
        }
      }
    }
  }, [clinicSettings, messageType]);

  // Auto-generate message content when message types are selected
  useEffect(() => {
    if (selectedMessageTypes.length > 0 && !generatingMessage) {
      selectedMessageTypes.forEach(type => {
        if (!messageContents[type]) {
          generateMessageContent(type);
        }
      });
    }
  }, [selectedMessageTypes]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const settings = await clinicSettingsService.getOrCreateClinicSettings();
      setClinicSettings(settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clinic settings');
      console.error('Error loading clinic settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const getMessageOptions = (): MessageOption[] => {
    if (!clinicSettings) return [];

    const allOptions = [
      {
        id: 'follow_up',
        type: 'follow_up',
        label: 'Follow-up Reminder',
        description: 'Send appointment reminder message',
        icon: <Calendar className="w-4 h-4" />,
        enabled: !!followUpDate,
        disabledReason: !followUpDate ? 'No follow-up date available' : undefined
      },
      {
        id: 'ai_first',
        type: 'ai_first',
        label: 'AI Thank You + Review',
        description: 'AI-generated thank you with review suggestion',
        icon: <Bot className="w-4 h-4" />,
        enabled: clinicSettings.enableAiThankYou && clinicSettings.enableAiReviewSuggestion && !!clinicSettings.gmbLink,
        disabledReason: !clinicSettings.enableAiThankYou ? 'AI Thank You disabled in settings' :
                       !clinicSettings.enableAiReviewSuggestion ? 'AI Review Suggestion disabled in settings' :
                       !clinicSettings.gmbLink ? 'Google My Business link not configured' : undefined
      },
      {
        id: 'ai_second',
        type: 'ai_second',
        label: 'AI Review Suggestion',
        description: 'AI-generated review text only',
        icon: <Bot className="w-4 h-4" />,
        enabled: clinicSettings.enableAiReviewSuggestion && !!clinicSettings.gmbLink,
        disabledReason: !clinicSettings.enableAiReviewSuggestion ? 'AI Review Suggestion disabled in settings' :
                       !clinicSettings.gmbLink ? 'Google My Business link not configured' : undefined
      },
      {
        id: 'simple_thank_you',
        type: 'simple_thank_you',
        label: 'Simple Thank You',
        description: 'Basic thank you with review link',
        icon: <Heart className="w-4 h-4" />,
        enabled: clinicSettings.enableSimpleThankYou && !!clinicSettings.gmbLink,
        disabledReason: !clinicSettings.enableSimpleThankYou ? 'Simple Thank You disabled in settings' :
                       !clinicSettings.gmbLink ? 'Google My Business link not configured' : undefined
      },
      {
        id: 'gmb_link_only',
        type: 'gmb_link_only',
        label: 'GMB Link Only',
        description: 'Direct link to Google My Business review',
        icon: <Star className="w-4 h-4" />,
        enabled: clinicSettings.enableGmbLinkOnly && !!clinicSettings.gmbLink,
        disabledReason: !clinicSettings.enableGmbLinkOnly ? 'GMB Link Only disabled in settings' :
                       !clinicSettings.gmbLink ? 'Google My Business link not configured' : undefined
      }
    ];

    // Filter out disabled options to hide unconfigured message types
    return allOptions.filter(option => option.enabled);
  };

  const handleMessageTypeToggle = (messageId: string) => {
    setSelectedMessageTypes(prev => {
      if (prev.includes(messageId)) {
        return prev.filter(id => id !== messageId);
      } else {
        return [...prev, messageId];
      }
    });
  };

  const generateMessageContent = async (messageType: string) => {
    if (!clinicSettings) return;

    const option = getMessageOptions().find(opt => opt.id === messageType);
    if (!option || !option.enabled) return;

    try {
      setGeneratingMessage(messageType);
      setError(null);

      const result = await reviewService.generateReviewMessageContent({
        review,
        messageType: option.type,
        clinicSettings,
        followUpDate
      });

      setMessageContents(prev => ({
        ...prev,
        [messageType]: result.messageContent
      }));

      // If AI review text was generated, we might want to store it
      if (result.aiReviewText && (option.type === 'ai_first' || option.type === 'ai_second')) {
        // Here you could update the review record in the database with the AI text
        console.log('Generated AI review text:', result.aiReviewText);
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate message content');
      console.error('Error generating message:', err);
    } finally {
      setGeneratingMessage(null);
    }
  };

  const handleSendManually = async (messageType: string) => {
    if (!messageContents[messageType] || !review.contactNumber) return;

    try {
      setSendingManually(messageType);
      setError(null);

      reviewService.sendManually(review.contactNumber, messageContents[messageType]);
      
      // Log the sent message
      try {
        await reviewService.logSentMessage({
          patientId: review.patientId,
          visitId: review.visitId,
          messageType: messageType,
          messageContent: messageContents[messageType],
          status: 'sent',
          deliveryMethod: 'manual_whatsapp',
          sentBy: user?.id
        });
      } catch (logError) {
        console.error('Failed to log sent message:', logError);
        // Don't fail the entire operation if logging fails
      }
      
      setSuccess('WhatsApp opened successfully! Please send the message from WhatsApp.');
      
      if (onMessageSent && visitId) {
        onMessageSent(visitId, messageType);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open WhatsApp');
      console.error('Error sending manually:', err);
    } finally {
      setSendingManually(null);
    }
  };

  const handleSendDirectly = async () => {
    if (!clinicSettings || selectedMessageTypes.length === 0) return;

    try {
      setSendingDirectly(true);
      setError(null);

      // Generate content for all selected message types if not already generated
      for (const messageType of selectedMessageTypes) {
        if (!messageContents[messageType]) {
          await generateMessageContent(messageType);
        }
      }

      // Send all selected messages
      for (const messageType of selectedMessageTypes) {
        if (messageContents[messageType]) {
          try {
            await reviewService.sendDirectly(
              review.contactNumber,
              messageContents[messageType],
              clinicSettings.id
            );
            
            // Log successful send
            await reviewService.logSentMessage({
              patientId: review.patientId,
              visitId: review.visitId,
              messageType: messageType,
              messageContent: messageContents[messageType],
              status: 'sent',
              deliveryMethod: 'blueticks_api',
              sentBy: user?.id
            });
          } catch (sendError) {
            // Log failed send
            await reviewService.logSentMessage({
              patientId: review.patientId,
              visitId: review.visitId,
              messageType: messageType,
              messageContent: messageContents[messageType],
              status: 'failed',
              deliveryMethod: 'blueticks_api',
              errorDetails: sendError instanceof Error ? sendError.message : 'Unknown error',
              sentBy: user?.id
            });
            throw sendError; // Re-throw to handle in outer catch
          }
        }
      }

      setSuccess(`Successfully sent ${selectedMessageTypes.length} message(s) via WhatsApp!`);
      
      if (onMessageSent && visitId) {
        onMessageSent(visitId, messageType);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send messages directly');
      if (import.meta.env.DEV) {
        console.error('Error sending directly:', err);
      }
    } finally {
      setSendingDirectly(false);
    }
  };

  const messageOptions = getMessageOptions();
  const isBlueticksConfigured = clinicSettings?.enableBlueticksApiSend;
  const isManualEnabled = clinicSettings?.enableManualWhatsappSend;

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <div>
            <h2 className="text-xl font-bold text-gray-800">
              {messageType === 'follow_up' ? 'Send Follow-Up Message' : 'Send Thank You Message'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">Patient: {toTitleCase(review.patientName)}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Error/Success Messages */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <p className="text-red-700">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <p className="text-green-700">{success}</p>
            </div>
          )}

          {/* Message Type Header */}
          <div className={`p-4 rounded-lg border-2 ${
            messageType === 'follow_up' 
              ? 'bg-green-50 border-green-200' 
              : 'bg-purple-50 border-purple-200'
          }`}>
            <div className="flex items-center gap-2">
              {messageType === 'follow_up' ? (
                <Calendar className="w-5 h-5 text-green-600" />
              ) : (
                <Heart className="w-5 h-5 text-purple-600" />
              )}
              <h3 className={`font-medium ${messageType === 'follow_up' ? 'text-green-800' : 'text-purple-800'}`}>
                {messageType === 'follow_up' ? 'Follow-Up Reminder' : 'Thank You & Review Request'}
              </h3>
            </div>
          </div>

          {/* Patient Information */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-medium text-blue-800 mb-4">Patient & Visit Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" />
                <div>
                  <p className="text-sm text-blue-600">Patient Name</p>
                  <p className="font-medium text-blue-800">{toTitleCase(review.patientName)}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-blue-600" />
                <div>
                  <p className="text-sm text-blue-600">Contact Number</p>
                  <p className="font-medium text-blue-800">{review.contactNumber}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-600" />
                <div>
                  <p className="text-sm text-blue-600">Visit Date</p>
                  <p className="font-medium text-blue-800">{format(new Date(review.appointmentDate), 'PPP')}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-600" />
                <div>
                  <p className="text-sm text-blue-600">Treatment</p>
                  <p className="font-medium text-blue-800">{review.treatment || 'General consultation'}</p>
                </div>
              </div>
              
              {messageType === 'follow_up' && followUpDate && (
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  <div>
                    <p className="text-sm text-blue-600">Follow-up Date</p>
                    <p className="font-medium text-blue-800">{format(new Date(followUpDate), 'PPP')}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Message Options */}
          <div>
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Select Message Types</h3>
            <div className="space-y-3">
              {getMessageOptions()
                .filter(option => 
                  messageType === 'follow_up' ? option.type === 'follow_up' :
                  ['ai_first', 'ai_second', 'simple_thank_you', 'gmb_link_only'].includes(option.type)
                ).map(option => (
                <div key={option.id} className={`border rounded-lg p-4 ${
                  option.enabled ? 'border-gray-200' : 'border-gray-100 bg-gray-50'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedMessageTypes.includes(option.id)}
                        onChange={() => handleMessageTypeToggle(option.id)}
                        disabled={!option.enabled}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                      />
                      <div className="flex items-center gap-2">
                        {option.icon}
                        <div>
                          <h4 className={`font-medium ${option.enabled ? 'text-gray-800' : 'text-gray-500'}`}>
                            {option.label}
                          </h4>
                          <p className={`text-sm ${option.enabled ? 'text-gray-600' : 'text-gray-400'}`}>
                            {option.description}
                          </p>
                          {!option.enabled && option.disabledReason && (
                            <p className="text-xs text-red-600 mt-1">{option.disabledReason}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Generate & Send Manually Button */}
                    {option.enabled && isManualEnabled && (
                      <div className="flex items-center gap-2">
                        {!messageContents[option.id] && (
                          <button
                            onClick={() => generateMessageContent(option.id)}
                            disabled={generatingMessage === option.id}
                            className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
                          >
                            {generatingMessage === option.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Bot className="w-3 h-3" />
                            )}
                            Generate
                          </button>
                        )}
                        
                        {messageContents[option.id] && (
                          <button
                            onClick={() => handleSendManually(option.id)}
                            disabled={sendingManually === option.id}
                            className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors disabled:opacity-50"
                          >
                            {sendingManually === option.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Send className="w-3 h-3" />
                            )}
                            Send Manual
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Message Preview */}
                  {messageContents[option.id] && (
                    <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded">
                      <h5 className="text-sm font-medium text-gray-700 mb-2">Message Preview:</h5>
                      <pre className="text-sm text-gray-600 whitespace-pre-wrap font-sans">
                        {messageContents[option.id]}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              onClick={onClose}
              className="btn-figma-secondary"
            >
              Cancel
            </button>

            {isBlueticksConfigured && (
              <button
                onClick={handleSendDirectly}
                disabled={sendingDirectly || selectedMessageTypes.length === 0}
                className={`btn-figma-primary flex items-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed ${messageType === 'follow_up' ? 'btn-figma-success' : 'btn-figma-purple'}`}
              >
                {sendingDirectly ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                {sendingDirectly 
                  ? 'Sending...' 
                  : messageType === 'follow_up' 
                    ? 'Send Follow-Up' 
                    : 'Send Thank You'
                }
              </button>
            )}
          </div>

          {/* Configuration Notice */}
          {messageOptions.length === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                <div>
                  <p className="text-yellow-800 font-medium">No Message Types Available</p>
                  <p className="text-yellow-700 text-sm mt-1">
                    Please configure WhatsApp messaging settings and enable message types to send messages.
                  </p>
                  <button
                    onClick={() => window.location.href = '/settings/whatsapp-ai'}
                    className="mt-2 text-yellow-600 hover:text-yellow-700 text-sm underline"
                  >
                    Go to Settings →
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SendMessageModal;