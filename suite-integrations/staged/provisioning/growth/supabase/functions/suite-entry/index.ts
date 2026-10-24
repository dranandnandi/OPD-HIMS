import{productEntry}from'../_shared/suite-runtime-entry.ts';
export const handleSuiteEntry=productEntry('growth');
if(import.meta.main)Deno.serve(handleSuiteEntry);
