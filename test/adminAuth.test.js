'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  verifyAdminAuth,
  adminAuthMiddleware,
  adminPageAuthMiddleware,
  getConfiguredSecret,
} = require('../src/middleware/adminAuth');

test('adminAuth - allows access when no secret is configured', () => {
  const origPasscode = process.env.ADMIN_PASSCODE;
  const orig = process.env.ADMIN_ACCESS_TOKEN;
  const origSecret = process.env.SNKB_ADMIN_SECRET;
  delete process.env.ADMIN_PASSCODE;
  delete process.env.ADMIN_ACCESS_TOKEN;
  delete process.env.SNKB_ADMIN_SECRET;

  assert.equal(getConfiguredSecret(), null);
  const result = verifyAdminAuth({ headers: {} });
  assert.equal(result.authorized, true);

  if (origPasscode) process.env.ADMIN_PASSCODE = origPasscode;
  if (orig) process.env.ADMIN_ACCESS_TOKEN = orig;
  if (origSecret) process.env.SNKB_ADMIN_SECRET = origSecret;
});

test('adminAuth - rejects requests without token when secret is configured', () => {
  process.env.ADMIN_PASSCODE = 'passcode-xyz-123';

  const req = { headers: {} };
  const result = verifyAdminAuth(req);
  assert.equal(result.authorized, false);
  assert.equal(result.error, 'unauthorized');

  delete process.env.ADMIN_PASSCODE;
});

test('adminAuth - accepts valid ADMIN_PASSCODE via x-admin-passcode header', () => {
  process.env.ADMIN_PASSCODE = 'super-pass-3d';

  const req = {
    headers: { 'x-admin-passcode': 'super-pass-3d' },
  };
  const result = verifyAdminAuth(req);
  assert.equal(result.authorized, true);

  delete process.env.ADMIN_PASSCODE;
});

test('adminAuth - accepts valid ADMIN_PASSCODE via cookie (admin_passcode)', () => {
  process.env.ADMIN_PASSCODE = 'cookie-pass-456';

  const req = {
    headers: { cookie: 'session=abc; admin_passcode=cookie-pass-456; theme=dark' },
  };
  const result = verifyAdminAuth(req);
  assert.equal(result.authorized, true);

  delete process.env.ADMIN_PASSCODE;
});

test('adminAuth - accepts valid x-admin-token header', () => {
  process.env.ADMIN_ACCESS_TOKEN = 'secret-999';

  const req = {
    headers: { 'x-admin-token': 'secret-999' },
  };
  const result = verifyAdminAuth(req);
  assert.equal(result.authorized, true);

  delete process.env.ADMIN_ACCESS_TOKEN;
});

test('adminAuth - accepts valid Authorization Bearer header', () => {
  process.env.ADMIN_ACCESS_TOKEN = 'secret-bearer-456';

  const req = {
    headers: { authorization: 'Bearer secret-bearer-456' },
  };
  const result = verifyAdminAuth(req);
  assert.equal(result.authorized, true);

  delete process.env.ADMIN_ACCESS_TOKEN;
});

test('adminAuth - accepts valid token in request body', () => {
  process.env.ADMIN_ACCESS_TOKEN = 'secret-body-789';

  const req = {
    headers: {},
    body: { token: 'secret-body-789' },
  };
  const result = verifyAdminAuth(req);
  assert.equal(result.authorized, true);

  delete process.env.ADMIN_ACCESS_TOKEN;
});

test('adminAuth - rejects wrong token with 401', () => {
  process.env.ADMIN_PASSCODE = 'correct-key';

  let statusCode = null;
  let jsonOutput = null;

  const req = {
    headers: { 'x-admin-token': 'wrong-key' },
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonOutput = data;
      return this;
    },
  };

  adminAuthMiddleware(req, res, () => {
    assert.fail('next() should not be called for unauthorized request');
  });

  assert.equal(statusCode, 401);
  assert.equal(jsonOutput.error, 'unauthorized');

  delete process.env.ADMIN_PASSCODE;
});

test('adminPageAuthMiddleware - protects /admin HTML route with 401 challenge when unauthorized', () => {
  process.env.ADMIN_PASSCODE = 'passcode-protect-777';

  let statusCode = null;
  let htmlOutput = null;

  const req = {
    headers: { accept: 'text/html' },
    cookies: {},
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    send(html) {
      htmlOutput = html;
      return this;
    },
  };

  adminPageAuthMiddleware(req, res, () => {
    assert.fail('next() should not be called when unauthorized');
  });

  assert.equal(statusCode, 401);
  assert.ok(htmlOutput.includes('Admin Security Clearance'));
  assert.ok(htmlOutput.includes('Terminal Locked'));

  // With valid cookie, passes through to next()
  let nextCalled = false;
  const authorizedReq = {
    headers: { cookie: 'admin_passcode=passcode-protect-777' },
  };
  adminPageAuthMiddleware(authorizedReq, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);

  delete process.env.ADMIN_PASSCODE;
});
