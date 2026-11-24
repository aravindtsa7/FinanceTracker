import { makeRedirectUri, type AuthRequest } from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '@/constants/config';
import { exportDatabaseToJson, importDatabaseFromJson, inspectBackup } from '@/db/database';
import { getAuthLicenseState, messageForError, refreshLicenseStatus } from '@/services/authLicenseService';
import { authorizeNativeDrive, disconnectNativeDrive, renewNativeDrive } from '@/services/googleDriveNative';
import { secureStorage } from '@/services/secureStorage';
import type { BackupSummary, TableCounts } from '@/types/finance';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = 'FinanceTracker_AutoBackup.json';
const API = 'https://www.googleapis.com/drive/v3/files';
interface DriveSession { accessToken: string; expiresAt: number; email: string; accountId: string; provider: 'native' | 'web' }
interface DrivePreferences { autoSync: boolean; lastSyncedAt: string | null }
interface TokenResult { accessToken: string; expiresIn: number; scope?: string; accountId: string; provider: 'native' | 'web' }
export interface DriveState extends DrivePreferences { connected: boolean; email: string | null; busy: boolean; error: string | null }
let state: DriveState = { connected: false, email: null, autoSync: false, lastSyncedAt: null, busy: false, error: null };
let owner: string | null = null;
let token: DriveSession | null = null;
let revision = 0;
let operation: Promise<unknown> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
export const getDriveState = () => state;
export const subscribeDrive = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = (patch: Partial<DriveState>) => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); };
const configuredId = (id: string) => !id.startsWith('YOUR_') && id.endsWith('.apps.googleusercontent.com');
// On Android with @react-native-google-signin/google-signin, only GOOGLE_WEB_CLIENT_ID and google-services.json are required.
export const isDriveConfigured = () => configuredId(GOOGLE_WEB_CLIENT_ID)
  && (Platform.OS === 'ios' ? configuredId(GOOGLE_IOS_CLIENT_ID) : true);
