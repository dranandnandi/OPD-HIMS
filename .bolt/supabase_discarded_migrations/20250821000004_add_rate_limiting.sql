-- Add rate limiting infrastructure
-- MEDIUM PRIORITY Security Enhancement  
-- Created: August 21, 2025

-- Create rate limiting tracking table
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  identifier text NOT NULL, -- user_id, ip, or combination
  endpoint text NOT NULL,   -- API endpoint being accessed
  request_count integer NOT NULL DEFAULT 1,
  window_start timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  
  CONSTRAINT api_rate_limits_pkey PRIMARY KEY (id),
  CONSTRAINT unique_rate_limit_window UNIQUE (identifier, endpoint, window_start)
);

-- Create index for fast rate limit lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier_endpoint ON public.api_rate_limits(identifier, endpoint);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON public.api_rate_limits(window_start);

-- Enable RLS on rate limiting table
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

-- Create policy for rate limiting table (users can only see their own rate limit records)
CREATE POLICY "rate_limits_user_isolation" ON public.api_rate_limits
  FOR ALL USING (
    identifier = auth.uid()::text
    OR identifier LIKE '%' || auth.uid()::text || '%'
  );

-- Function to check and update rate limits
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_identifier text,
  p_endpoint text,
  p_max_requests integer DEFAULT 60,
  p_window_minutes integer DEFAULT 1
) RETURNS jsonb AS $$
DECLARE
  current_window timestamp with time zone;
  current_count integer;
  is_allowed boolean;
BEGIN
  -- Calculate current window start (rounded down to the minute)
  current_window := date_trunc('minute', now()) - (EXTRACT(minute FROM now())::integer % p_window_minutes) * interval '1 minute';
  
  -- Try to get existing rate limit record for this window
  SELECT request_count INTO current_count
  FROM api_rate_limits
  WHERE identifier = p_identifier
    AND endpoint = p_endpoint
    AND window_start = current_window;
  
  -- If no record exists, create one
  IF current_count IS NULL THEN
    INSERT INTO api_rate_limits (identifier, endpoint, request_count, window_start)
    VALUES (p_identifier, p_endpoint, 1, current_window)
    ON CONFLICT (identifier, endpoint, window_start) 
    DO UPDATE SET 
      request_count = api_rate_limits.request_count + 1,
      updated_at = now();
    
    current_count := 1;
  ELSE
    -- Update existing record
    UPDATE api_rate_limits
    SET request_count = request_count + 1,
        updated_at = now()
    WHERE identifier = p_identifier
      AND endpoint = p_endpoint
      AND window_start = current_window;
    
    current_count := current_count + 1;
  END IF;
  
  -- Check if limit is exceeded
  is_allowed := current_count <= p_max_requests;
  
  -- Return rate limit status
  RETURN jsonb_build_object(
    'allowed', is_allowed,
    'current_count', current_count,
    'max_requests', p_max_requests,
    'window_minutes', p_window_minutes,
    'reset_time', current_window + (p_window_minutes || ' minutes')::interval
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up old rate limit records (run periodically)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS integer AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Delete records older than 24 hours
  DELETE FROM api_rate_limits
  WHERE window_start < now() - interval '24 hours';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON public.api_rate_limits TO authenticated;
GRANT EXECUTE ON FUNCTION check_rate_limit TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_rate_limits TO authenticated;

-- Add comments for documentation
COMMENT ON TABLE public.api_rate_limits IS 'Tracks API request counts for rate limiting purposes. Records are automatically cleaned up after 24 hours.';
COMMENT ON FUNCTION check_rate_limit IS 'Checks if a request should be allowed based on rate limiting rules. Returns rate limit status and updates counters.';
COMMENT ON FUNCTION cleanup_old_rate_limits IS 'Removes old rate limiting records to prevent table bloat. Should be run periodically via cron job.';
