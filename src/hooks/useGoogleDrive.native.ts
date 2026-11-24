import { useSyncExternalStore } from 'react';
import { connectGoogleDrive, getDriveState, subscribeDrive } from '@/services/googleDriveBackup';

export function useGoogleDrive() {
  const state = useSyncExternalStore(subscribeDrive, getDriveState, getDriveState);
  return { ...state, requestReady: true, connect: () => connectGoogleDrive() };
}
