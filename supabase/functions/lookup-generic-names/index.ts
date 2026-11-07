import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { genericNameLookupHandler } from '../_shared/generic-name-lookup.ts';
serve(req => genericNameLookupHandler(req, key => Deno.env.get(key)));
