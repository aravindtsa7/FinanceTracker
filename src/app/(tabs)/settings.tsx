import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AccountCloudCards } from '@/components/AccountCloudCards';
import { AppText as Text } from '@/components/AppText';
import { ExcelExportButtons } from '@/components/ExcelExportButtons';
import { ErrorBanner, SectionTitle } from '@/components/ScreenState';
import { MetricStrip } from '@/components/MetricStrip';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { clearAllData, getFinanceReport, getTableCounts, importDatabaseFromJson } from '@/db/database';
import { seedDemoData } from '@/db/devSeed';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import type { TableCounts } from '@/types/finance';
import { canSaveToFolder, pickBackupFile, saveBackupToFolder, shareBackup } from '@/utils/backup';
import { formatCurrency, formatDateTime } from '@/utils/format';

type BusyAction = 'share' | 'save' | 'import' | 'seed' | 'clear';

const describeCounts = (c: TableCounts) =>
  `${c.customers} customer${c.customers === 1 ? '' : 's'}, ${c.loans} loan${c.loans === 1 ? '' : 's'}, ${c.payments} payment${c.payments === 1 ? '' : 's'} and ${c.expenses} expense${c.expenses === 1 ? '' : 's'}`;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function loadHub() {
  const [counts, report] = await Promise.all([getTableCounts(), getFinanceReport()]);
  return { counts, report };
}

