import { OFFLINE_GRACE_DAYS, TRIAL_DAYS } from '@/constants/config';

export const DAY_MS = 86_400_000;
export type LicenseStatus = 'trial' | 'active' | 'expired' | 'tampered' | 'offline-check-required';
export interface UserLicense {
  uid: string;
  name: string;
  email: string;
  phone: string;
  boundDeviceId: string;
  licenseStatus: 'trial' | 'active' | 'expired';
  trialStartsAt: string;
  trialEndsAt: string;
  subscriptionExpiresAt: string | null;
  pendingDeviceTransfer: { newDeviceId: string; requestedAt: string } | null;
  approveTransfer?: boolean;
  lastSeenAt: string;
  createdAt: string;
}
export interface LicenseCache {
  profile: UserLicense;
  deviceId: string;
  serverTime: number;
  syncedAtLocal: number;
  lastRecordedTimestamp: number;
  tampered: boolean;
}
export function evaluateLicense(cache: LicenseCache, now = Date.now()): { status: LicenseStatus; daysLeft: number } {
  if (cache.tampered || now < cache.lastRecordedTimestamp - 60_000 || now < cache.syncedAtLocal - 60_000) {
    return { status: 'tampered', daysLeft: 0 };
  }
  const elapsed = Math.max(0, now - cache.syncedAtLocal);
  const trustedNow = cache.serverTime + elapsed;
  const p = cache.profile;
  const start = Date.parse(p.trialStartsAt);
  const end = Math.min(Date.parse(p.trialEndsAt), start + TRIAL_DAYS * DAY_MS);
  const daysLeft = Number.isFinite(end) ? Math.max(0, Math.ceil((end - trustedNow) / DAY_MS)) : 0;
  const valid = p.licenseStatus === 'active'
    ? Number.isFinite(Date.parse(p.subscriptionExpiresAt ?? '')) && Date.parse(p.subscriptionExpiresAt!) > trustedNow
    : p.licenseStatus === 'trial' && Number.isFinite(start) && trustedNow >= start && trustedNow < end;
  if (!valid) return { status: 'expired', daysLeft: 0 };
  if (elapsed >= OFFLINE_GRACE_DAYS * DAY_MS) return { status: 'offline-check-required', daysLeft };
  return { status: p.licenseStatus === 'active' ? 'active' : 'trial', daysLeft };
}
