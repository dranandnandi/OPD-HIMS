-- Device Tokens Table for FCM Push Notifications
-- OPD Management System - Mobile App Integration

-- Create table for storing device FCM tokens
CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  fcm_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  device_info JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_is_active ON device_tokens(is_active);
CREATE INDEX IF NOT EXISTS idx_device_tokens_fcm_token ON device_tokens(fcm_token);
CREATE INDEX IF NOT EXISTS idx_device_tokens_platform ON device_tokens(platform);

-- Enable Row Level Security
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view their own tokens
CREATE POLICY "Users can view own tokens" ON device_tokens
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own tokens
CREATE POLICY "Users can insert own tokens" ON device_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own tokens
CREATE POLICY "Users can update own tokens" ON device_tokens
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own tokens
CREATE POLICY "Users can delete own tokens" ON device_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- Service role can do everything (for backend operations)
CREATE POLICY "Service role has full access" ON device_tokens
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_device_token_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_device_tokens_timestamp
  BEFORE UPDATE ON device_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_device_token_timestamp();

-- Upsert function for token management
CREATE OR REPLACE FUNCTION upsert_device_token(
  p_user_id UUID,
  p_fcm_token TEXT,
  p_device_info JSONB DEFAULT '{}',
  p_platform TEXT DEFAULT 'android'
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO device_tokens (user_id, fcm_token, device_info, platform, is_active, last_used_at)
  VALUES (p_user_id, p_fcm_token, p_device_info, p_platform, true, NOW())
  ON CONFLICT (fcm_token) 
  DO UPDATE SET 
    user_id = p_user_id,
    device_info = p_device_info,
    platform = p_platform,
    is_active = true,
    last_used_at = NOW(),
    updated_at = NOW()
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION upsert_device_token TO authenticated;

-- View for active tokens (useful for backend)
CREATE OR REPLACE VIEW active_device_tokens AS
SELECT 
  dt.id,
  dt.user_id,
  dt.fcm_token,
  dt.platform,
  dt.device_info,
  dt.last_used_at,
  dt.created_at,
  u.email as user_email,
  u.raw_user_meta_data->>'full_name' as user_name
FROM device_tokens dt
LEFT JOIN auth.users u ON dt.user_id = u.id
WHERE dt.is_active = true
ORDER BY dt.last_used_at DESC;

-- Grant select on view to authenticated users
GRANT SELECT ON active_device_tokens TO authenticated;

-- Function to get all active tokens for broadcasting
CREATE OR REPLACE FUNCTION get_all_active_tokens()
RETURNS TABLE (
  fcm_token TEXT,
  user_email TEXT,
  platform TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dt.fcm_token,
    u.email,
    dt.platform
  FROM device_tokens dt
  LEFT JOIN auth.users u ON dt.user_id = u.id
  WHERE dt.is_active = true
  ORDER BY dt.last_used_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to service role only
GRANT EXECUTE ON FUNCTION get_all_active_tokens TO service_role;

-- Function to deactivate old/invalid tokens
CREATE OR REPLACE FUNCTION deactivate_token(p_fcm_token TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE device_tokens
  SET is_active = false, updated_at = NOW()
  WHERE fcm_token = p_fcm_token;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION deactivate_token TO authenticated, service_role;

-- Function to clean up inactive tokens older than 30 days
CREATE OR REPLACE FUNCTION cleanup_inactive_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM device_tokens
  WHERE is_active = false 
    AND updated_at < NOW() - INTERVAL '30 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION cleanup_inactive_tokens TO service_role;

-- Comment on table and columns
COMMENT ON TABLE device_tokens IS 'Stores FCM device tokens for push notifications';
COMMENT ON COLUMN device_tokens.fcm_token IS 'Firebase Cloud Messaging token';
COMMENT ON COLUMN device_tokens.platform IS 'Device platform: android, ios, or web';
COMMENT ON COLUMN device_tokens.device_info IS 'Additional device metadata (userAgent, model, etc.)';
COMMENT ON COLUMN device_tokens.is_active IS 'Whether token is currently valid and active';
COMMENT ON COLUMN device_tokens.last_used_at IS 'Last time this token was used to send a notification';
