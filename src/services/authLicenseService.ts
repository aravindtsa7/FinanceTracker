import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { Platform } from 'react-native';

import { auth, firestore, waitForPersistedAuthUid } from '@/config/firebase';
import { bootstrapAccount, normalizeAccount, requestTransferApproval, syncAccount } from '@/services/firestoreAccount';
import { evaluateLicense, type LicenseCache, type LicenseStatus, type UserLicense } from '@/services/licensePolicy';
import { secureStorage } from '@/services/secureStorage';

export interface AuthLicenseState {
  ready: boolean;
  phase: 'signed-out' | 'session' | 'transfer' | 'check-required';
  profile: UserLicense | null;
  deviceId: string;
  status: LicenseStatus;
  daysLeft: number;
  error: string | null;
}
let state: AuthLicenseState = { ready: false, phase: 'signed-out', profile: null, deviceId: '', status: 'offline-check-required', daysLeft: 0, error: null };
let cache: LicenseCache | null = null;
let initialization: Promise<void> | null = null;
let devicePromise: Promise<string> | null = null;
let refreshPromise: Promise<void> | null = null;
let sessionGeneration = 0;
let authBusy = false;
const listeners = new Set<() => void>();
export const getAuthLicenseState = () => state;
export const subscribeAuthLicense = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(patch: Partial<AuthLicenseState>) { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); }
export const messageForError = (error: unknown) => {
  const code = (error as { code?: string })?.code;
  if (code === 'auth/invalid-credential') return 'The email or password is incorrect.';
  if (['auth/network-request-failed', 'unavailable', 'deadline-exceeded'].includes(code ?? '')) return 'Could not connect. Check your internet connection and try again.';
  if (code === 'permission-denied') return 'Firestore denied this change. Publish the current firestore.rules, or ask TSA Admin to check the account and transfer approval.';
  if (code === 'auth/email-already-in-use') return 'This email is already registered. Sign in to finish account setup.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait before trying again.';
  return error instanceof Error ? error.message : String(error);
};
export function getDeviceId(): Promise<string> {
  devicePromise ??= (async () => {
    const stored = await secureStorage.get('device-id');
    if (stored) return stored;
    let seed: string | null = null;
    if (Platform.OS === 'android') {
      try { seed = Application.getAndroidId(); } catch { /* Fall back to an installation UUID. */ }
    }
    seed ||= Crypto.randomUUID();
    const hash = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, seed)).slice(0, 8).toUpperCase();
    const deviceId = `TSA-${hash.slice(0, 4)}-${hash.slice(4)}`;
    await secureStorage.set('device-id', deviceId);
    return deviceId;
  })();
  return devicePromise;
}

