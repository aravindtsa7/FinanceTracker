import { ResponseType } from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useSyncExternalStore } from 'react';
import { GOOGLE_WEB_CLIENT_ID } from '@/constants/config';
import { connectGoogleDrive, driveOAuthRedirectUri, getDriveState, subscribeDrive } from '@/services/googleDriveBackup';

WebBrowser.maybeCompleteAuthSession();
export function useGoogleDrive() {
  const state = useSyncExternalStore(subscribeDrive, getDriveState, getDriveState);
  // Web is a public browser client: implicit access tokens, no secret or server exchange.
  const [request] = Google.useAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID, webClientId: GOOGLE_WEB_CLIENT_ID,
    redirectUri: driveOAuthRedirectUri(), responseType: ResponseType.Token, usePKCE: false,
    shouldAutoExchangeCode: false, scopes: ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'],
    extraParams: { prompt: 'consent select_account' },
  });
  return { ...state, requestReady: !!request, connect: async () => {
    if (!request) throw new Error('Google authorization is loading. Please try again.');
    await connectGoogleDrive(request);
  } };
}
