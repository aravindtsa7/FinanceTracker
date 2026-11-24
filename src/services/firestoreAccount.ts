import {
  doc, getDocFromServer, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc,
  type DocumentData,
} from 'firebase/firestore';

import { auth, firestore } from '@/config/firebase';
import { TRIAL_DAYS } from '@/constants/config';
import { DAY_MS, type UserLicense } from '@/services/licensePolicy';

export interface AccountSync { profile: UserLicense; serverTime: number }
const accountRef = (uid: string) => doc(firestore, 'users', uid);
const licenseRef = (id: string) => doc(firestore, 'licenses', id);
function requireUser(uid: string) {
  if (auth.currentUser?.uid !== uid) throw new Error('Your session has changed. Sign in again.');
}
export function isoDate(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  // Keep existing ISO-date records readable; new records use rules-verifiable Timestamps.
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  throw new Error('The account contains an invalid date. Ask TSA Admin to check its Firestore record.');
}
export function normalizeAccount(data: DocumentData): UserLicense {
  return {
    uid: data.uid, name: data.name, email: data.email, phone: data.phone,
    boundDeviceId: data.boundDeviceId, licenseStatus: data.licenseStatus,
    trialStartsAt: isoDate(data.trialStartsAt), trialEndsAt: isoDate(data.trialEndsAt),
    subscriptionExpiresAt: data.subscriptionExpiresAt == null ? null : isoDate(data.subscriptionExpiresAt),
    pendingDeviceTransfer: data.pendingDeviceTransfer ? {
      newDeviceId: data.pendingDeviceTransfer.newDeviceId,
      requestedAt: isoDate(data.pendingDeviceTransfer.requestedAt ?? data.lastSeenAt),
    } : null,
    approveTransfer: data.approveTransfer === true,
    lastSeenAt: isoDate(data.lastSeenAt), createdAt: isoDate(data.createdAt),
  };
}
// Firestore writes may wait for connectivity. A deadline keeps manual checks responsive;
// a delayed clock write is harmless and never grants a new session by itself.
async function online<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('Internet check timed out. Try again when online.'), { code: 'unavailable' })), 15_000);
  });
  try { return await Promise.race([operation, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}
export async function getFirestoreServerTime(uid: string): Promise<number> {
  requireUser(uid);
  const ref = doc(firestore, 'sessionChecks', uid);
  return online((async () => {
    await setDoc(ref, { checkedAt: serverTimestamp() });
    requireUser(uid);
    const snapshot = await getDocFromServer(ref);
    const checkedAt = snapshot.data()?.checkedAt;
    if (!(checkedAt instanceof Timestamp)) throw new Error('Could not verify Firestore server time. Please try again.');
    return checkedAt.toMillis();
  })());
}
function trialLedger(deviceId: string, trialStartsAt: unknown, trialEndsAt: unknown) {
  return { deviceId, trialStartsAt, trialEndsAt, createdAt: serverTimestamp() };
}

export async function bootstrapAccount(details: { name: string; phone: string }, deviceId: string): Promise<AccountSync> {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('Sign in with your email to finish account setup.');
  const name = details.name.trim();
  const phone = details.phone.trim();
  if (!name || name.length > 100 || !/^\+?[\d ()-]{7,24}$/.test(phone)) throw new Error('Enter your name and a valid phone number.');
  const serverTime = await getFirestoreServerTime(user.uid);
  requireUser(user.uid);
  await online(runTransaction(firestore, async (tx) => {
    const ref = accountRef(user.uid);
    const ledger = licenseRef(deviceId);
    const [existing, previousTrial] = await Promise.all([tx.get(ref), tx.get(ledger)]);
    if (existing.exists()) return; // Retrying setup never resets the account or its binding.
    const start = previousTrial.exists() ? previousTrial.data().trialStartsAt : Timestamp.fromMillis(serverTime);
    const end = previousTrial.exists() ? previousTrial.data().trialEndsAt : Timestamp.fromMillis(serverTime + TRIAL_DAYS * DAY_MS);
    tx.set(ref, {
      uid: user.uid, name, email: user.email, phone, boundDeviceId: deviceId,
      licenseStatus: 'trial', trialStartsAt: start, trialEndsAt: end,
      subscriptionExpiresAt: null, pendingDeviceTransfer: null, approveTransfer: false,
      lastSeenAt: serverTimestamp(), createdAt: serverTimestamp(),
    });
    if (!previousTrial.exists()) tx.set(ledger, trialLedger(deviceId, start, end));
  }, { maxAttempts: 3 }));
  return syncAccount(user.uid, deviceId);
}

export async function syncAccount(uid: string, deviceId: string): Promise<AccountSync> {
  requireUser(uid);
  // A transaction rechecks approval and binding before making any changes. Concurrent
  // admin locks/approvals are never replaced by a stale client copy of the document.
  await online(runTransaction(firestore, async (tx) => {
    const ref = accountRef(uid);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists()) throw new Error('Account setup is incomplete. Use Finish Account Setup.');
    const profile = snapshot.data();
    const approved = profile.approveTransfer === true && profile.pendingDeviceTransfer?.newDeviceId === deviceId;
    if (profile.boundDeviceId !== deviceId && !approved) return;
    const ledger = licenseRef(deviceId);
    const priorTrial = await tx.get(ledger);
    tx.update(ref, approved ? {
      boundDeviceId: deviceId, pendingDeviceTransfer: null, approveTransfer: false, lastSeenAt: serverTimestamp(),
    } : { lastSeenAt: serverTimestamp() });
    // A transferred phone also keeps an immutable trial history. This never edits
    // the user's paid license or an existing phone's original trial dates.
    if (!priorTrial.exists()) tx.set(ledger, trialLedger(deviceId, profile.trialStartsAt, profile.trialEndsAt));
  }, { maxAttempts: 3 }));
  requireUser(uid);
  const result = await online(getDocFromServer(accountRef(uid)));
  if (!result.exists()) throw new Error('The account was removed. Contact TSA Admin.');
  const profile = normalizeAccount(result.data());
  // On the bound phone, lastSeenAt is the just-acknowledged serverTimestamp.
  // Mismatches cannot create a usable cache, so they need no extra clock write.
  return { profile, serverTime: profile.boundDeviceId === deviceId ? Date.parse(profile.lastSeenAt) : Date.now() };
}

export async function requestTransferApproval(uid: string, deviceId: string): Promise<void> {
  requireUser(uid);
  await online(updateDoc(accountRef(uid), {
    pendingDeviceTransfer: { newDeviceId: deviceId, requestedAt: serverTimestamp() },
  }));
}
