import{productEntry}from'../_shared/suite-runtime-entry.ts';
export const handleSuiteEntry=productEntry('opd');
if(import.meta.main)Deno.serve(handleSuiteEntry);
