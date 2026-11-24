// Metro chooses .native.ts on Android/iOS. Web and TypeScript use this interface.
export interface NativeDriveGrant { accessToken: string; email: string; accountId: string; scope: string }
export async function authorizeNativeDrive(): Promise<NativeDriveGrant | null> {
  throw new Error('Native Google Sign-In is available in the mobile app.');
}
export async function renewNativeDrive(_accountId: string, _previousToken: string): Promise<NativeDriveGrant> {
  throw new Error('Reconnect Google Drive in this browser.');
}
export async function disconnectNativeDrive(_accountId: string): Promise<void> {}