function showCache() {
  if (!cache) return;
  const evaluation = evaluateLicense(cache);
  cache.tampered ||= evaluation.status === 'tampered';
  cache.lastRecordedTimestamp = Math.max(cache.lastRecordedTimestamp, Date.now());
  publish({ phase: 'session', profile: cache.profile, ...evaluation });
}
let cacheWrites = Promise.resolve();
function persistCache() {
  const value = cache ? JSON.stringify(cache) : null;
  cacheWrites = cacheWrites.catch(() => {}).then(() => secureStorage.set('license-cache', value));
  return cacheWrites;
}
export async function recordLocalTime() {
  if (!cache || state.phase !== 'session') return;
  showCache();
  await persistCache();
}
interface SyncResponse { profile: UserLicense; serverTime: number }
async function acceptServer(response: SyncResponse, deviceId: string, generation: number) {
  if (generation !== sessionGeneration || auth.currentUser?.uid !== response.profile.uid) return;
  if (response.profile.boundDeviceId !== deviceId) {
    if (cache?.profile.uid === response.profile.uid && cache.profile.boundDeviceId === deviceId) {
      await logoutUser('This account was transferred to another phone. Sign in to request a transfer back.');
      return;
    }
    cache = null;
    await persistCache();
    publish({ phase: 'transfer', profile: response.profile, error: null });
    return;
  }
  const local = Date.now();
  cache = { profile: response.profile, deviceId, serverTime: response.serverTime, syncedAtLocal: local, lastRecordedTimestamp: local, tampered: false };
  await persistCache();
  showCache();
  publish({ error: null });
}
export async function refreshLicenseStatus(): Promise<void> {
  if (authBusy && state.phase === 'signed-out') return;
  if (refreshPromise) return refreshPromise;
  const generation = sessionGeneration;
  refreshPromise = (async () => {
    await auth.authStateReady();
    if (!auth.currentUser) return;
    const deviceId = await getDeviceId();
    try {
      const response = await syncAccount(auth.currentUser.uid, deviceId);
      await acceptServer(response, deviceId, generation);
    } catch (error) {
      if (generation !== sessionGeneration) return;
      const code = (error as { code?: string }).code;
      if (['auth/user-disabled', 'auth/user-token-expired', 'unauthenticated'].includes(code ?? '')) {
        await logoutUser('Your session has ended. Please sign in again.');
      } else {
        if (cache) { showCache(); await persistCache(); }
        else publish({ phase: 'check-required' });
        publish({ error: messageForError(error) });
      }
      throw error;
    }
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export function initializeAuthLicense(): Promise<void> {
  initialization ??= (async () => {
    const deviceId = await getDeviceId();
    const persistedUid = await waitForPersistedAuthUid();
    publish({ deviceId });
    const stored = await secureStorage.get('license-cache');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as LicenseCache;
        if (parsed.profile?.uid === persistedUid && parsed.deviceId === deviceId && parsed.profile.boundDeviceId === deviceId
          && [parsed.serverTime, parsed.syncedAtLocal, parsed.lastRecordedTimestamp].every(Number.isFinite)) cache = parsed;
      } catch { cache = null; }
    }
    if (cache) { showCache(); await persistCache(); }
    else publish({ phase: persistedUid ? 'check-required' : 'signed-out' });
    publish({ ready: true });
    onAuthStateChanged(auth, (user) => {
      if (!user && !authBusy) {
        cache = null;
        publish({ phase: 'signed-out', profile: null });
        void persistCache().catch(() => {});
      }
    });
    // The auth SDK may still be completing its network reload. Reconcile in the
    // background; the UI is already usable with its validated local session.
    void auth.authStateReady().then(() => {
      if (auth.currentUser) {
        return refreshLicenseStatus();
      }
    }).catch(() => {});
  })().catch((error) => {
    initialization = null;
    publish({ ready: true, phase: 'check-required', error: messageForError(error) });
    throw error;
  });
  return initialization;
}

export async function registerUser(name: string, email: string, phone: string, password: string) {
  if (refreshPromise) await refreshPromise.catch(() => {});
  authBusy = true;
  sessionGeneration++;
  try {
    const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await updateProfile(user, { displayName: name.trim() });
    // Persisted locally until the Firestore transaction finishes; retryable after a network failure.
    await secureStorage.set(`registration.${user.uid}`, JSON.stringify({ name: name.trim(), phone: phone.trim() }));
    await sendEmailVerification(user);
    await completeRegistration();
  } catch (error) {
    if (auth.currentUser) publish({ phase: 'check-required', profile: null, error: messageForError(error) });
    throw error;
  } finally { authBusy = false; }
}
export async function completeRegistration(override?: { name: string; phone: string }) {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in again.');
  const stored = await secureStorage.get(`registration.${user.uid}`);
  const details = override ?? (stored ? JSON.parse(stored) as { name: string; phone: string } : { name: user.displayName ?? '', phone: '' });
  const deviceId = await getDeviceId();
  const response = await bootstrapAccount(details, deviceId);
  await acceptServer(response, deviceId, sessionGeneration);
  await secureStorage.set(`registration.${user.uid}`, null);
}
export async function loginUser(email: string, password: string) {
  if (refreshPromise) await refreshPromise.catch(() => {});
  authBusy = true;
  sessionGeneration++;
  cache = null;
  await persistCache();
  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
    publish({ phase: 'check-required', profile: null, error: null });
    await refreshLicenseStatus();
  } finally { authBusy = false; }
}
export async function logoutUser(reason: string | null = null) {
  sessionGeneration++;
  cache = null;
  publish({ phase: 'signed-out', profile: null, error: reason });
  await persistCache();
  // SQLite is deliberately never touched by account operations.
  await signOut(auth);
}
export async function sendPasswordReset(email: string) {
  await sendPasswordResetEmail(auth, email.trim());
}
export async function resendVerificationEmail() {
  if (!auth.currentUser) throw new Error('Please sign in again.');
  await sendEmailVerification(auth.currentUser);
}
export async function requestDeviceTransfer(): Promise<{ delivery: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Please sign in again.');
  await requestTransferApproval(uid, await getDeviceId());
  return { delivery: 'admin' };
}
export function watchDeviceBinding() {
  let cancelled = false;
  let unsubscribe = () => {};
  void auth.authStateReady().then(() => {
    const uid = auth.currentUser?.uid;
    if (cancelled || !uid || state.profile?.uid !== uid || state.phase !== 'session') return;
    unsubscribe = onSnapshot(doc(firestore, 'users', uid), { includeMetadataChanges: true }, (snapshot) => {
      if (state.profile?.uid !== uid || state.phase !== 'session') return;
      if (!snapshot.metadata.fromCache && snapshot.exists() && snapshot.data().boundDeviceId !== state.deviceId) {
        void logoutUser('This account was transferred to another phone.').catch(() => {});
      } else if (!snapshot.metadata.fromCache && snapshot.exists() && cache) {
        try {
          cache.profile = normalizeAccount(snapshot.data());
          showCache();
          void persistCache().catch(() => {});
        } catch { /* A malformed admin edit must be repaired before the next successful sync. */ }
      }
    }, () => { /* Foreground sync and the offline deadline continue to enforce cached access. */ });
  }).catch(() => {});
  return () => { cancelled = true; unsubscribe(); };
}
