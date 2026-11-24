import { Platform } from 'react-native';
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '@/constants/config';
import type { NativeDriveGrant } from '@/services/googleDriveNative';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
let configured = false;
async function sdk() {
  let module: typeof import('@react-native-google-signin/google-signin');
  try { module = await import('@react-native-google-signin/google-signin'); }
  catch { throw new Error('Google Drive requires a new development or release build with native Google Sign-In. It is not available in Expo Go.'); }
  if (!configured) {
    module.GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID, scopes: [SCOPE], offlineAccess: false,
      ...(Platform.OS === 'ios' ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}),
    });
    configured = true;
  }
  return module.GoogleSignin;
}
export async function authorizeNativeDrive(): Promise<NativeDriveGrant | null> {
  const signin = await sdk();
  await signin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  // Consent to a fresh account must not inherit another Firebase user's Google login.
  await signin.signOut();
  const result = await signin.signIn();
  if (result.type !== 'success') return null;
  if (!result.data.scopes.includes(SCOPE)) throw new Error('Allow Google Drive file access before connecting.');
  const tokens = await signin.getTokens();
  return { accessToken: tokens.accessToken, email: result.data.user.email, accountId: result.data.user.id, scope: result.data.scopes.join(' ') };
}
export async function renewNativeDrive(accountId: string, previousToken: string): Promise<NativeDriveGrant> {
  const signin = await sdk();
  const result = await signin.signInSilently();
  if (result.type !== 'success' || result.data.user.id !== accountId || !result.data.scopes.includes(SCOPE)) {
    throw new Error('Google authorization changed. Reconnect Google Drive from Settings.');
  }
  await signin.clearCachedAccessToken(previousToken);
  const tokens = await signin.getTokens();
  return { accessToken: tokens.accessToken, email: result.data.user.email, accountId, scope: result.data.scopes.join(' ') };
}
export async function disconnectNativeDrive(accountId: string): Promise<void> {
  const signin = await sdk();
  const current = signin.getCurrentUser();
  if (current?.user.id === accountId) await signin.signOut();
}
