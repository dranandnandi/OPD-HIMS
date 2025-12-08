import React, { useState, useEffect } from 'react';
import { Save, MessageCircle, Bot, Heart, Star, Link, Shield, Eye, EyeOff } from 'lucide-react';
import { ClinicSetting } from '../../types';
import { clinicSettingsService } from '../../services/clinicSettingsService';
import { useAuth } from '../Auth/useAuth';
import WhatsAppConnectionCard from '../WhatsApp/WhatsAppConnectionCard';

const WhatsappAndAIReviewSettings: React.FC = () => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<ClinicSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  const [formData, setFormData] = useState({
    enableManualWhatsappSend: true,
    enableAiReviewSuggestion: true,
    enableSimpleThankYou: true,
    enableAiThankYou: true,
    enableGmbLinkOnly: true,
    gmbLink: ''
  });

  useEffect(() => {
    if (user) {
      loadSettings();
    }
  }, [user]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const clinicSettings = await clinicSettingsService.getOrCreateClinicSettings();
      setSettings(clinicSettings);
      
      // Update form data
      setFormData({
        enableManualWhatsappSend: clinicSettings.enableManualWhatsappSend ?? true,
        enableAiReviewSuggestion: clinicSettings.enableAiReviewSuggestion ?? true,
        enableSimpleThankYou: clinicSettings.enableSimpleThankYou ?? true,
        enableAiThankYou: clinicSettings.enableAiThankYou ?? true,
        enableGmbLinkOnly: clinicSettings.enableGmbLinkOnly ?? true,
        gmbLink: clinicSettings.gmbLink || ''
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
      console.error('Error loading settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;

    try {
      setSaving(true);
      const updatedSettings = await clinicSettingsService.updateClinicSettings(settings.id, {
        enableManualWhatsappSend: formData.enableManualWhatsappSend,
        enableAiReviewSuggestion: formData.enableAiReviewSuggestion,
        enableSimpleThankYou: formData.enableSimpleThankYou,
        enableAiThankYou: formData.enableAiThankYou,
        enableGmbLinkOnly: formData.enableGmbLinkOnly,
        gmbLink: formData.gmbLink
      });
      setSettings(updatedSettings);
      alert('WhatsApp and AI Review settings saved successfully!');
    } catch (err) {
      console.error('Error saving settings:', err);
      alert(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to access WhatsApp and AI Review settings.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading settings...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">{error}</div>
        <button
          onClick={loadSettings}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <WhatsAppConnectionCard />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">WhatsApp & AI Review Settings</h2>
          <p className="text-gray-600">Configure messaging and review request settings</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {/* WhatsApp Messaging Settings */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-6">
          <MessageCircle className="w-5 h-5 text-green-600" />
          <h3 className="text-lg font-semibold text-gray-800">WhatsApp Messaging</h3>
        </div>

        <div className="space-y-6">
          {/* Manual WhatsApp Send */}
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center gap-3">
              <MessageCircle className="w-5 h-5 text-green-600" />
              <div>
                <h4 className="font-medium text-gray-800">Manual WhatsApp Send</h4>
                <p className="text-sm text-gray-600">Open WhatsApp Web/App with pre-filled message</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.enableManualWhatsappSend}
                onChange={(e) => setFormData({ ...formData, enableManualWhatsappSend: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
            </label>
          </div>

          {/* WhatsApp Integration Notice */}
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-start gap-3">
              <MessageCircle className="w-5 h-5 text-green-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-green-800">WhatsApp Direct Sending</h4>
                <p className="text-sm text-green-700 mt-1">
                  Connect your WhatsApp account in Settings → WhatsApp Integration to enable direct message sending.
                </p>
              </div>
            </div>
          </div>

          {/* Google Business Profile */}
          <div className="p-4 border border-gray-200 rounded-lg">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <div className="flex items-center gap-2">
                <Link className="w-4 h-4" />
                Google Business Profile Link
              </div>
            </label>
            <input
              type="url"
              value={formData.gmbLink}
              onChange={(e) => setFormData({ ...formData, gmbLink: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="https://g.page/your-clinic/review"
            />
            <p className="text-xs text-gray-600 mt-1">
              This link will be included in review request messages.
            </p>
          </div>
        </div>
      </div>

      {/* AI Review Settings */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-6">
          <Bot className="w-5 h-5 text-purple-600" />
          <h3 className="text-lg font-semibold text-gray-800">AI Review Features</h3>
        </div>

        <div className="space-y-4">{/* AI Thank You Messages */}
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center gap-3">
              <Heart className="w-5 h-5 text-red-600" />
              <div>
                <h4 className="font-medium text-gray-800">AI Thank You Messages</h4>
                <p className="text-sm text-gray-600">AI-generated personalized thank you messages</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.enableAiThankYou}
                onChange={(e) => setFormData({ ...formData, enableAiThankYou: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
            </label>
          </div>

          {/* AI Review Suggestions */}
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center gap-3">
              <Bot className="w-5 h-5 text-purple-600" />
              <div>
                <h4 className="font-medium text-gray-800">AI Review Suggestions</h4>
                <p className="text-sm text-gray-600">Generate personalized review text for patients</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.enableAiReviewSuggestion}
                onChange={(e) => setFormData({ ...formData, enableAiReviewSuggestion: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
            </label>
          </div>

          {/* Simple Thank You */}
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center gap-3">
              <Heart className="w-5 h-5 text-pink-600" />
              <div>
                <h4 className="font-medium text-gray-800">Simple Thank You Messages</h4>
                <p className="text-sm text-gray-600">Basic thank you messages with review links</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.enableSimpleThankYou}
                onChange={(e) => setFormData({ ...formData, enableSimpleThankYou: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-600"></div>
            </label>
          </div>
        </div>
      </div>

      {/* Google My Business Settings */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-6">
          <Star className="w-5 h-5 text-yellow-600" />
          <h3 className="text-lg font-semibold text-gray-800">Google My Business</h3>
        </div>

        {/* GMB Link Only Messages */}
        <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg mb-4">
          <div className="flex items-center gap-3">
            <Star className="w-5 h-5 text-yellow-600" />
            <div>
              <h4 className="font-medium text-gray-800">GMB Link Only Messages</h4>
              <p className="text-sm text-gray-600">Send direct Google My Business review link only</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={formData.enableGmbLinkOnly}
              onChange={(e) => setFormData({ ...formData, enableGmbLinkOnly: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-yellow-600"></div>
          </label>
        </div>

        {/* GMB Review Link Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Google My Business Review Link
          </label>
          <div className="relative">
            <Link className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="url"
              value={formData.gmbLink}
              onChange={(e) => setFormData({ ...formData, gmbLink: e.target.value })}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="https://g.page/your-clinic/review"
            />
          </div>
          <p className="text-xs text-gray-600 mt-1">
            This link will be included in review request messages. Get it from your Google My Business dashboard.
          </p>
        </div>
      </div>

      {/* Information Panel */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h4 className="font-medium text-blue-800 mb-3">How it works:</h4>
        <ul className="text-sm text-blue-700 space-y-2">
          <li>• <strong>Manual Send:</strong> Opens WhatsApp with pre-filled message for you to send</li>
          <li>• <strong>Direct Send:</strong> Automatically sends messages via your connected WhatsApp account</li>
          <li>• <strong>AI Features:</strong> Generate personalized thank you messages and review suggestions</li>
          <li>• <strong>Review Links:</strong> Include your Google My Business link in messages</li>
          <li>• <strong>Follow-ups:</strong> Send appointment reminders and follow-up messages</li>
        </ul>
      </div>
    </div>
  );
};

export default WhatsappAndAIReviewSettings;