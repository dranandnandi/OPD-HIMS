# Doctor Suite one-shot deploy. Prepared 2026-10-20. Run in PowerShell AFTER applying
# suite-admin\docs\APPLY_CENTRAL_SQL_2026-10-20.sql in the central SQL Editor.
# Every step is idempotent; re-running only re-uploads the same code/secrets.
# Requires: supabase login, netlify login (both already done on this machine).
$ErrorActionPreference = 'Stop'
$opd     = 'C:\app folders\OPD management\project'
$growth  = 'D:\app\gmb review system\project'
$task    = 'D:\task manager android app\project'
$secrets = Join-Path $opd 'suite-admin\server.env.local'   # master copy of all generated secrets (git-ignored)
$central = 'kiezgfhonvwryxpubfvl'   # Clinic_suite_india / clinic.anprohealthtech.com
$growthRef = 'iksfxkjnslttufpdklgq' # from D:\app\gmb review system\project\supabase\config.toml
$taskRef   = 'hnyqfasddflqzfibtjjz' # Task manager Live1, from the Task repo link

function Read-Env($path) { $h = @{}; Get-Content $path | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)=(.*)$') { $h[$matches[1]] = $matches[2].Trim() } }; return $h }
$env = Read-Env $secrets
$tmp = Join-Path $env:TEMP 'suite-secrets'; New-Item -ItemType Directory -Force $tmp | Out-Null

# ---- 1. Central secrets (only deliberately configured values; Node connector URLs are set later, once confirmed)
$centralKeys = 'SUITE_ENVIRONMENT','SUITE_MEMBER_PORTAL_URL','SUITE_MEMBER_ALLOWED_ORIGINS','SUITE_INVITE_SIGNING_KEY','SUITE_WORKER_TOKEN',
  'SUITE_OPD_CONNECTOR_URL','SUITE_OPD_CONNECTOR_TOKEN','SUITE_OPD_INSTANCE_ID',
  'SUITE_GROWTH_CONNECTOR_URL','SUITE_GROWTH_CONNECTOR_TOKEN','SUITE_GROWTH_INSTANCE_ID',
  'SUITE_WORKFORCE_CONNECTOR_URL','SUITE_WORKFORCE_CONNECTOR_TOKEN','SUITE_WORKFORCE_INSTANCE_ID',
  'SUITE_WHATSAPP_CONNECTOR_TOKEN','SUITE_WHATSAPP_INSTANCE_ID',
  'SUITE_LEGACY_WHATSAPP_CONNECTOR_TOKEN','SUITE_LEGACY_WHATSAPP_INSTANCE_ID'
# The master file lists SUITE_CONNECTOR_TOKEN/SUITE_INSTANCE_ID per component in separate sections; pick the central names only.
$lines = @(); foreach ($k in $centralKeys) { $v = (Select-String -Path $secrets -Pattern "^$k=(.+)$" | Select-Object -First 1).Matches.Groups[1].Value; if ($v) { $lines += "$k=$v" } }
$lines | Set-Content (Join-Path $tmp 'central.env') -Encoding ascii
Write-Host "== central secrets"; supabase secrets set --env-file (Join-Path $tmp 'central.env') --project-ref $central

# ---- 2. Central functions
Set-Location $opd
foreach ($f in 'suite-admin','suite-member','suite-product-access','suite-worker','suite-connector') { Write-Host "== deploy $f"; supabase functions deploy $f --project-ref $central }

# ---- 3. Growth connector (secrets + function)
function Component-Env($name) {
  $block = (Get-Content $secrets -Raw) -split "## $name connector side" | Select-Object -Last 1
  $tok = ([regex]::Match($block, 'SUITE_CONNECTOR_TOKEN=(\S+)')).Groups[1].Value
  $id  = ([regex]::Match($block, 'SUITE_INSTANCE_ID=(\S+)')).Groups[1].Value
  return "SUITE_CONNECTOR_TOKEN=$tok`nSUITE_INSTANCE_ID=$id`nSUITE_ENVIRONMENT=production"
}
Component-Env 'OPD'    | Set-Content (Join-Path $tmp 'opd.env') -Encoding ascii
Component-Env 'GROWTH' | Set-Content (Join-Path $tmp 'growth.env') -Encoding ascii
Component-Env 'WORKFORCE' | Set-Content (Join-Path $tmp 'workforce.env') -Encoding ascii
Write-Host "== OPD connector secrets (central project)"; supabase secrets set --env-file (Join-Path $tmp 'opd.env') --project-ref $central
Set-Location $growth
Write-Host "== Growth connector"; supabase secrets set --env-file (Join-Path $tmp 'growth.env') --project-ref $growthRef; supabase functions deploy suite-connector --project-ref $growthRef

# ---- 4. Task connector + bridge function (bridge stays closed until WORKFORCE_* secrets are set after the Node backend is live)
Set-Location $task
Write-Host "== Task connector"; supabase secrets set --env-file (Join-Path $tmp 'workforce.env') --project-ref $taskRef; supabase functions deploy suite-connector --project-ref $taskRef
Write-Host "== Task workforce-whatsapp (closed until its secrets exist)"; supabase functions deploy workforce-whatsapp --project-ref $taskRef

# ---- 5. Suite Admin site
Set-Location (Join-Path $opd 'suite-admin')
npm.cmd run build
netlify deploy --prod --no-build --dir dist --site 46d03ebb-6133-49ed-82fb-ccc7165921b1

Remove-Item -Recurse -Force $tmp
Write-Host "Done. Next: Auth redirect URL /join, Node backends (DigitalOcean), then Connections page checks."