export default function ProfileScreen() {
  const { pagePadding } = useResponsiveLayout();
  const { data, error, loading, reload } = useDbQuery(loadHub);
  const counts = data?.counts;
  const report = data?.report;
  const [excelBusy, setExcelBusy] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const running = useRef(false);
  const blocked = busy !== null || excelBusy || cloudBusy;
  const isEmpty = !!counts && counts.customers + counts.loans + counts.payments + counts.expenses === 0;

  /** Runs one action at a time, reporting failures and refreshing counts afterwards. */
  const run = async (action: BusyAction, task: () => Promise<void>, failTitle: string) => {
    if (blocked || running.current) return;
    running.current = true;
    setBusy(action);
    try {
      await task();
    } catch (e) {
      Alert.alert(failTitle, errorMessage(e));
    } finally {
      running.current = false;
      setBusy(null);
      void reload();
    }
  };

  const exportAndShare = () =>
    run(
      'share',
      async () => {
        await shareBackup();
      },
      'Export failed'
    );

  const saveToFolder = () =>
    run(
      'save',
      async () => {
        try {
          const saved = await saveBackupToFolder();
          if (saved) {
            if (saved.fallbackShared) {
              Alert.alert('Backup shared', `Could not save directly to folder. The backup was opened in the share sheet instead.\n\nContains ${describeCounts(saved.counts)}.`);
            } else {
              Alert.alert('Backup saved', `${saved.fileName}\n\nContains ${describeCounts(saved.counts)}.`);
            }
          }
        } catch (e) {
          // Some devices/folders refuse SAF writes — offer the share sheet instead of a dead end.
          Alert.alert('Could not save to that folder', `${errorMessage(e)}\n\nShare the backup instead?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Share', onPress: () => void exportAndShare() },
          ]);
        }
      },
      'Save failed'
    );

  const importBackup = () =>
    run(
      'import',
      async () => {
        const picked = await pickBackupFile(); // validates fully before anything is written
        if (!picked) return;
        const { summary } = picked;
        const when = summary.exportedAt ? formatDateTime(summary.exportedAt) : 'an unknown date';
        const current = counts && !isEmpty ? `\n\nCurrent data on this device (${describeCounts(counts)}) will be permanently replaced.` : '';
        Alert.alert(
          `Restore backup from ${when}?`,
          `“${picked.fileName}” contains ${describeCounts(summary.counts)}.\n\nThis will replace all current data on this device.${current}`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Restore',
              style: 'destructive',
              onPress: () =>
                void run(
                  'import',
                  async () => {
                    const restored = await importDatabaseFromJson(picked.json);
                    Alert.alert('Restore complete', `Restored ${describeCounts(restored)}.`);
                  },
                  'Restore failed'
                ),
            },
          ]
        );
      },
      'Cannot use this file'
    );

  const seed = () =>
    Alert.alert('Add demo data?', 'Adds 3 sample customers with 5 loans and some payments, for trying out the app.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Add Demo Data',
        onPress: () => void run('seed', seedDemoData, 'Seeding failed'),
      },
    ]);

  const clearAll = () => {
    if (!counts || isEmpty) {
      Alert.alert('Nothing to clear', 'There is no data on this device.');
      return;
    }
    const finalConfirm = () =>
      Alert.alert(
        'Delete everything?',
        `This permanently erases ${describeCounts(counts)}. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete Everything',
            style: 'destructive',
            onPress: () =>
              void run(
                'clear',
                async () => {
                  await clearAllData();
                  Alert.alert('All data cleared', 'The app is now empty and ready for a fresh start.');
                },
                'Clear failed'
              ),
          },
        ]
      );
    Alert.alert(
      'Clear all data?',
      'Every customer, loan, payment and expense on this device will be deleted. Export a backup first if you might need this data.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Export First', onPress: () => void exportAndShare() },
        { text: 'Continue', style: 'destructive', onPress: finalConfirm },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingHorizontal: pagePadding }]}
      refreshControl={<RefreshControl refreshing={loading && !!counts} onRefresh={reload} />}>
      <ErrorBanner error={error} />

      <AccountCloudCards disabled={busy !== null || excelBusy} onBusyChange={setCloudBusy} onRestored={() => void reload()}>
        <View style={styles.snapshot}>
          <SectionTitle>Device Data Snapshot</SectionTitle>
          <MetricStrip items={[
            { label: 'Customers', value: counts?.customers ?? '—' },
            { label: 'Loans', value: counts?.loans ?? '—' },
            { label: 'Payments', value: counts?.payments ?? '—', color: Colors.emeraldDark },
          ]} />
          <Text style={styles.note}>Records are stored on this device. Keep a backup before uninstalling or clearing app storage.</Text>
        </View>
      </AccountCloudCards>

      <Section
        icon="document-text-outline"
        title="Export & Excel Reports"
        body="Share a full JSON backup, save it to a folder, or export an Excel workbook for reviewing your records.">
        <AppButton
          label="Share JSON Backup"
          icon="share-social"
          loading={busy === 'share'}
          disabled={blocked}
          onPress={exportAndShare}
        />
        {canSaveToFolder && (
          <AppButton
            label="Save Backup to Folder"
            icon="folder-open-outline"
            variant="outline"
            loading={busy === 'save'}
            disabled={blocked}
            onPress={saveToFolder}
          />
        )}
        <View style={styles.divider} />
        <ExcelExportButtons disabled={busy !== null || cloudBusy} onBusyChange={setExcelBusy} />
      </Section>

      <Section
        icon="cloud-download-outline"
        title="Restore from Backup"
        body="Pick a FinanceTracker .json backup. It is checked first, and you’ll see its date and contents before anything changes. Restoring replaces all data on this device.">
        <AppButton
          label="Import Backup File"
          icon="document-attach-outline"
          variant="secondary"
          loading={busy === 'import'}
          disabled={blocked}
          onPress={importBackup}
        />
      </Section>

      <SectionTitle>Business Overview</SectionTitle>
      <Section icon="bar-chart-outline" title="Financial Reports" body="Track collections, expenses, earnings and cash flow across all time.">
        <PreviewMetric label="Total disbursed" value={report ? formatCurrency(report.totalDisbursedAmount) : '…'} />
        <PreviewMetric label="Interest collected" value={report ? formatCurrency(report.totalInterestCollected) : '…'} />
        <PreviewMetric label="Document charges" value={report ? formatCurrency(report.totalDocumentCharges) : '…'} />
        <AppButton label="View Financial Reports" icon="bar-chart-outline" variant="secondary" onPress={() => router.push('/reports')} />
      </Section>
      <Section icon="receipt-outline" title="Expenses Tracker" body="Record and manage your business spending.">
        <PreviewMetric label="Total expenses" value={report ? formatCurrency(report.totalExpenses) : '…'} />
        <AppButton label="View Expenses" icon="receipt-outline" variant="secondary" onPress={() => router.push('/expenses')} />
        <AppButton label="Add Expense" icon="add-circle-outline" onPress={() => router.push({ pathname: '/expenses', params: { add: '1' } })} />
      </Section>

      <Section
        icon="construct-outline"
        title="Manage Data"
        subtle
        body={
          __DEV__
            ? 'Add sample data to try the app, then clear everything before real use.'
            : 'Permanently erase every customer, loan, payment and expense on this device.'
        }>
        {/* Demo data is a development aid only; release builds (e.g. the EAS APK) never show it. */}
        {__DEV__ && (
          <AppButton
            label="Seed Demo Data"
            icon="flask-outline"
            variant="outline"
            loading={busy === 'seed'}
            disabled={blocked}
            onPress={seed}
          />
        )}
        <AppButton
          label="Clear All Data"
          icon="trash-outline"
          variant="danger"
          loading={busy === 'clear'}
          disabled={blocked}
          onPress={clearAll}
        />
      </Section>
    </ScrollView>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return <View style={styles.previewRow}><Text style={styles.previewLabel}>{label}</Text><Text style={styles.previewValue}>{value}</Text></View>;
}

function Section({
  icon,
  title,
  body,
  children,
  subtle = false,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  children: ReactNode;
  subtle?: boolean;
}) {
  return (
    <View style={[styles.card, subtle && styles.subtleCard]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>
          <Ionicons name={icon} size={20} color={Colors.navyLight} />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardBody}>{body}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xl * 2 },
  flex1: { flex: 1, minWidth: 0 },
  snapshot: { gap: Spacing.sm },
  divider: { height: 1, backgroundColor: Colors.border },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm, flexWrap: 'wrap' },
  previewLabel: { color: Colors.textMuted, fontSize: 14, flexBasis: '42%', flexGrow: 1 },
  previewValue: { color: Colors.text, fontSize: 16, fontWeight: '800', flexBasis: '48%', flexGrow: 1, textAlign: 'right' },
  note: { fontSize: 12, color: Colors.textMuted, lineHeight: 17 },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  cardHeader: { flexDirection: 'row', gap: Spacing.md },
  subtleCard: { backgroundColor: Colors.navySoft },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: Colors.navySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  cardBody: { fontSize: 13, color: Colors.textMuted, lineHeight: 19, marginTop: 2 },
});
