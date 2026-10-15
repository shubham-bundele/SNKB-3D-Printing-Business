'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'xwtepmfzpwykirwgsaos';

if (!ACCESS_TOKEN) {
  console.error('[Supabase Setup] Missing SUPABASE_ACCESS_TOKEN env var. Set it before running this script.');
  process.exit(1);
}

function runQuery(sql) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query: sql });
    const req = https.request(
      {
        hostname: 'api.supabase.com',
        port: 443,
        path: `/v1/projects/${PROJECT_REF}/database/query`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ statusCode: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function fetchApiKeys() {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.supabase.com',
        port: 443,
        path: `/v1/projects/${PROJECT_REF}/api-keys`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log(`[Supabase Setup] Connecting to project: ${PROJECT_REF}...`);

  // 1. Fetch API keys
  const keys = await fetchApiKeys();
  const anonKeyObj = Array.isArray(keys) ? keys.find((k) => k.name === 'anon' || k.type === 'legacy') : null;
  const anonKey = anonKeyObj ? anonKeyObj.api_key : (Array.isArray(keys) && keys[0] ? keys[0].api_key : null);
  const serviceKeyObj = Array.isArray(keys) ? keys.find((k) => k.name === 'service_role' || k.id === 'service_role') : null;
  const serviceKey = serviceKeyObj ? serviceKeyObj.api_key : null;

  if (!anonKey) {
    console.error('[Supabase Setup] Could not find anon API key in project.');
    process.exit(1);
  }

  console.log(`[Supabase Setup] Found Anon API Key: ${anonKey.slice(0, 16)}...`);
  if (serviceKey) {
    console.log(`[Supabase Setup] Found Service Role Key: ${serviceKey.slice(0, 16)}...`);
  }

  // 2. Read all migrations
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    console.log(`[Supabase Setup] Applying migration: ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const result = await runQuery(sql);
    console.log(`[Supabase Setup] Migration ${file} status:`, result.statusCode);
  }

  // 3. Verify tables
  const verify = await runQuery("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders';");
  console.log('[Supabase Setup] Verified columns in public.orders:', verify.body);

  // 4. Verify stl-uploads bucket in storage.buckets
  const bucketVerify = await runQuery("SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'stl-uploads';");
  console.log('[Supabase Setup] Verified storage bucket stl-uploads:', bucketVerify.body);

  // 5. Create or update .env file
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  } else {
    envContent = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  }

  const supabaseUrl = `https://${PROJECT_REF}.supabase.co`;
  envContent = envContent.replace(/^SUPABASE_URL=.*$/m, `SUPABASE_URL=${supabaseUrl}`);
  envContent = envContent.replace(/^SUPABASE_ANON_KEY=.*$/m, `SUPABASE_ANON_KEY=${anonKey}`);
  if (serviceKey) {
    if (envContent.includes('SUPABASE_SERVICE_ROLE_KEY=')) {
      envContent = envContent.replace(/^#?\s*SUPABASE_SERVICE_ROLE_KEY=.*$/m, `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`);
    } else {
      envContent += `\nSUPABASE_SERVICE_ROLE_KEY=${serviceKey}\n`;
    }
  }
  if (!envContent.includes('SUPABASE_STORAGE_BUCKET=')) {
    envContent += `SUPABASE_STORAGE_BUCKET=stl-uploads\n`;
  } else {
    envContent = envContent.replace(/^SUPABASE_STORAGE_BUCKET=.*$/m, `SUPABASE_STORAGE_BUCKET=stl-uploads`);
  }

  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log('[Supabase Setup] Wrote updated credentials and stl-uploads bucket to .env successfully!');
}

main().catch((err) => {
  console.error('[Supabase Setup] Error:', err);
  process.exit(1);
});
