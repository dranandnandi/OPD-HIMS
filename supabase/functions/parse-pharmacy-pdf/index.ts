import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { pharmacyParserHandler } from '../_shared/pharmacy-parser-handler.ts';
serve(pharmacyParserHandler);
