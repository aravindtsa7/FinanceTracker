import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { exportDatabaseToJson, inspectBackup } from '@/db/database';
import type { BackupSummary, TableCounts } from '@/types/finance';
import { todayStr } from '@/utils/date';

const MIME_JSON = 'application/json';

export const backupFileName = () => `FinanceBackup_${todayStr()}.json`;

async function buildBackup(): Promise<{ json: string; counts: TableCounts }> {
  const backup = await exportDatabaseToJson();
  return {
    json: JSON.stringify(backup, null, 2),
    counts: { customers: backup.customers.length, loans: backup.loans.length, payments: backup.payments.length, expenses: backup.expenses.length },
  };
}

/** Writes the backup into the app cache (overwriting today's file) and opens the system share sheet. */
export async function shareBackup(): Promise<TableCounts> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  const { json, counts } = await buildBackup();
  const file = new File(Paths.cache, backupFileName());
  file.create({ overwrite: true });
  file.write(json);
  await Sharing.shareAsync(file.uri, {
    mimeType: MIME_JSON,
    UTI: 'public.json',
    dialogTitle: 'Share FinanceTracker backup',
  });
  return counts;
}

export const canSaveToFolder = Platform.OS === 'android';

function isPickerCancel(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code === 'ERR_PICKER_CANCELLED' || /cancel/i.test(message);
}

/**
 * Android: lets the admin choose a folder (Storage Access Framework) and writes the backup there.
 * Returns null if the folder picker was cancelled.
 * Falls back cleanly to expo-sharing if folder access/writing fails.
 */
export async function saveBackupToFolder(): Promise<{ fileName: string; counts: TableCounts; fallbackShared?: boolean } | null> {
  if (!canSaveToFolder) throw new Error('Saving to a folder is only supported on Android');
  let permissions;
  try {
    permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  } catch (error) {
    if (isPickerCancel(error)) return null;
    const counts = await shareBackup();
    return { fileName: backupFileName(), counts, fallbackShared: true };
  }
  if (!permissions.granted) return null;

  try {
    const { json, counts } = await buildBackup();
    const fileName = backupFileName();
    const fileUri = await StorageAccessFramework.createFileAsync(permissions.directoryUri, fileName, MIME_JSON);
    await StorageAccessFramework.writeAsStringAsync(fileUri, json, { encoding: EncodingType.UTF8 });
    return { fileName, counts };
  } catch {
    const counts = await shareBackup();
    return { fileName: backupFileName(), counts, fallbackShared: true };
  }
}

export interface PickedBackup {
  fileName: string;
  /** Raw file contents, to pass to `importDatabaseFromJson` after confirmation. */
  json: string;
  summary: BackupSummary;
}

/**
 * Lets the admin pick a backup file, reads it and validates it fully — without touching the database.
 * Returns null if the picker was cancelled; throws with a readable message if the file is not a valid backup.
 */
export async function pickBackupFile(): Promise<PickedBackup | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [MIME_JSON, '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const json = await new File(asset.uri).text();
  return { fileName: asset.name, json, summary: inspectBackup(json) };
}
