/**
 * Service to sync OPD users to WhatsApp backend database
 */

interface SyncUserPayload {
  userId: string;
  username: string;
  name: string;
  role: string;
  clinicName?: string;
  clinicAddress?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactWhatsapp?: string;
  whatsappIntegrationAvailable?: boolean;
  maxSessions?: number;
}

interface SyncUserResponse {
  success: boolean;
  message: string;
  user?: {
    id: string;
    auth_id: string;
    username: string;
    name: string;
    role: string;
    whatsapp_integration_available: boolean;
  };
}

export class WhatsAppUserSyncService {
  private static readonly ENDPOINT = '/.netlify/functions/sync-user-to-whatsapp-db';

  /**
   * Sync a user to the WhatsApp backend database
   */
  static async syncUser(payload: SyncUserPayload): Promise<SyncUserResponse> {
    try {
      const response = await fetch(this.ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to sync user');
      }

      return data;
    } catch (error) {
      console.error('WhatsApp user sync error:', error);
      throw error;
    }
  }

  /**
   * Sync current authenticated user
   * Call this after login or when user profile is updated
   */
  static async syncCurrentUser(user: {
    id: string;
    email?: string;
    user_metadata?: {
      full_name?: string;
      name?: string;
    };
    clinic?: {
      clinicName?: string;
      clinicAddress?: string;
      contactPhone?: string;
      contactEmail?: string;
    };
    role?: string;
  }): Promise<SyncUserResponse> {
    const payload: SyncUserPayload = {
      userId: user.id,
      username: user.email || '',
      name: user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'User',
      role: user.role || 'user',
      clinicName: user.clinic?.clinicName,
      clinicAddress: user.clinic?.clinicAddress,
      contactPhone: user.clinic?.contactPhone,
      contactEmail: user.clinic?.contactEmail || user.email,
      contactWhatsapp: user.clinic?.contactPhone,
      whatsappIntegrationAvailable: true,
      maxSessions: 2,
    };

    return this.syncUser(payload);
  }
}
