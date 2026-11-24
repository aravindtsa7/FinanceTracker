import { useSyncExternalStore } from 'react';
import { getAuthLicenseState, subscribeAuthLicense } from '@/services/authLicenseService';

export function useAuthLicense() {
  return useSyncExternalStore(subscribeAuthLicense, getAuthLicenseState, getAuthLicenseState);
}
