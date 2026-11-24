const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadPolicy() {
  const filename = path.resolve(__dirname, '../src/services/licensePolicy.ts');
  const mod = new Module(filename, module);
  mod.require = () => ({ TRIAL_DAYS: 7, OFFLINE_GRACE_DAYS: 3 });
  mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return mod.exports;
}
const { evaluateLicense, DAY_MS: DAY } = loadPolicy();
const start = Date.parse('2026-10-01T00:00:00Z');
function cached(overrides = {}) {
  return {
    profile: { licenseStatus: 'trial', trialStartsAt: new Date(start).toISOString(), trialEndsAt: new Date(start + 7 * DAY).toISOString(), subscriptionExpiresAt: null },
    serverTime: start, syncedAtLocal: start, lastRecordedTimestamp: start, tampered: false, ...overrides,
  };
}
test('trial lasts seven days, with no extra grace after its actual expiry', () => {
  assert.deepEqual(evaluateLicense(cached(), start), { status: 'trial', daysLeft: 7 });
  assert.equal(evaluateLicense(cached({ serverTime: start + 6 * DAY }), start + DAY - 1).status, 'trial');
  assert.equal(evaluateLicense(cached({ serverTime: start + 6 * DAY }), start + DAY).status, 'expired');
});
test('offline grace permits just under three days, then requires a server check', () => {
  assert.equal(evaluateLicense(cached(), start + 3 * DAY - 1).status, 'trial');
  assert.equal(evaluateLicense(cached(), start + 3 * DAY).status, 'offline-check-required');
});
test('clock rollback beyond one minute locks, and the tamper latch survives correcting the clock', () => {
  assert.equal(evaluateLicense(cached(), start - 60_000).status, 'trial');
  assert.equal(evaluateLicense(cached(), start - 60_001).status, 'tampered');
  assert.equal(evaluateLicense(cached({ tampered: true }), start + DAY).status, 'tampered');
  assert.equal(evaluateLicense(cached({ lastRecordedTimestamp: start + DAY }), start).status, 'tampered');
});
test('active subscriptions require a valid future expiry and expire at the exact boundary', () => {
  const cache = cached();
  cache.profile.licenseStatus = 'active';
  assert.equal(evaluateLicense(cache, start).status, 'expired');
  cache.profile.subscriptionExpiresAt = new Date(start + DAY).toISOString();
  assert.equal(evaluateLicense(cache, start).status, 'active');
  assert.equal(evaluateLicense(cache, start + DAY).status, 'expired');
});
test('server time offset prevents an incorrect device clock from extending a trial', () => {
  const local = start - 300 * DAY;
  const cache = cached({ syncedAtLocal: local, lastRecordedTimestamp: local, serverTime: start + 6 * DAY });
  assert.equal(evaluateLicense(cache, local).daysLeft, 1);
  assert.equal(evaluateLicense(cache, local + DAY).status, 'expired');
});
test('invalid dates, explicit expiry, and extending trialEndsAt fail closed', () => {
  const cache = cached({ serverTime: start + 8 * DAY });
  cache.profile.trialEndsAt = new Date(start + 30 * DAY).toISOString();
  assert.equal(evaluateLicense(cache, start).status, 'expired');
  cache.profile.trialStartsAt = 'invalid';
  assert.equal(evaluateLicense(cache, start).status, 'expired');
  cache.profile.licenseStatus = 'expired';
  assert.equal(evaluateLicense(cache, start).status, 'expired');
});
