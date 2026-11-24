const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the actual callable handlers with transactional in-memory Firestore and fixed server time.
// No production project or email account is contacted by these tests.
function harness(emailEnabled = true) {
  const records = new Map();
  let clock = Date.parse('2026-10-01T00:00:00Z');
  let sequence = 0;
  const ref = (key) => ({ key, get: async () => snapshot(key, records) });
  const snapshot = (key, source) => ({ exists: source.has(key), data: () => source.has(key) ? structuredClone(source.get(key)) : undefined });
  const firestore = {
    doc: ref, collection: (name) => ({ doc: () => ref(`${name}/${++sequence}`) }),
    runTransaction: async (callback) => {
      const writes = [];
      const tx = {
        get: async (reference) => { assert.equal(writes.length, 0, 'Firestore reads must precede writes'); return snapshot(reference.key, records); },
        set: (reference, value, options) => writes.push(() => records.set(reference.key, structuredClone(options?.merge ? { ...records.get(reference.key), ...value } : value))),
        create: (reference, value) => { assert.equal(records.has(reference.key), false); writes.push(() => records.set(reference.key, structuredClone(value))); },
        update: (reference, value) => writes.push(() => records.set(reference.key, structuredClone({ ...records.get(reference.key), ...value }))),
        delete: (reference) => writes.push(() => records.delete(reference.key)),
      };
      const result = await callback(tx);
      writes.forEach((write) => write());
      return result;
    },
  };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const mocks = {
    'firebase-admin/app': { initializeApp() {} },
    'firebase-admin/auth': { getAuth: () => ({ getUser: async (uid) => ({ uid, email: `${uid}@example.com`, displayName: 'Test' }) }) },
    'firebase-admin/firestore': { getFirestore: () => firestore },
    'firebase-functions/v2/https': { onCall: (_, handler) => handler, onRequest: (_, handler) => handler, HttpsError },
    'firebase-functions/params': {
      defineBoolean: () => ({ value: () => emailEnabled }),
      defineString: (name, options) => ({ value: () => name === 'GOOGLE_WEB_CLIENT_ID' ? 'client.apps.googleusercontent.com' : options.default }),
      defineSecret: () => ({ value: () => 'server-only-secret' }),
    },
  };
  const context = {
    exports: {}, require: (id) => mocks[id] ?? require(id), Date: FixedDate, Buffer, URLSearchParams, AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' }) }),
  };
  vm.runInNewContext(readFileSync(path.join(__dirname, '../index.js'), 'utf8'), context);
  const request = (uid = 'alice', deviceId = 'TSA-AAAA-1111', extra = {}) => ({ auth: uid ? { uid } : undefined, data: { name: 'Alice', phone: '9876543210', deviceId, ...extra } });
  return { handlers: context.exports, records, request, advance: (ms) => { clock += ms; }, code: () => [...records.entries()].filter(([key]) => key.startsWith('mail/')).at(-1)?.[1].message.text.match(/code is (\d{6})/)[1] };
}
const DAY = 86_400_000;
test('registration creates a server-timed trial and device mirror; repeated registration cannot reset it', async () => {
  const h = harness();
  const first = await h.handlers.bootstrapAccount(h.request());
  assert.equal(Date.parse(first.profile.trialEndsAt) - first.serverTime, 7 * DAY);
  assert.deepEqual(h.records.get('licenses/TSA-AAAA-1111'), h.records.get('users/alice'));
  h.advance(2 * DAY);
  const again = await h.handlers.bootstrapAccount(h.request());
  assert.equal(first.profile.trialStartsAt, again.profile.trialStartsAt);
  const secondEmail = await h.handlers.bootstrapAccount(h.request('bob'));
  assert.equal(secondEmail.profile.trialEndsAt, first.profile.trialEndsAt);
});
test('callables reject unauthenticated callers, malformed devices and incomplete profiles', async () => {
  const h = harness();
  await assert.rejects(h.handlers.bootstrapAccount(h.request(null)), { code: 'unauthenticated' });
  await assert.rejects(async () => h.handlers.syncAccount(h.request('alice', '../../users')), { code: 'invalid-argument' });
  await assert.rejects(h.handlers.bootstrapAccount(h.request('alice', undefined, { phone: '' })), { code: 'invalid-argument' });
  await assert.rejects(h.handlers.syncAccount(h.request()), { code: 'failed-precondition' });
});
test('mismatch does not rebind; only an emailed code transfers, clears the secret and updates mirrors', async () => {
  const h = harness();
  await h.handlers.bootstrapAccount(h.request());
  const next = h.request('alice', 'TSA-BBBB-2222');
  const mismatch = await h.handlers.syncAccount(next);
  assert.equal(mismatch.profile.boundDeviceId, 'TSA-AAAA-1111');
  await h.handlers.requestDeviceTransfer(next);
  const code = h.code();
  assert.match(code, /^\d{6}$/);
  const readable = await h.handlers.syncAccount(next);
  assert.equal(JSON.stringify(readable).includes(code), false);
  const transferred = await h.handlers.verifyDeviceTransfer({ ...next, data: { ...next.data, code } });
  assert.equal(transferred.profile.boundDeviceId, 'TSA-BBBB-2222');
  assert.equal(transferred.profile.pendingDeviceTransfer, null);
  assert.equal(h.records.has('deviceTransfers/alice'), false);
  assert.equal(h.records.get('licenses/TSA-AAAA-1111').transferredTo, 'TSA-BBBB-2222');
  assert.equal((await h.handlers.syncAccount(h.request())).profile.boundDeviceId, 'TSA-BBBB-2222');
  await assert.rejects(h.handlers.verifyDeviceTransfer({ ...next, data: { ...next.data, code } }), { code: 'permission-denied' });
});
test('failed OTP attempts are committed, and lock out even the correct code after five tries', async () => {
  const h = harness();
  await h.handlers.bootstrapAccount(h.request());
  const next = h.request('alice', 'TSA-BBBB-2222');
  await h.handlers.requestDeviceTransfer(next);
  const correct = h.code();
  const wrong = correct === '111111' ? '222222' : '111111';
  for (let i = 1; i <= 5; i++) {
    await assert.rejects(h.handlers.verifyDeviceTransfer({ ...next, data: { ...next.data, code: wrong } }), { code: 'permission-denied' });
    assert.equal(h.records.get('deviceTransfers/alice').attempts, i);
  }
  await assert.rejects(h.handlers.verifyDeviceTransfer({ ...next, data: { ...next.data, code: correct } }), { code: 'permission-denied' });
  assert.equal(h.records.get('users/alice').boundDeviceId, 'TSA-AAAA-1111');
});
test('transfer expiry, different-device codes and resend throttling are enforced', async () => {
  const h = harness();
  await h.handlers.bootstrapAccount(h.request());
  const next = h.request('alice', 'TSA-BBBB-2222');
  await h.handlers.requestDeviceTransfer(next);
  const code = h.code();
  await assert.rejects(h.handlers.requestDeviceTransfer(next), { code: 'resource-exhausted' });
  await assert.rejects(h.handlers.verifyDeviceTransfer(h.request('alice', 'TSA-CCCC-3333', { code })), { code: 'permission-denied' });
  h.advance(10 * 60_000);
  await assert.rejects(h.handlers.verifyDeviceTransfer({ ...next, data: { ...next.data, code } }), { code: 'permission-denied' });
  await h.handlers.requestDeviceTransfer(next);
});
test('email disabled saves an admin request and never exposes an OTP or permits code verification', async () => {
  const h = harness(false);
  await h.handlers.bootstrapAccount(h.request());
  const next = h.request('alice', 'TSA-BBBB-2222');
  assert.equal((await h.handlers.requestDeviceTransfer(next)).delivery, 'admin');
  assert.equal(h.code(), undefined);
  await assert.rejects(h.handlers.verifyDeviceTransfer({ ...next, data: { ...next.data, code: '123456' } }), { code: 'permission-denied' });
  const p = h.records.get('users/alice');
  p.boundDeviceId = next.data.deviceId; p.pendingDeviceTransfer = null;
  assert.equal((await h.handlers.syncAccount(next)).profile.boundDeviceId, next.data.deviceId);
});
test('Drive token exchange requires a bound, unexpired account and an approved HTTPS redirect', async () => {
  const h = harness();
  await h.handlers.bootstrapAccount(h.request());
  const grant = { grantType: 'authorization_code', code: 'code', codeVerifier: 'x'.repeat(43), redirectUri: 'https://us-central1-financetracker-3cd32.cloudfunctions.net/driveOAuthCallback' };
  await assert.rejects(h.handlers.driveToken(h.request('alice', 'TSA-BBBB-2222', grant)), { code: 'permission-denied' });
  await assert.rejects(h.handlers.driveToken(h.request('alice', undefined, { ...grant, redirectUri: 'https://attacker.example' })), { code: 'invalid-argument' });
  assert.equal((await h.handlers.driveToken(h.request('alice', undefined, grant))).accessToken, 'access');
  h.advance(7 * DAY);
  await assert.rejects(h.handlers.driveToken(h.request('alice', undefined, grant)), { code: 'permission-denied' });
  const p = h.records.get('users/alice');
  p.licenseStatus = 'active'; p.subscriptionExpiresAt = new Date(Date.parse(p.trialEndsAt) + DAY).toISOString();
  assert.equal((await h.handlers.driveToken(h.request('alice', undefined, grant))).accessToken, 'access');
});
