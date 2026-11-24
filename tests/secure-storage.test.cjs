const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function harness() {
  const values = new Map();
  let failWrites = false;
  const native = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    getItemAsync: async (key) => values.get(key) ?? null,
    deleteItemAsync: async (key) => { values.delete(key); },
    setItemAsync: async (key, value) => {
      if (failWrites) throw new Error('Keychain unavailable');
      assert.ok(Buffer.byteLength(value, 'utf8') <= 1600, 'Every native item must fit within the platform limit');
      values.set(key, value);
    },
  };
  const filename = path.resolve(__dirname, '../src/services/secureStorage.ts');
  const mod = new Module(filename, module);
  mod.require = (id) => id === 'expo-crypto' ? { randomUUID } : id === 'expo-secure-store' ? native : { Platform: { OS: 'android' } };
  mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return { storage: mod.exports.secureStorage, values, fail: () => { failWrites = true; } };
}
test('large Unicode auth/session values round-trip through small native Keychain chunks', async () => {
  const h = harness();
  const value = JSON.stringify({ name: '🪙अர'.repeat(1800), token: 'a'.repeat(4000) });
  await h.storage.set('firebase:authUser:key:[DEFAULT]', value);
  assert.equal(await h.storage.get('firebase:authUser:key:[DEFAULT]'), value);
});
test('replacement and logout clean previous chunks while preserving unrelated device keys', async () => {
  const h = harness();
  await h.storage.set('device-id', 'TSA-AAAA-1111');
  await h.storage.set('session', 'x'.repeat(6000));
  const oldKeys = [...h.values.keys()].filter((key) => key.startsWith('tsa.session.'));
  await h.storage.set('session', 'new-session');
  assert.equal(oldKeys.some((key) => h.values.has(key)), false);
  assert.equal(await h.storage.get('session'), 'new-session');
  await h.storage.set('session', null);
  assert.equal(await h.storage.get('session'), null);
  assert.equal(await h.storage.get('device-id'), 'TSA-AAAA-1111');
});
test('a failed new write leaves the previous valid secure entry readable', async () => {
  const h = harness();
  await h.storage.set('session', 'old-session'); h.fail();
  await assert.rejects(h.storage.set('session', 'new-session'), /Keychain/);
  assert.equal(await h.storage.get('session'), 'old-session');
});
