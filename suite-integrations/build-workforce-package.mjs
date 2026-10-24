import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const folder = path.dirname(fileURLToPath(import.meta.url));
if (fs.existsSync(path.join(folder, 'workforce-manifest.json'))) throw new Error('Workforce package already prepared. Review/restage changed files deliberately; do not overwrite its snapshot.');
const roots = {
  workforce: 'D:/task manager android app/project',
  whatsapp: 'D:/app folder/Whatsapp new app multi user/whatsapp multi user bulk/NodeBackend',
};
const changes = [];
function stage(component, relative, content) {
  const target = path.join(roots[component], relative);
  const beforeHash = fs.existsSync(target) ? crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') : null;
  const staged = path.join(folder, 'staged', component, relative);
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  if (content === undefined) content = fs.readFileSync(staged, 'utf8');
  else fs.writeFileSync(staged, content);
  changes.push({ component, relative, target, staged: path.relative(folder, staged), beforeHash,
    afterHash: crypto.createHash('sha256').update(content).digest('hex') });
}
stage('workforce', 'supabase/functions/workforce-whatsapp/index.ts');
stage('whatsapp', 'server/workforceBridge.ts');
stage('whatsapp', 'server/workforceBridgeCore.ts');
const config = fs.readFileSync(path.join(roots.workforce, 'supabase/config.toml'), 'utf8');
if (config.includes('[functions.workforce-whatsapp]')) throw new Error('Bridge config exists; review instead of regenerating.');
stage('workforce', 'supabase/config.toml', config + '\n[functions.workforce-whatsapp]\n# Calls Auth.getUser and checks active organisation admin on each request.\nverify_jwt = false\n');

const service = fs.readFileSync(path.join(roots.workforce, 'src/services/externalWhatsAppService.ts'), 'utf8');
const marker = 'const configuredBaseUrl';
if (!service.includes(marker)) throw new Error('Frontend service changed; review first');
stage('workforce', 'src/services/externalWhatsAppService.ts', `import { supabase } from '../utils/supabaseClient';\n` + service.slice(0, service.indexOf(marker)) + `
async function requestExternal<T>(action: string, userId?: string, sessionName?: string): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in to Task Manager.');
  const { data, error } = await supabase.functions.invoke('workforce-whatsapp', {
    body: { action, ...(userId ? { user_id: userId } : {}), ...(sessionName ? { session_name: sessionName } : {}) },
  });
  if (error) {
    const response = (error as { context?: Response }).context;
    const details = response instanceof Response ? await response.json().catch(() => null) : null;
    const failure = new Error(details?.error || 'WhatsApp server connection is unavailable.');
    Object.assign(failure, { status: response?.status });
    throw failure;
  }
  if (data?.success !== true) throw new Error(data?.error || 'WhatsApp operation failed.');
  return data.data as T;
}
export const externalWhatsAppService = {
  isConfigured: Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY),
  handshake: (userId: string) => requestExternal<{ userId: string; existed: boolean }>('handshake', userId),
  syncAdmins: () => requestExternal<{ organizationId: string; received: number; synced: number; users: Array<{ id: string; username: string; role: string }> }>('sync_admins'),
  connect: (userId: string, sessionName = 'default') => requestExternal<ExternalWhatsAppQrPayload>('connect', userId, sessionName),
  refreshQr: (userId: string, sessionName = 'default') => requestExternal<ExternalWhatsAppQrPayload>('refresh_qr', userId, sessionName),
  getQr: (userId: string, sessionName = 'default') => requestExternal<ExternalWhatsAppQrPayload>('qr', userId, sessionName),
  getStatus: (userId: string) => requestExternal<ExternalWhatsAppStatusPayload>('status', userId),
  disconnect: (userId: string, sessionName = 'default') => requestExternal<{ status: string; sessionName: string }>('disconnect', userId, sessionName),
};
`);
let ui = fs.readFileSync(path.join(roots.workforce, 'src/components/WhatsAppConnection.tsx'), 'utf8');
const start = ui.indexOf('  const syncOrganizationAdmins =');
const end = ui.indexOf('  useEffect(() => {', start);
if (start < 0 || end < 0) throw new Error('Connection UI changed; review first');
ui = ui.slice(0, start) + `  const syncOrganizationAdmins = async (profile: TaskManagerUser) => {
    if (!externalWhatsAppService.isConfigured || !ADMIN_ROLES.has(profile.role)) return;
    const result = await externalWhatsAppService.syncAdmins();
    setMessage(\`Synced \${result.synced} admin users for this organization.\`);
  };

` + ui.slice(end);
ui = ui.replace('Add VITE_EXTERNAL_WA_API_URL and VITE_EXTERNAL_WA_API_KEY to the app environment.', 'Your Task Manager server connection is not configured. Contact your administrator.')
  .replace('External user ID</span>', 'Task administrator ID</span>');
stage('workforce', 'src/components/WhatsAppConnection.tsx', ui);

let external = fs.readFileSync(path.join(roots.whatsapp, 'server/externalApiRoutes.ts'), 'utf8');
const authAnchor = 'function verifyExternalApiKey(req: Request, res: Response, next: NextFunction): void {';
const contextAnchor = '    req.auth = {';
if (!external.includes(authAnchor) || !external.includes(contextAnchor) || external.includes('getWorkforceScope')) throw new Error('External routes changed; review first');
external = `import { getWorkforceScope } from './workforceBridge';\n` + external.replace(authAnchor, authAnchor + '\n  if (getWorkforceScope(req)) { next(); return; }');
external = external.replace(contextAnchor, `    const workforce = getWorkforceScope(req);
    if (workforce && (user.organization_id !== workforce.organizationId || !workforce.admins.some(admin => admin.id === String(user.id)))) {
      res.status(403).json({ success: false, error: 'Sender is outside the Workforce organisation scope.' });
      return;
    }
` + contextAnchor);
stage('whatsapp', 'server/externalApiRoutes.ts', external);
let routes = fs.readFileSync(path.join(roots.whatsapp, 'server/routes.ts'), 'utf8');
const registration = '  registerExternalApiRoutes(app);';
if (!routes.includes(registration) || routes.includes('registerWorkforceBridge')) throw new Error('Route registration changed; review first');
routes = `import { registerWorkforceBridge } from './workforceBridge';\n` + routes.replace(registration, '  registerWorkforceBridge(app);\n' + registration);
stage('whatsapp', 'server/routes.ts', routes);
fs.writeFileSync(path.join(folder, 'workforce-manifest.json'), JSON.stringify(changes, null, 2) + '\n');
console.log(`Prepared ${changes.length} Workforce bridge files. External projects are unchanged until the installer runs.`);
