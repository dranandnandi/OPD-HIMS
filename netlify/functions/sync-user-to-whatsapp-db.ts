import type { Handler } from '@netlify/functions';
import { corsHeaders, ok, error } from './_shared/whatsappClient';

// Neon PostgreSQL connection details
const getConnectionString = () => 
  process.env.WHATSAPP_DB_CONNECTION_STRING || 
  'postgresql://neondb_owner:npg_HclN2sBL5OIF@ep-solitary-salad-a1alphes-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

interface SyncUserRequest {
  userId: string; // From OPD system (Supabase auth.users.id)
  username: string; // Email
  name: string; // User's full name or clinic name
  role: string; // e.g., "admin", "doctor", "receptionist"
  clinicName?: string;
  clinicAddress?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactWhatsapp?: string;
  whatsappIntegrationAvailable?: boolean;
  maxSessions?: number;
}

const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}') as SyncUserRequest;

    // Validate required fields
    if (!body.userId || !body.username || !body.name) {
      return error('userId, username, and name are required', 400);
    }

    // Dynamically import pg to avoid bundling issues
    const { Pool } = await import('pg');
    
    const pool = new Pool({
      connectionString: getConnectionString(),
      ssl: {
        rejectUnauthorized: false
      }
    });

    try {
      // First check if user exists
      const checkQuery = `
        SELECT id FROM users WHERE username = $1 OR auth_id = $2;
      `;
      const checkResult = await pool.query(checkQuery, [body.username, body.userId]);
      
      let query: string;
      let queryValues: any[];
      
      if (checkResult.rows.length > 0) {
        // Update existing user
        query = `
          UPDATE users SET
            auth_id = $1,
            username = $2,
            name = $3,
            role = $4,
            clinic_name = $5,
            clinic_address = $6,
            contact_phone = $7,
            contact_email = $8,
            contact_whatsapp = $9,
            whatsapp_integration_available = $10,
            max_sessions = $11,
            updated_at = NOW()
          WHERE username = $2 OR auth_id = $1
          RETURNING id, auth_id, username, name, role, whatsapp_integration_available;
        `;
        queryValues = [
          body.userId, // auth_id
          body.username,
          body.name,
          body.role || 'user',
          body.clinicName || body.name,
          body.clinicAddress || '',
          body.contactPhone || '',
          body.contactEmail || body.username,
          body.contactWhatsapp || body.contactPhone || '',
          body.whatsappIntegrationAvailable !== false,
          body.maxSessions || 2
        ];
      } else {
        // Insert new user with UUID generation
        query = `
          INSERT INTO users (
            id,
            auth_id, 
            username, 
            name, 
            role, 
            clinic_name, 
            clinic_address, 
            contact_phone, 
            contact_email, 
            contact_whatsapp,
            whatsapp_integration_available,
            max_sessions,
            created_at,
            updated_at
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
          )
          RETURNING id, auth_id, username, name, role, whatsapp_integration_available;
        `;
        queryValues = [
          body.userId, // auth_id
          body.username,
          body.name,
          body.role || 'user',
          body.clinicName || body.name,
          body.clinicAddress || '',
          body.contactPhone || '',
          body.contactEmail || body.username,
          body.contactWhatsapp || body.contactPhone || '',
          body.whatsappIntegrationAvailable !== false,
          body.maxSessions || 2
        ];
      }

      const result = await pool.query(query, queryValues);
      
      await pool.end();

      return ok({
        success: true,
        message: 'User synced successfully to WhatsApp backend',
        user: result.rows[0]
      });

    } catch (dbError) {
      await pool.end();
      throw dbError;
    }

  } catch (err) {
    console.error('Sync user error:', err);
    return error(
      err instanceof Error ? err.message : 'Failed to sync user to WhatsApp backend',
      500
    );
  }
};

export { handler };
