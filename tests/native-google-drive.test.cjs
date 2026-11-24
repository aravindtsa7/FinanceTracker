const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

function harness({ cancelled = false, accountId = 'google-alice', permission = true, missingModule = false } = {}) {
  const calls = [];
  const result = () => cancelled ? { type: 'cancelled' } : { type: 'success', data: {
    user: { id: accountId, email: 'alice@gmail.com' }, scopes: permission ? ['https://www.googleapis.com/auth/drive.file'] : [],
  } };
  const sdk = {
    configure: (options) => calls.push(['configure', options]),
    hasPlayServices: async () => { calls.push(['playServices']); },
    signOut: async () => { calls.push(['signOut']); },
    signIn: async () => { calls.push(['interactive']); return result(); },
    signInSilently: async () => { calls.push(['silent']); return result(); },
    getTokens: async () => { calls.push(['tokens']); return { accessToken: 'new-access', idToken: 'not-used-for-firebase' }; },
    clearCachedAccessToken: async (token) => { calls.push(['clear', token]); },
    getCurrentUser: () => result().data ?? null,
  };
  const filename = path.resolve(__dirname, '../src/services/googleDriveNative.native.ts');
  const mod = new Module(filename, module);
  mod.require = (id) => {
    if (id === 'react-native') return { Platform: { OS: 'android' } };
    if (id === '@/constants/config') return { GOOGLE_WEB_CLIENT_ID: 'web.apps.googleusercontent.com', GOOGLE_IOS_CLIENT_ID: 'ios.apps.googleusercontent.com' };
    if (id === '@react-native-google-signin/google-signin') {
      if (missingModule) throw new Error('Native module not installed');
      return { GoogleSignin: sdk };
    }
    throw new Error(`Unexpected dependency: ${id}`);
  };
  mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return { service: mod.exports, calls };
}
test('native authorization obtains Drive access without Firebase sign-in or server auth codes', async () => {
  const h = harness(); const grant = await h.service.authorizeNativeDrive();
  assert.equal(grant.accountId, 'google-alice'); assert.equal(grant.accessToken, 'new-access');
  const options = h.calls.find(([name]) => name === 'configure')[1];
  assert.equal(options.offlineAccess, false); assert.equal(options.webClientId, 'web.apps.googleusercontent.com');
  assert.equal(options.androidClientId, undefined); assert.equal(grant.idToken, undefined);
});
test('renewal is silent, verifies the saved account and clears an expired cached access token', async () => {
  const h = harness(); await h.service.renewNativeDrive('google-alice', 'old-access');
  assert.equal(h.calls.some(([name]) => name === 'interactive'), false);
  assert.deepEqual(h.calls.find(([name]) => name === 'clear'), ['clear', 'old-access']);
  assert.equal(h.calls.some(([name]) => name === 'tokens'), true);
});
test('a different Google account or withdrawn Drive scope cannot be used to renew a backup connection', async () => {
  for (const options of [{ accountId: 'google-bob' }, { permission: false }]) {
    const h = harness(options);
    await assert.rejects(h.service.renewNativeDrive('google-alice', 'old-access'), /Reconnect/);
    assert.equal(h.calls.some(([name]) => name === 'tokens'), false);
  }
});
test('cancellation and a missing native build never create a connection', async () => {
  const cancelled = harness({ cancelled: true });
  assert.equal(await cancelled.service.authorizeNativeDrive(), null);
  assert.equal(cancelled.calls.some(([name]) => name === 'tokens'), false);
  await assert.rejects(harness({ missingModule: true }).service.authorizeNativeDrive(), /new development or release build/);
});
test('disconnecting a stored account cannot sign out a different active Google account', async () => {
  const h = harness({ accountId: 'google-bob' });
  await h.service.disconnectNativeDrive('google-alice');
  assert.equal(h.calls.some(([name]) => name === 'signOut'), false);
});
