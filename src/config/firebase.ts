import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, type Persistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

import googleServices from '../../google-services.json';
import { secureStorage, secureStorageKey } from '@/services/secureStorage';

const client = googleServices.client.find((item) => item.client_info.android_client_info.package_name === 'com.tsa.financetracker');
if (!client?.api_key[0]?.current_key) throw new Error('Firebase configuration for com.tsa.financetracker is missing.');

export const firebaseApp = getApps().length ? getApp() : initializeApp({
  apiKey: client.api_key[0].current_key,
  appId: client.client_info.mobilesdk_app_id,
  projectId: googleServices.project_info.project_id,
  messagingSenderId: googleServices.project_info.project_number,
  storageBucket: googleServices.project_info.storage_bucket,
  authDomain: `${googleServices.project_info.project_id}.firebaseapp.com`,
});

let resolvePersistedUid: (uid: string | null) => void;
const persistedUid = new Promise<string | null>((resolve) => { resolvePersistedUid = resolve; });

class SecureStorePersistence {
  static type = 'LOCAL' as const;
  readonly type = 'LOCAL' as const;
  async _isAvailable() { return secureStorage.isAvailable(); }
  async _set(key: string, value: unknown) { await secureStorage.set(key, JSON.stringify(value)); }
  async _get<T>(key: string): Promise<T | null> {
    const value = await secureStorage.get(key);
    const parsed = value === null ? null : JSON.parse(value) as T;
    // Firebase loads this local entry before its startup network reload. Expose only
    // the UID so a valid offline cache need not wait for Firebase's network timeout.
    if (key.startsWith('firebase:authUser:')) {
      const uid = (parsed as { uid?: unknown } | null)?.uid;
      resolvePersistedUid(typeof uid === 'string' ? uid : null);
    }
    return parsed;
  }
  async _remove(key: string) { await secureStorage.set(key, null); }
  private browserListeners = new Map<string, Map<unknown, (event: StorageEvent) => void>>();
  _addListener(key: string, listener: (value: unknown) => void) {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const handler = (event: StorageEvent) => {
      if (event.key === secureStorageKey(key)) void this._get(key).then(listener).catch(() => {});
    };
    const registered = this.browserListeners.get(key) ?? new Map();
    registered.set(listener, handler);
    this.browserListeners.set(key, registered);
    window.addEventListener('storage', handler);
  }
  _removeListener(key: string, listener: (value: unknown) => void) {
    const registered = this.browserListeners.get(key);
    const handler = registered?.get(listener);
    if (handler && typeof window !== 'undefined') window.removeEventListener('storage', handler);
    registered?.delete(listener);
  }
}

function createAuth() {
  try {
    return initializeAuth(firebaseApp, {
      persistence: SecureStorePersistence as unknown as Persistence,
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/already-initialized') return getAuth(firebaseApp);
    throw error;
  }
}
export const auth = createAuth();
export function waitForPersistedAuthUid(): Promise<string | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser.uid);
  return Promise.race([persistedUid, auth.authStateReady().then(() => auth.currentUser?.uid ?? null)]);
}
export const firestore = getFirestore(firebaseApp);
