'use strict';

const cookie = require('cookie');

/**
 * Admin authorization middleware for SNKB 3D Studio.
 *
 * Secures /admin and /api/admin/* endpoints using:
 *   - ADMIN_PASSCODE (primary)
 *   - ADMIN_ACCESS_TOKEN
 *   - SNKB_ADMIN_SECRET
 *
 * Supported auth vectors:
 *   - Cookie: `admin_passcode=<secret>` or `admin_token=<secret>`
 *   - Header: `x-admin-passcode: <secret>` or `x-admin-token: <secret>`
 *   - Header: `Authorization: Bearer <secret>`
 *   - Query: `?admin_passcode=<secret>` or `?admin_token=<secret>` or `?passcode=<secret>`
 *   - Body: `{ passcode: <secret> }` or `{ token: <secret> }`
 *
 * If no secret is configured in the environment, requests are permitted (zero-config local dev).
 */

function getConfiguredSecrets() {
  const secrets = [];
  if (process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim()) {
    secrets.push(process.env.ADMIN_PASSCODE.trim());
  }
  if (process.env.ADMIN_ACCESS_TOKEN && process.env.ADMIN_ACCESS_TOKEN.trim()) {
    secrets.push(process.env.ADMIN_ACCESS_TOKEN.trim());
  }
  if (process.env.SNKB_ADMIN_SECRET && process.env.SNKB_ADMIN_SECRET.trim()) {
    secrets.push(process.env.SNKB_ADMIN_SECRET.trim());
  }
  return secrets;
}

function getConfiguredSecret() {
  const secrets = getConfiguredSecrets();
  return secrets.length > 0 ? secrets[0] : null;
}

function parseCookies(req) {
  if (req.cookies && typeof req.cookies === 'object' && Object.keys(req.cookies).length > 0) {
    return req.cookies;
  }
  const cookieHeader = req.headers && req.headers.cookie;
  if (!cookieHeader) return {};
  try {
    if (typeof cookie.parseCookie === 'function') {
      return cookie.parseCookie(cookieHeader);
    }
    if (typeof cookie.parse === 'function') {
      return cookie.parse(cookieHeader);
    }
  } catch {
    /* fallback to manual split */
  }
  const out = {};
  String(cookieHeader)
    .split(';')
    .forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx > -1) {
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        out[key] = decodeURIComponent(val);
      }
    });
  return out;
}

function verifyAdminAuth(req) {
  const secrets = getConfiguredSecrets();
  if (secrets.length === 0) {
    return { authorized: true };
  }

  const cookies = parseCookies(req);
  const cookieToken = cookies.admin_passcode || cookies.admin_token || cookies.ADMIN_PASSCODE;

  const headerToken =
    req.headers && (req.headers['x-admin-passcode'] || req.headers['x-admin-token']);

  const authHeader = (req.headers && req.headers['authorization']) || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch ? bearerMatch[1] : null;

  const queryToken =
    req.query && (req.query.admin_passcode || req.query.admin_token || req.query.passcode);

  const bodyToken =
    req.body && (req.body.passcode || req.body.admin_passcode || req.body.token || req.body.adminToken);

  const candidate = cookieToken || headerToken || bearerToken || queryToken || bodyToken;

  if (candidate && secrets.includes(String(candidate).trim())) {
    return { authorized: true };
  }

  return {
    authorized: false,
    error: 'unauthorized',
    message: 'Admin authorization required. Provide a valid ADMIN_PASSCODE via cookie or header.',
  };
}

function adminAuthMiddleware(req, res, next) {
  const result = verifyAdminAuth(req);
  if (!result.authorized) {
    return res.status(401).json({
      success: false,
      error: result.error,
      message: result.message,
    });
  }
  next();
}

/**
 * Protects HTML /admin routes.
 * If authorized: calls next().
 * If unauthorized:
 *   - If request accepts JSON / AJAX: returns 401 JSON.
 *   - Otherwise: returns a styled 401 Passcode Login challenge page.
 */
function adminPageAuthMiddleware(req, res, next) {
  const result = verifyAdminAuth(req);
  if (result.authorized) {
    const secret = getConfiguredSecret();
    if (secret && req.query && (req.query.admin_passcode || req.query.passcode)) {
      res.cookie('admin_passcode', secret, {
        path: '/',
        httpOnly: false,
        maxAge: 86400 * 1000,
        sameSite: 'lax',
      });
    }
    return next();
  }

  const acceptsJson = req.xhr || (req.headers && req.headers.accept && req.headers.accept.includes('application/json'));
  if (acceptsJson) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Admin authorization required. Invalid or missing ADMIN_PASSCODE.',
    });
  }

  const errorParam = req.query?.error
    ? '<div style="background:rgba(225,29,72,0.2);border:1px solid #e11d48;color:#fda4af;padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:16px;">Invalid admin passcode. Access denied.</div>'
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Security Clearance — SNKB 3D Studio</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #0c0d0e;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .panel {
      background: #18191c;
      border: 1px solid #2b2e36;
      border-radius: 14px;
      max-width: 420px;
      width: 100%;
      padding: 32px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      position: relative;
      overflow: hidden;
    }
    .panel::before {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, #FF6500, #00FF66);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 101, 0, 0.1);
      border: 1px solid rgba(255, 101, 0, 0.4);
      color: #FF6500;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      padding: 3px 8px;
      border-radius: 4px;
      margin-bottom: 12px;
    }
    h1 { font-size: 18px; font-weight: 800; margin-bottom: 6px; color: #fff; }
    p { font-size: 12px; color: #a1a1aa; line-height: 1.5; margin-bottom: 20px; }
    .input-group { margin-bottom: 20px; }
    label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #d4d4d8; margin-bottom: 6px; }
    input[type="password"], input[type="text"] {
      width: 100%;
      background: #090a0b;
      border: 1px solid #3f3f46;
      border-radius: 8px;
      padding: 10px 14px;
      color: #fff;
      font-size: 13px;
      font-family: monospace;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus { border-color: #FF6500; }
    button {
      width: 100%;
      background: #FF6500;
      color: #000;
      font-weight: 800;
      font-size: 13px;
      padding: 12px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      letter-spacing: 0.05em;
      transition: background 0.2s;
    }
    button:hover { background: #ff771a; }
    .footer-note { font-size: 10px; color: #71717a; text-align: center; margin-top: 18px; }
  </style>
</head>
<body>
  <div class="panel">
    <div class="badge">
      <span style="width:6px;height:6px;border-radius:50%;background:#FF6500;display:inline-block;"></span>
      <span>Admin Security Clearance</span>
    </div>
    <h1>Terminal Locked</h1>
    <p>Internal operations portal for SNKB 3D Studio. Enter authorized <code>ADMIN_PASSCODE</code> to proceed.</p>
    ${errorParam}
    <form method="POST" action="/api/admin/login">
      <input type="hidden" name="redirect" value="/admin" />
      <div class="input-group">
        <label for="passcode">Admin Passcode</label>
        <input type="password" id="passcode" name="passcode" required placeholder="Enter passcode…" autofocus autocomplete="current-password" />
      </div>
      <button type="submit">Authorize Terminal →</button>
    </form>
    <div class="footer-note">
      SNKB 3D Studio • Hardware Operations Farm
    </div>
  </div>
</body>
</html>`;

  return res.status(401).send(html);
}

module.exports = {
  getConfiguredSecrets,
  getConfiguredSecret,
  parseCookies,
  verifyAdminAuth,
  adminAuthMiddleware,
  adminPageAuthMiddleware,
};
