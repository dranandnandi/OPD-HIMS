import { useEffect } from 'react';
import { WhatsAppAutoSendService } from '../../services/whatsappAutoSendService';
import { useAuth } from '../Auth/useAuth';

/**
 * Background component that processes the WhatsApp message queue
 * Runs every 2 minutes to send pending messages
 */
export const MessageQueueProcessor: React.FC = () => {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id || !user?.clinicId) return;

    console.log('MessageQueueProcessor: Starting background processor');

    // Process queue immediately on mount
    const processNow = async () => {
      try {
        const sent = await WhatsAppAutoSendService.processPendingMessages(
          user.id,
          user.clinicId
        );
        if (sent > 0) {
          console.log(`MessageQueueProcessor: Processed ${sent} pending messages`);
        }
      } catch (error) {
        console.error('MessageQueueProcessor: Failed to process queue:', error);
      }
    };

    processNow();

    // Process queue every 2 minutes
    const interval = setInterval(async () => {
      try {
        const sent = await WhatsAppAutoSendService.processPendingMessages(
          user.id,
          user.clinicId
        );
        if (sent > 0) {
          console.log(`MessageQueueProcessor: Processed ${sent} pending messages`);
        }
      } catch (error) {
        console.error('MessageQueueProcessor: Failed to process queue:', error);
      }
    }, 2 * 60 * 1000); // 2 minutes

    return () => {
      console.log('MessageQueueProcessor: Stopping background processor');
      clearInterval(interval);
    };
  }, [user?.id, user?.clinicId]);

  // This component doesn't render anything - it's just a background processor
  return null;
};

export default MessageQueueProcessor;
