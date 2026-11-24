import { useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { Colors, Spacing } from '@/constants/theme';
import { canSaveExcelToFolder, saveExcelToFolder, shareExcel } from '@/utils/excelExport';

export function ExcelExportButtons({ disabled = false, onBusyChange }: {
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState<'share' | 'folder' | null>(null);
  const running = useRef(false);
  const run = async (action: 'share' | 'folder') => {
    if (running.current || disabled) return;
    running.current = true;
    setBusy(action);
    onBusyChange?.(true);
    try {
      if (action === 'share') await shareExcel();
      else {
        const saved = await saveExcelToFolder();
        if (saved) {
          if (saved.fallbackShared) {
            Alert.alert('Excel export shared', 'Could not save directly to folder. The export was opened in the share sheet instead.');
          } else {
            Alert.alert('Excel export saved', saved.fileName);
          }
        }
      }
    } catch (error) {
      Alert.alert('Could not save to folder', `${error instanceof Error ? error.message : String(error)}\n\nShare the Excel export instead?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Share', onPress: () => void run('share') },
      ]);
    } finally {
      running.current = false;
      setBusy(null);
      onBusyChange?.(false);
    }
  };
  return (
    <View style={styles.container}>
      <Text style={styles.note}>Full app data, all time: Summary, Customers, Loans, Payments and Expenses. Date filters do not limit this export.</Text>
      <AppButton label="Export & Share Excel (.xlsx)" icon="share-social" loading={busy === 'share'}
        disabled={disabled || busy !== null} onPress={() => void run('share')} />
      {canSaveExcelToFolder && (
        <AppButton label="Save Excel to Device Folder" icon="folder-open-outline" variant="outline"
          loading={busy === 'folder'} disabled={disabled || busy !== null} onPress={() => void run('folder')} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  note: { fontSize: 13, lineHeight: 19, color: Colors.textMuted },
});