const storageKey = (uid: string, kind: string) => `drive.${uid}.${kind}`;
function currentUid() {
  const session = getAuthLicenseState();
  if (session.phase !== 'session' || !session.profile || !['active', 'trial'].includes(session.status)) throw new Error('A valid account and license are required for Google Drive sync.');
  return session.profile.uid;
}
function assertOwner(uid: string) {
  if (owner !== uid || currentUid() !== uid) throw new Error('The account changed. Please try again.');
}
export async function initializeDrive(uid: string | null) {
  const generation = ++revision;
  owner = uid;
  token = null;
  if (timer) clearTimeout(timer);
  publish({ connected: false, email: null, autoSync: false, lastSyncedAt: null, busy: false, error: null });
  if (!uid) return;
  try {
    const [session, prefs] = await Promise.all([secureStorage.get(storageKey(uid, 'token')), secureStorage.get(storageKey(uid, 'prefs'))]);
    if (generation !== revision) return;
    token = session ? JSON.parse(session) as DriveSession : null;
    if (token && (!token.provider || !token.accountId)) {
      // Superseded server-exchanged tokens are not renewed by the Spark app.
      token = null;
      await secureStorage.set(storageKey(uid, 'token'), null);
      if (generation !== revision) return;
    }
    const preferences = prefs ? JSON.parse(prefs) as DrivePreferences : { autoSync: false, lastSyncedAt: null };
    publish({ ...preferences, connected: !!token, email: token?.email ?? null });
  } catch (error) { if (generation === revision) publish({ error: messageForError(error) }); }
}
async function savePreferences(uid: string) {
  assertOwner(uid);
  await secureStorage.set(storageKey(uid, 'prefs'), JSON.stringify({ autoSync: state.autoSync, lastSyncedAt: state.lastSyncedAt }));
}
async function withOperation<T>(task: (uid: string) => Promise<T>, preflight = true): Promise<T> {
  if (operation) throw new Error('Another cloud operation is running. Please wait.');
  const uid = currentUid();
  assertOwner(uid);
  publish({ busy: true, error: null });
  const pending = (async () => {
    try {
      if (preflight) await refreshLicenseStatus();
      assertOwner(uid);
      return await task(uid);
    } catch (error) {
      if (owner === uid) publish({ error: messageForError(error) });
      throw error;
    } finally { if (owner === uid) publish({ busy: false }); }
  })();
  operation = pending;
  try { return await pending; } finally { operation = null; }
}
async function storeToken(uid: string, result: TokenResult, email: string) {
  assertOwner(uid);
  if (result.scope && !result.scope.split(' ').includes(SCOPE)) throw new Error('Google Drive permission was not granted. Reconnect and allow backup access.');
  const next = { accessToken: result.accessToken, expiresAt: Date.now() + result.expiresIn * 1000, email, accountId: result.accountId, provider: result.provider };
  await secureStorage.set(storageKey(uid, 'token'), JSON.stringify(next));
  assertOwner(uid);
  token = next;
  publish({ connected: true, email });
}
export async function connectGoogleDrive(request?: AuthRequest) {
  if (!isDriveConfigured()) throw new Error('Configure the Google Web and platform OAuth client IDs before connecting Google Drive.');
  await withOperation(async (uid) => {
    if (Platform.OS !== 'web') {
      const grant = await authorizeNativeDrive();
      if (!grant) return;
      await refreshLicenseStatus();
      assertOwner(uid);
      await storeToken(uid, { ...grant, expiresIn: 3600, provider: 'native' }, grant.email);
      return;
    }
    if (!request) throw new Error('Google authorization is loading. Try again.');
    const url = request.url ?? await request.makeAuthUrlAsync(Google.discovery);
    const result = await WebBrowser.openAuthSessionAsync(url, request.redirectUri);
    if (result.type !== 'success') return;
    const response = request.parseReturnUrl(result.url);
    if (response.type !== 'success' || !response.authentication?.accessToken) throw new Error('Google authorization was rejected or its security state did not match. Please try again.');
    await refreshLicenseStatus();
    assertOwner(uid);
    const tokens = response.authentication;
    const details = await fetchWithTimeout('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    if (!details.ok) throw new Error('Could not identify the Google account. Reconnect Google Drive.');
    const info = await details.json() as { email?: string; sub?: string };
    if (!info.sub) throw new Error('Google did not identify the authorized account. Reconnect Google Drive.');
    await storeToken(uid, { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn ?? 3600, scope: tokens.scope, accountId: info.sub, provider: 'web' }, info.email ?? 'Connected Google account');
  }, false); // Open the browser in the user's gesture; perform online checks before exchanging tokens.
}
async function accessToken(uid: string, forceRefresh = false) {
  assertOwner(uid);
  if (!token) throw new Error('Connect Google Drive first.');
  if (forceRefresh || token.expiresAt <= Date.now() + 60_000) {
    if (token.provider !== 'native') throw new Error('Google access has expired. Reconnect Google Drive in this browser.');
    const result = await renewNativeDrive(token.accountId, token.accessToken);
    await storeToken(uid, { ...result, expiresIn: 3600, provider: 'native' }, result.email);
  }
  return token!.accessToken;
}
async function driveFetch(uid: string, url: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const access = await accessToken(uid, retried);
  const response = await fetchWithTimeout(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${access}` } }, 45_000);
  assertOwner(uid);
  if (response.status === 401 && !retried) return driveFetch(uid, url, init, true);
  if (!response.ok) throw new Error(response.status === 403 ? 'Google Drive denied access. Check Drive permissions, storage space, and whether the Drive API is enabled.' : `Google Drive request failed (${response.status}). Try again when online.`);
  return response;
}
async function latestFile(uid: string): Promise<{ id: string; modifiedTime: string } | null> {
  const query = new URLSearchParams({
    q: `trashed = false and name = '${FILE_NAME}' and appProperties has { key='tsaUid' and value='${uid.replace(/['\\]/g, '')}' }`,
    fields: 'files(id,modifiedTime)', orderBy: 'modifiedTime desc', pageSize: '1', spaces: 'drive',
  });
  const result = await (await driveFetch(uid, `${API}?${query}`)).json() as { files: { id: string; modifiedTime: string }[] };
  return result.files[0] ?? null;
}
export async function uploadBackupToGoogleDrive(): Promise<void> {
  await withOperation(async (uid) => {
    const existing = await latestFile(uid);
    const backup = await exportDatabaseToJson();
    if (existing && backup.customers.length + backup.loans.length + backup.payments.length + backup.expenses.length === 0) {
      throw new Error('This phone has no finance records. Restore your existing Drive backup before syncing, to protect the saved backup.');
    }
    assertOwner(uid);
    const metadata = existing ? {} : { name: FILE_NAME, mimeType: 'application/json', appProperties: { tsaUid: uid } };
    const target = `https://www.googleapis.com/upload/drive/v3/files${existing ? `/${encodeURIComponent(existing.id)}` : ''}?uploadType=resumable`;
    const started = await driveFetch(uid, target, { method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/json' }, body: JSON.stringify(metadata) });
    const location = started.headers.get('Location');
    if (!location || !location.startsWith('https://www.googleapis.com/')) throw new Error('Drive did not return a valid upload URL.');
    await driveFetch(uid, location, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) });
    publish({ lastSyncedAt: new Date().toISOString(), error: null });
    await savePreferences(uid);
  });
}
export interface DriveRestorePreview { json: string; summary: BackupSummary; modifiedTime: string; uid: string }
// Download and validate first. Settings must show the counts before calling restore.
export async function previewBackupFromGoogleDrive(): Promise<DriveRestorePreview> {
  return withOperation(async (uid) => {
    const file = await latestFile(uid);
    if (!file) throw new Error('No cloud backup was found for this Finance Tracker account in this Google Drive.');
    const json = await (await driveFetch(uid, `${API}/${encodeURIComponent(file.id)}?alt=media`)).text();
    return { json, summary: inspectBackup(json), modifiedTime: file.modifiedTime, uid };
  });
}
export async function restoreBackupFromGoogleDrive(preview: DriveRestorePreview): Promise<TableCounts> {
  return withOperation(async (uid) => {
    if (preview.uid !== uid) throw new Error('The account changed. Preview the backup again.');
    assertOwner(uid);
    return importDatabaseFromJson(preview.json);
  });
}
export async function setDriveAutoSync(enabled: boolean) {
  const uid = currentUid();
  assertOwner(uid);
  publish({ autoSync: enabled });
  await savePreferences(uid);
  if (enabled) scheduleAutoSync();
}
export async function disconnectGoogleDrive() {
  if (operation) throw new Error('Wait for the cloud operation to finish.');
  const uid = currentUid();
  assertOwner(uid);
  // Remove local credentials first so disconnect works offline too.
  const previous = token;
  await secureStorage.set(storageKey(uid, 'token'), null);
  token = null;
  publish({ connected: false, email: null, autoSync: false, error: null });
  await savePreferences(uid);
  if (previous?.provider === 'native') await disconnectNativeDrive(previous.accountId);
  if (previous?.accessToken) void fetchWithTimeout('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: previous.accessToken }).toString() }, 10_000).catch(() => {});
}
// Runs quietly while the app is open. Failed uploads keep the previous backup intact;
// a pending collection or a later Settings visit/foreground event retries it.
export function scheduleAutoSync() {
  if (!state.autoSync || !state.connected) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (operation) { scheduleAutoSync(); return; }
    void uploadBackupToGoogleDrive().catch(() => {});
  }, 2500);
}

export const driveOAuthRedirectUri = () => makeRedirectUri({ path: 'google-drive' });
