import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const secureStorageKey = (key: string) => `tsa.${key.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
async function read(key: string) {
  if (Platform.OS === 'web') return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  return SecureStore.getItemAsync(key, options);
}
async function write(key: string, value: string | null) {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') throw new Error('Storage is unavailable in this browser.');
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  } else if (value === null) await SecureStore.deleteItemAsync(key, options);
  else await SecureStore.setItemAsync(key, value, options);
}

// Firebase tokens can exceed iOS Keychain's historical ~2 KB item limit.
// Write a new generation of small chunks before atomically switching its manifest.
export const secureStorage = {
  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== 'web') return SecureStore.isAvailableAsync();
    try {
      if (typeof localStorage === 'undefined') return false;
      const key = `tsa.storage-check.${Crypto.randomUUID()}`;
      localStorage.setItem(key, '1');
      localStorage.removeItem(key);
      return true;
    } catch { return false; }
  },
  async get(key: string): Promise<string | null> {
    const root = secureStorageKey(key);
    const manifest = await read(root);
    if (!manifest) return null;
    const { id, count } = JSON.parse(manifest) as { id: string; count: number };
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Invalid secure storage entry.');
    const chunks = await Promise.all(Array.from({ length: count }, (_, i) => read(`${root}.${id}.${i}`)));
    if (chunks.some((chunk) => chunk === null)) throw new Error('Secure storage entry is incomplete. Please sign in again.');
    return chunks.join('');
  },
  async set(key: string, value: string | null): Promise<void> {
    const root = secureStorageKey(key);
    const previous = await read(root);
    if (value === null) await write(root, null);
    else {
      const id = Crypto.randomUUID();
      // Split on Unicode code points, preserving emoji and staying below 1600 UTF-8 bytes.
      const characters = Array.from(value);
      const count = Math.max(1, Math.ceil(characters.length / 400));
      for (let i = 0; i < count; i++) await write(`${root}.${id}.${i}`, characters.slice(i * 400, (i + 1) * 400).join(''));
      await write(root, JSON.stringify({ id, count }));
    }
    if (previous) {
      const { id, count } = JSON.parse(previous) as { id: string; count: number };
      await Promise.all(Array.from({ length: count }, (_, i) => write(`${root}.${id}.${i}`, null)));
    }
  },
};
