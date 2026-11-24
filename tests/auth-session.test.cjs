const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness({ cached = true, authenticated = true, delayedHydration = false } = {}) {
  let now = Date.parse('2026-10-01T00:00:00Z');
  const profile = {
    uid: 'alice', name: 'Alice', email: 'alice@example.com', phone: '9876543210', boundDeviceId: 'TSA-AAAA-1111',
    licenseStatus: 'trial', trialStartsAt: new Date(now).toISOString(), trialEndsAt: new Date(now + 7 * 86400000).toISOString(),
    subscriptionExpiresAt: null, pendingDeviceTransfer: null, lastSeenAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString(),
  };
  const store = new Map([['device-id', 'TSA-AAAA-1111']]);
  if (cached) store.set('license-cache', JSON.stringify({ profile, deviceId: profile.boundDeviceId, serverTime: now, syncedAtLocal: now, lastRecordedTimestamp: now, tampered: false }));
  let finishHydration;
  const hydration = delayedHydration ? new Promise((resolve) => { finishHydration = resolve; }) : Promise.resolve();
  const auth = { currentUser: authenticated && !delayedHydration ? { uid: 'alice', email: profile.email } : null, authStateReady: () => hydration };
  let authListener;
  let snapshotListener;
  let offline = true;
  const mocks = {
    '@/config/firebase': { auth, firestore: {}, waitForPersistedAuthUid: async () => authenticated ? 'alice' : null },
    '@/constants/config': { TRIAL_DAYS: 7, OFFLINE_GRACE_DAYS: 3 },
    '@/services/secureStorage': { secureStorage: { get: async (key) => store.get(key) ?? null, set: async (key, value) => value === null ? store.delete(key) : store.set(key, value) } },
    'expo-application': {}, 'expo-crypto': {}, 'react-native': { Platform: { OS: 'android' } },
    'firebase/auth': {
      onAuthStateChanged: (_, fn) => { authListener = fn; },
      signOut: async () => { auth.currentUser = null; authListener?.(null); },
      signInWithEmailAndPassword: async () => { auth.currentUser = { uid: 'alice', email: profile.email }; },
    },
    'firebase/firestore': { doc: () => ({}), onSnapshot: (_, __, fn) => { snapshotListener = fn; return () => {}; } },
    '@/services/firestoreAccount': {
      normalizeAccount: (data) => data,
      syncAccount: async () => {
        if (offline) throw Object.assign(new Error('Offline'), { code: 'unavailable' });
        return { profile: structuredClone(profile), serverTime: now };
      },
      requestTransferApproval: async () => {
        if (offline) throw Object.assign(new Error('Offline'), { code: 'unavailable' });
        profile.pendingDeviceTransfer = { newDeviceId: 'TSA-AAAA-1111', requestedAt: new Date(now).toISOString() };
      },
    },
  };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const loaded = new Map();
  function load(relative) {
    if (loaded.has(relative)) return loaded.get(relative);
    const filename = path.resolve(__dirname, `../${relative}`);
    const source = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    loaded.set(relative, exports);
    vm.runInNewContext('(function(require, exports) {' + source + '\n})', { Date: Clock, console, process })(
      (id) => Object.hasOwn(mocks, id) ? mocks[id] : load(`src/${id.slice(2)}.ts`), exports);
    return exports;
  }
  return { service: load('src/services/authLicenseService.ts'), store, profile, auth,
    hydrate: () => { auth.currentUser = { uid: 'alice', email: profile.email }; finishHydration?.(); },
    online: () => { offline = false; }, advance: (ms) => { now += ms; },
    snapshot: (boundDeviceId) => snapshotListener({ metadata: { fromCache: false }, exists: () => true, data: () => ({ boundDeviceId }) }),
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
test('an authenticated cached session opens and stays usable entirely offline', async () => {
  const h = harness();
  await h.service.initializeAuthLicense(); await flush();
  assert.equal(h.service.getAuthLicenseState().phase, 'session');
  assert.equal(h.service.getAuthLicenseState().status, 'trial');
  h.advance(2 * 86400000);
  await h.service.recordLocalTime();
  assert.equal(h.service.getAuthLicenseState().status, 'trial');
  assert.equal(h.service.getAuthLicenseState().daysLeft, 5);
});
test('a cache without its Firebase session cannot open finance screens', async () => {
  const h = harness({ authenticated: false });
  await h.service.initializeAuthLicense();
  assert.equal(h.service.getAuthLicenseState().phase, 'signed-out');
});
test('offline grace and rollback lock persist; online authoritative sync clears the tamper latch', async () => {
  const h = harness();
  await h.service.initializeAuthLicense(); await flush();
  h.advance(3 * 86400000);
  await h.service.recordLocalTime();
  assert.equal(h.service.getAuthLicenseState().status, 'offline-check-required');
  h.advance(-2 * 86400000);
  await h.service.recordLocalTime();
  assert.equal(h.service.getAuthLicenseState().status, 'tampered');
  assert.equal(JSON.parse(h.store.get('license-cache')).tampered, true);
  h.advance(2 * 86400000);
  await h.service.recordLocalTime();
  assert.equal(h.service.getAuthLicenseState().status, 'tampered');
  h.online();
  await h.service.refreshLicenseStatus();
  assert.equal(h.service.getAuthLicenseState().status, 'trial');
  assert.equal(JSON.parse(h.store.get('license-cache')).tampered, false);
});
test('old phone logs out and clears only its session cache when a remote transfer is observed', async () => {
  const h = harness();
  await h.service.initializeAuthLicense(); await flush();
  h.service.watchDeviceBinding(); await flush();
  h.snapshot('TSA-BBBB-2222'); await flush();
  assert.equal(h.service.getAuthLicenseState().phase, 'signed-out');
  assert.equal(h.auth.currentUser, null);
  assert.equal(h.store.has('license-cache'), false);
  assert.equal(h.store.get('device-id'), 'TSA-AAAA-1111');
});
test('cached native access does not wait for Firebase startup network hydration', async () => {
  const h = harness({ delayedHydration: true });
  await h.service.initializeAuthLicense();
  assert.equal(h.auth.currentUser, null);
  assert.equal(h.service.getAuthLicenseState().phase, 'session');
  assert.equal(h.service.getAuthLicenseState().status, 'trial');
  h.hydrate(); await flush();
  assert.equal(h.service.getAuthLicenseState().phase, 'session');
});
test('new phone with a mismatched device is sent to transfer instead of opening a session', async () => {
  const h = harness({ cached: false });
  h.online(); h.profile.boundDeviceId = 'TSA-BBBB-2222';
  await h.service.initializeAuthLicense(); await flush();
  assert.equal(h.service.getAuthLicenseState().phase, 'transfer');
  assert.equal(h.store.has('license-cache'), false);
});
test('online admin activation unlocks an expired trial immediately', async () => {
  const h = harness();
  await h.service.initializeAuthLicense(); await flush();
  h.advance(8 * 86400000); await h.service.recordLocalTime();
  assert.equal(h.service.getAuthLicenseState().status, 'expired');
  h.profile.licenseStatus = 'active';
  h.profile.subscriptionExpiresAt = '2026-12-01T00:00:00Z'; h.online();
  await h.service.refreshLicenseStatus();
  assert.equal(h.service.getAuthLicenseState().status, 'active');
});
