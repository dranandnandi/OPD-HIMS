/**
 * Helper to look up WhatsApp backend user ID from auth_id
 */

const getConnectionString = () => 
  process.env.WHATSAPP_DB_CONNECTION_STRING || 
  'postgresql://neondb_owner:npg_HclN2sBL5OIF@ep-solitary-salad-a1alphes-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

export async function getUserIdFromAuthId(authId: string): Promise<string | null> {
  try {
    const { Pool } = await import('pg');
    
    const pool = new Pool({
      connectionString: getConnectionString(),
      ssl: {
        rejectUnauthorized: false
      }
    });

    try {
      const result = await pool.query(
        'SELECT id FROM users WHERE auth_id = $1 LIMIT 1',
        [authId]
      );
      
      await pool.end();
      
      if (result.rows.length > 0) {
        return result.rows[0].id;
      }
      
      return null;
    } catch (dbError) {
      await pool.end();
      throw dbError;
    }
  } catch (error) {
    console.error('Error looking up user:', error);
    return null;
  }
}
