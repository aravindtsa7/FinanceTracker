const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function harness({ existing = true, empty = false, expiredToken = false } = {}) {
  const uid = 'alice';
  let account = { phase: 'session', status: 'trial', deviceId: 'TSA-AAAA-1111', profile: { uid } };
  const local = { app: 'FinanceTracker', version: 3, customers: empty ? [] : [{ id: 1 }], loans: [], payments: [], expenses: [] };
  const remote = JSON.stringify({ ...local, customers: [{ id: 2 }] });
  let remoteText = remote;
  let imports = 0;
  let tokenRefreshes = 0;
  let rejectNetwork = false;
  const requests = [];
  const timers = [];
  const storage = new Map([
    ['drive.alice.token', JSON.stringify({ accessToken: 'saved-access', provider: 'native', accountId: 'google-alice', email: 'alice@gmail.com', expiresAt: Date.now() + (expiredToken ? -1 : 3600000) })],
    ['drive.alice.prefs', JSON.stringify({ autoSync: false, lastSyncedAt: null })],
  ]);
  const mocks = {
    'expo-auth-session': { makeRedirectUri: () => 'financetracker://google-drive' },
    'expo-auth-session/providers/google': { discovery: {} }, 'expo-web-browser': {},
    'react-native': { Platform: { OS: 'android' } },
    '@/constants/config': { GOOGLE_WEB_CLIENT_ID: 'client.apps.googleusercontent.com', GOOGLE_ANDROID_CLIENT_ID: 'android.apps.googleusercontent.com', GOOGLE_IOS_CLIENT_ID: 'ios.apps.googleusercontent.com' },
    '@/db/database': {
      exportDatabaseToJson: async () => structuredClone(local),
      inspectBackup: (json) => {
        const data = JSON.parse(json);
        if (data.version !== 3 || !Array.isArray(data.customers)) throw new Error('Invalid backup');
        return { version: 3, exportedAt: null, counts: { customers: data.customers.length, loans: 0, payments: 0, expenses: 0 } };
      },
      importDatabaseFromJson: async (json) => { imports++; assert.equal(json, remote); return { customers: 1, loans: 0, payments: 0, expenses: 0 }; },
    },
    '@/services/authLicenseService': {
      getAuthLicenseState: () => account, messageForError: (error) => error.message,
      refreshLicenseStatus: async () => { if (rejectNetwork) throw new Error('Offline'); },
    },
    '@/services/googleDriveNative': {
      renewNativeDrive: async (accountId, oldToken) => {
        assert.equal(accountId, 'google-alice'); assert.equal(oldToken, 'saved-access'); tokenRefreshes++;
        return { accessToken: 'renewed-access', email: 'alice@gmail.com', accountId, scope: 'https://www.googleapis.com/auth/drive.file' };
      },
    },
    '@/services/secureStorage': { secureStorage: { get: async (key) => storage.get(key) ?? null, set: async (key, value) => value === null ? storage.delete(key) : storage.set(key, value) } },
    '@/utils/fetchWithTimeout': { fetchWithTimeout: async (url, options) => {
      requests.push({ url, options });
      if (url.includes('uploadType=resumable')) return { ok: true, headers: new Headers({ Location: 'https://www.googleapis.com/upload/session' }) };
      if (url.endsWith('upload/session')) return { ok: true };
      if (url.includes('alt=media')) return { ok: true, text: async () => remoteText };
      return { ok: true, json: async () => ({ files: existing ? [{ id: 'backup-file-id', modifiedTime: '2026-10-01T00:00:00Z' }] : [] }) };
    } },
  };
  const exports = {};
  const filename = path.resolve(__dirname, '../src/services/googleDriveBackup.ts');
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext('(function(require, exports) {' + source + '\n})', {
    URLSearchParams, Date, setTimeout: (callback) => { timers.push(callback); return timers.length; }, clearTimeout() {},
  })((id) => { if (!Object.hasOwn(mocks, id)) throw new Error(`Unexpected import ${id}`); return mocks[id]; }, exports);
  return { service: exports, requests, storage, local, timers,
    imports: () => imports, tokenRefreshes: () => tokenRefreshes,
    invalidBackup: () => { remoteText = '{broken'; }, offline: () => { rejectNetwork = true; },
    switchAccount: () => { account = { ...account, profile: { uid: 'bob' } }; },
  };
}
test('cloud backup updates the existing named file and records a last-success timestamp', async () => {
  const h = harness(); await h.service.initializeDrive('alice');
  await h.service.uploadBackupToGoogleDrive();
  const start = h.requests.find((request) => request.url.includes('uploadType=resumable'));
  assert.match(start.url, /backup-file-id/); assert.equal(start.options.method, 'PATCH');
  const upload = h.requests.find((request) => request.options?.method === 'PUT');
  assert.deepEqual(JSON.parse(upload.options.body), h.local);
  assert.ok(h.service.getDriveState().lastSyncedAt);
  assert.equal(h.imports(), 0);
  const query = new URL(h.requests[0].url).searchParams.get('q');
  assert.match(query, /tsaUid/); assert.match(query, /alice/);
});
test('new cloud files carry an account property and automatic empty uploads cannot erase an existing backup', async () => {
  const fresh = harness({ existing: false }); await fresh.service.initializeDrive('alice');
  await fresh.service.uploadBackupToGoogleDrive();
  const start = fresh.requests.find((request) => request.url.includes('uploadType=resumable'));
  const metadata = JSON.parse(start.options.body);
  assert.equal(start.options.method, 'POST');
  assert.equal(metadata.name, 'FinanceTracker_AutoBackup.json'); assert.equal(metadata.appProperties.tsaUid, 'alice');
  const empty = harness({ empty: true }); await empty.service.initializeDrive('alice');
  await assert.rejects(empty.service.uploadBackupToGoogleDrive(), /no finance records/);
  assert.equal(empty.requests.some((request) => request.options?.method === 'PUT'), false);
});
test('restore preview validates and counts records without importing; only explicit restore imports', async () => {
  const h = harness(); await h.service.initializeDrive('alice');
  const preview = await h.service.previewBackupFromGoogleDrive();
  assert.equal(preview.summary.counts.customers, 1); assert.equal(h.imports(), 0);
  await h.service.restoreBackupFromGoogleDrive(preview); assert.equal(h.imports(), 1);
  h.invalidBackup(); await assert.rejects(h.service.previewBackupFromGoogleDrive());
  assert.equal(h.imports(), 1);
});
test('account switches reject a previously downloaded restore snapshot', async () => {
  const h = harness(); await h.service.initializeDrive('alice');
  const preview = await h.service.previewBackupFromGoogleDrive(); h.switchAccount();
  await h.service.initializeDrive('bob');
  await assert.rejects(h.service.restoreBackupFromGoogleDrive(preview), /account changed/i);
  assert.equal(h.imports(), 0);
});
test('offline uploads leave local records and the last-success timestamp untouched', async () => {
  const h = harness(); await h.service.initializeDrive('alice'); h.offline();
  await assert.rejects(h.service.uploadBackupToGoogleDrive(), /Offline/);
  assert.equal(h.requests.length, 0); assert.equal(h.imports(), 0);
  assert.equal(h.service.getDriveState().lastSyncedAt, null);
});
test('expired access tokens renew through the native SDK without a server or client secret', async () => {
  const h = harness({ expiredToken: true }); await h.service.initializeDrive('alice');
  await h.service.uploadBackupToGoogleDrive();
  assert.equal(h.tokenRefreshes(), 1);
  assert.equal(h.requests[0].options.headers.Authorization, 'Bearer renewed-access');
  const saved = JSON.parse(h.storage.get('drive.alice.token'));
  assert.equal(saved.provider, 'native');
  assert.equal(saved.accountId, 'google-alice');
  assert.equal(saved.refreshToken, undefined);
});
test('auto-sync is opt-in and collection triggers schedule a quiet upload', async () => {
  const h = harness(); await h.service.initializeDrive('alice');
  h.service.scheduleAutoSync(); assert.equal(h.timers.length, 0);
  await h.service.setDriveAutoSync(true); assert.equal(h.timers.length, 1);
  h.timers[0](); await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.service.getDriveState().lastSyncedAt);
});
