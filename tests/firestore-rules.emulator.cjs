// Run with the Firestore emulator, never against the production project.
const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fs = require('firebase/firestore');

const DEVICE = 'TSA-AAAA-1111';
const NEXT = 'TSA-BBBB-2222';
const THIRD = 'TSA-CCCC-3333';
const DAY = 86_400_000;
let environment;
fs.setLogLevel('silent');
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Start the Firestore emulator to run these rules tests.');
  environment = await initializeTestEnvironment({
    projectId: 'demo-financetracker',
    firestore: { rules: readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
beforeEach(async () => environment.clearFirestore());
after(async () => environment?.cleanup());
const dbFor = (uid = 'alice') => environment.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();
const userRef = (db, uid = 'alice') => fs.doc(db, 'users', uid);
const ledgerRef = (db, id = DEVICE) => fs.doc(db, 'licenses', id);
async function admin(task) { return environment.withSecurityRulesDisabled((context) => task(context.firestore())); }
function accountService(uid = 'alice', db = dbFor(uid)) {
  const filename = path.resolve(__dirname, '../src/services/firestoreAccount.ts');
  const mod = new Module(filename, module);
  const mocks = {
    '@/config/firebase': { auth: { currentUser: { uid, email: `${uid}@example.com` } }, firestore: db },
    '@/constants/config': { TRIAL_DAYS: 7 },
    '@/services/licensePolicy': { DAY_MS: DAY },
  };
  mod.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id);
  mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return mod.exports;
}
const register = (uid = 'alice', id = DEVICE, db = dbFor(uid)) => accountService(uid, db).bootstrapAccount({ name: 'Alice', phone: '9876543210' }, id);
function trialWrite(db, uid = 'alice', { start = Date.now() - 60_000, days = 7, ...overrides } = {}) {
  const trialStartsAt = fs.Timestamp.fromMillis(start);
  const trialEndsAt = fs.Timestamp.fromMillis(start + days * DAY);
  const profile = {
    uid, name: 'Alice', email: `${uid}@example.com`, phone: '9876543210', boundDeviceId: DEVICE,
    licenseStatus: 'trial', trialStartsAt, trialEndsAt, subscriptionExpiresAt: null,
    pendingDeviceTransfer: null, approveTransfer: false, createdAt: fs.serverTimestamp(), lastSeenAt: fs.serverTimestamp(),
    ...overrides,
  };
  const batch = fs.writeBatch(db);
  batch.set(userRef(db, uid), profile);
  batch.set(ledgerRef(db), { deviceId: DEVICE, trialStartsAt, trialEndsAt, createdAt: fs.serverTimestamp() });
  return batch.commit();
}

test('actual registration and sync succeed with a seven-day server-timed trial and private contact data', async () => {
  const db = dbFor();
  const result = await register('alice', DEVICE, db);
  assert.equal(result.profile.uid, 'alice');
  assert.equal(Date.parse(result.profile.trialEndsAt) - Date.parse(result.profile.trialStartsAt), 7 * DAY);
  assert.ok(Math.abs(result.serverTime - Date.now()) < 60_000);
  const user = (await fs.getDocFromServer(userRef(db))).data();
  assert.ok(user.lastSeenAt instanceof fs.Timestamp);
  const ledger = (await fs.getDocFromServer(ledgerRef(db))).data();
  assert.deepEqual(Object.keys(ledger).sort(), ['createdAt', 'deviceId', 'trialEndsAt', 'trialStartsAt']);
});
test('repeat setup and a new email on the same device cannot reset an expired trial', async () => {
  const start = fs.Timestamp.fromMillis(Date.now() - 12 * DAY);
  const end = fs.Timestamp.fromMillis(start.toMillis() + 7 * DAY);
  await admin((db) => fs.setDoc(ledgerRef(db), { deviceId: DEVICE, trialStartsAt: start, trialEndsAt: end, createdAt: start }));
  const first = await register();
  const again = await register();
  const another = await register('bob');
  assert.equal(first.profile.trialStartsAt, start.toDate().toISOString());
  assert.equal(again.profile.trialEndsAt, first.profile.trialEndsAt);
  assert.equal(another.profile.trialEndsAt, first.profile.trialEndsAt);
});
test('simultaneous registrations share exactly one immutable device trial', async () => {
  const [a, b] = await Promise.all([register('alice'), register('bob')]);
  assert.equal(a.profile.trialStartsAt, b.profile.trialStartsAt);
  assert.equal(a.profile.trialEndsAt, b.profile.trialEndsAt);
});
test('authenticated exact-device trial lookup is allowed, listing and unauthenticated reads are denied', async () => {
  await register();
  const bob = dbFor('bob');
  await assertSucceeds(fs.getDocFromServer(ledgerRef(bob)));
  await assertFails(fs.getDocs(fs.collection(bob, 'licenses')));
  await assertFails(fs.getDocFromServer(userRef(bob)));
  const anonymous = environment.unauthenticatedContext().firestore();
  await assertFails(fs.getDocFromServer(ledgerRef(anonymous)));
  await assertFails(fs.getDocFromServer(userRef(anonymous)));
});
test('clients cannot create active users, subscriptions, preapproved transfers or an eight-day trial', async () => {
  const db = dbFor();
  for (const invalid of [
    { licenseStatus: 'active' }, { subscriptionExpiresAt: fs.Timestamp.fromMillis(Date.now() + DAY) },
    { approveTransfer: true }, { days: 8 }, { start: Date.now() + DAY },
    { role: 'admin' }, { uid: 'bob' }, { email: 'bob@example.com' },
  ]) await assertFails(trialWrite(db, 'alice', invalid));
  await assertSucceeds(trialWrite(db));
});
test('a user cannot create a trial without its matching ledger or reserve other device IDs', async () => {
  const db = dbFor();
  await register('alice', DEVICE, db);
  const user = (await fs.getDocFromServer(userRef(db))).data();
  await assertFails(fs.setDoc(ledgerRef(db, NEXT), {
    deviceId: NEXT, trialStartsAt: user.trialStartsAt, trialEndsAt: user.trialEndsAt, createdAt: fs.serverTimestamp(),
  }));
  await assertFails(fs.deleteDoc(userRef(db)));
  await assertFails(fs.deleteDoc(ledgerRef(db)));
});
test('license status, trial dates and subscription dates cannot be changed or deleted by their owner', async () => {
  const db = dbFor(); await register('alice', DEVICE, db);
  for (const field of ['licenseStatus', 'trialStartsAt', 'trialEndsAt', 'subscriptionExpiresAt']) {
    await assertFails(fs.updateDoc(userRef(db), { [field]: field === 'licenseStatus' ? 'active' : fs.Timestamp.fromMillis(Date.now() + 30 * DAY) }));
    await assertFails(fs.updateDoc(userRef(db), { [field]: fs.deleteField() }));
  }
  await assertFails(fs.updateDoc(ledgerRef(db), { trialEndsAt: fs.Timestamp.fromMillis(Date.now() + 30 * DAY) }));
});
test('safe profile fields and server lastSeenAt can change; identity, creation date and forged time cannot', async () => {
  const db = dbFor(); await register('alice', DEVICE, db);
  await assertSucceeds(fs.updateDoc(userRef(db), { name: 'Updated', phone: '+91 9876543210', lastSeenAt: fs.serverTimestamp() }));
  for (const patch of [{ email: 'other@example.com' }, { uid: 'bob' }, { admin: true }, { createdAt: fs.serverTimestamp() }, { lastSeenAt: fs.Timestamp.fromMillis(0) }]) {
    await assertFails(fs.updateDoc(userRef(db), patch));
  }
});
test('unapproved phone is a mismatch and a request never rebinds the account', async () => {
  const db = dbFor(); const service = accountService('alice', db);
  await register('alice', DEVICE, db);
  await service.requestTransferApproval('alice', NEXT);
  const result = await service.syncAccount('alice', NEXT);
  assert.equal(result.profile.boundDeviceId, DEVICE);
  assert.equal(result.profile.pendingDeviceTransfer.newDeviceId, NEXT);
  await assertFails(fs.updateDoc(userRef(db), { boundDeviceId: NEXT }));
  await assertFails(fs.updateDoc(userRef(db), { approveTransfer: true }));
  await assertFails(fs.updateDoc(userRef(db), { pendingDeviceTransfer: { newDeviceId: NEXT, requestedAt: fs.serverTimestamp(), approved: true } }));
});
test('admin-approved target is consumed atomically, cannot be substituted and cannot be replayed', async () => {
  const db = dbFor(); const service = accountService('alice', db);
  const initial = await register('alice', DEVICE, db);
  await service.requestTransferApproval('alice', NEXT);
  await admin((adminDb) => fs.updateDoc(userRef(adminDb), { approveTransfer: true }));
  await assertFails(fs.updateDoc(userRef(db), { pendingDeviceTransfer: { newDeviceId: THIRD, requestedAt: fs.serverTimestamp() } }));
  await assertFails(fs.updateDoc(userRef(db), { boundDeviceId: THIRD, approveTransfer: false, pendingDeviceTransfer: null }));
  const transferred = await service.syncAccount('alice', NEXT);
  assert.equal(transferred.profile.boundDeviceId, NEXT);
  assert.equal(transferred.profile.approveTransfer, false);
  assert.equal(transferred.profile.pendingDeviceTransfer, null);
  assert.equal(transferred.profile.trialEndsAt, initial.profile.trialEndsAt);
  assert.ok((await fs.getDocFromServer(ledgerRef(db, NEXT))).exists());
  await assertFails(fs.updateDoc(userRef(db), { boundDeviceId: THIRD }));
  assert.equal((await service.syncAccount('alice', DEVICE)).profile.boundDeviceId, NEXT);
});
test('direct admin binding, activation and remote lock are observed without client privilege', async () => {
  const db = dbFor(); const service = accountService('alice', db);
  await register('alice', DEVICE, db);
  await admin((adminDb) => fs.updateDoc(userRef(adminDb), {
    boundDeviceId: NEXT, pendingDeviceTransfer: null, licenseStatus: 'active', subscriptionExpiresAt: fs.Timestamp.fromMillis(Date.now() + 30 * DAY),
  }));
  const activated = await service.syncAccount('alice', NEXT);
  assert.equal(activated.profile.licenseStatus, 'active');
  assert.equal(activated.profile.boundDeviceId, NEXT);
  await admin((adminDb) => fs.updateDoc(userRef(adminDb), { licenseStatus: 'expired' }));
  assert.equal((await service.syncAccount('alice', NEXT)).profile.licenseStatus, 'expired');
});
test('a transfer to a previously used phone preserves that phone trial ledger', async () => {
  const db = dbFor(); const service = accountService('alice', db);
  await register('alice', DEVICE, db);
  const old = fs.Timestamp.fromMillis(Date.now() - 20 * DAY);
  await admin(async (adminDb) => {
    await fs.setDoc(ledgerRef(adminDb, NEXT), { deviceId: NEXT, trialStartsAt: old, trialEndsAt: fs.Timestamp.fromMillis(old.toMillis() + 7 * DAY), createdAt: old });
    await fs.updateDoc(userRef(adminDb), { boundDeviceId: NEXT });
  });
  await service.syncAccount('alice', NEXT);
  assert.equal((await fs.getDocFromServer(ledgerRef(db, NEXT))).data().trialStartsAt.toMillis(), old.toMillis());
});
test('server-time checks reject forged timestamps and reads by other accounts', async () => {
  const db = dbFor(); const ref = fs.doc(db, 'sessionChecks', 'alice');
  await assertFails(fs.setDoc(ref, { checkedAt: fs.Timestamp.fromMillis(Date.now() + DAY) }));
  await assertSucceeds(fs.setDoc(ref, { checkedAt: fs.serverTimestamp() }));
  await assertFails(fs.getDocFromServer(fs.doc(dbFor('bob'), 'sessionChecks', 'alice')));
  await assertFails(fs.setDoc(ref, { checkedAt: fs.serverTimestamp(), licenseStatus: 'active' }));
});
test('legacy device mirrors containing contact details cannot leak them to another account', async () => {
  await admin((db) => fs.setDoc(ledgerRef(db), {
    uid: 'alice', name: 'Private name', email: 'alice@example.com', phone: '9876543210',
    trialStartsAt: '2026-09-01T00:00:00Z', trialEndsAt: '2026-09-08T00:00:00Z',
  }));
  await assertSucceeds(fs.getDocFromServer(ledgerRef(dbFor('alice'))));
  await assertFails(fs.getDocFromServer(ledgerRef(dbFor('bob'))));
});
test('legacy admin ISO dates remain readable and unchanged when the account transfers', async () => {
  const db = dbFor(); const service = accountService('alice', db);
  await register('alice', DEVICE, db);
  const start = '2026-09-01T00:00:00.000Z'; const end = '2026-09-08T00:00:00.000Z';
  await admin((adminDb) => fs.updateDoc(userRef(adminDb), { trialStartsAt: start, trialEndsAt: end, boundDeviceId: NEXT }));
  const result = await service.syncAccount('alice', NEXT);
  assert.equal(result.profile.trialStartsAt, start);
  assert.equal(result.profile.trialEndsAt, end);
});
