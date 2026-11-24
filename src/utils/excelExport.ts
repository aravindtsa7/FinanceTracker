import { File, Paths } from 'expo-file-system';
import { EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { exportDatabaseToJson } from '@/db/database';
import { todayStr } from '@/utils/date';

export const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const canSaveExcelToFolder = Platform.OS === 'android';
export const excelFileName = (date = todayStr()) => `FinanceTracker_Export_${date}.xlsx`;

async function buildExport() {
  // Load the spreadsheet engine only when exporting; keep regular navigation light.
  const { excelWorkbookBase64 } = await import('@/utils/excelWorkbook');
  const data = await exportDatabaseToJson();
  return { fileName: excelFileName(), base64: excelWorkbookBase64(data) };
}

export async function shareExcel(): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  const { fileName, base64 } = await buildExport();
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(base64, { encoding: 'base64' });
  await Sharing.shareAsync(file.uri, {
    mimeType: EXCEL_MIME,
    UTI: 'org.openxmlformats.spreadsheetml.sheet',
    dialogTitle: 'Share FinanceTracker Excel export',
  });
}

/**
 * Android: lets the admin choose a folder (Storage Access Framework) and writes the Excel export there.
 * Falls back cleanly to expo-sharing if folder access/writing fails.
 */
export async function saveExcelToFolder(): Promise<{ fileName: string; fallbackShared?: boolean } | null> {
  if (!canSaveExcelToFolder) throw new Error('Saving to a device folder is only supported on Android');
  let permissions;
  try {
    permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const message = error instanceof Error ? error.message : String(error);
    if ((typeof code === 'string' && /cancel/i.test(code)) || /cancel/i.test(message)) return null;
    await shareExcel();
    return { fileName: excelFileName(), fallbackShared: true };
  }
  if (!permissions.granted) return null;

  try {
    const { fileName, base64 } = await buildExport();
    const fileUri = await StorageAccessFramework.createFileAsync(permissions.directoryUri, fileName, EXCEL_MIME);
    await StorageAccessFramework.writeAsStringAsync(fileUri, base64, { encoding: EncodingType.Base64 });
    return { fileName };
  } catch {
    await shareExcel();
    return { fileName: excelFileName(), fallbackShared: true };
  }
}
