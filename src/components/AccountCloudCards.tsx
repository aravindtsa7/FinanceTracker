import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAuthLicense } from '@/hooks/useAuthLicense';
import { useGoogleDrive } from '@/hooks/useGoogleDrive';
import { logoutUser, messageForError, refreshLicenseStatus, resendVerificationEmail } from '@/services/authLicenseService';
import { disconnectGoogleDrive, isDriveConfigured, previewBackupFromGoogleDrive, restoreBackupFromGoogleDrive, scheduleAutoSync, setDriveAutoSync, uploadBackupToGoogleDrive } from '@/services/googleDriveBackup';
import { auth } from '@/config/firebase';
import { shareBackup } from '@/utils/backup';
import type { LicenseStatus } from '@/services/licensePolicy';
import { formatDateTime } from '@/utils/format';

const LICENSE_BADGES: Record<LicenseStatus, { label: string; color: string; background: string }> = {
  active: { label: 'Active Plan', color: Colors.emeraldDark, background: Colors.emeraldSoft },
  trial: { label: '7-Day Trial', color: Colors.warning, background: Colors.warningSoft },
  expired: { label: 'Plan Expired', color: Colors.danger, background: Colors.dangerSoft },
  tampered: { label: 'Device Time Check', color: Colors.danger, background: Colors.dangerSoft },
  'offline-check-required': { label: 'License Check Needed', color: Colors.warning, background: Colors.warningSoft },
};

export function AccountCloudCards({ disabled, onBusyChange, onRestored, children }: {
  disabled: boolean;
  onBusyChange: (value: boolean) => void;
  onRestored: () => void;
  /** Device snapshot, placed between the account hero and cloud actions. */
  children?: ReactNode;
}) {
  const session = useAuthLicense();
  const drive = useGoogleDrive();
  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef(false);
  const blocked = disabled || busy !== null || drive.busy;
  const [notice, setNotice] = useState<{ area: 'account' | 'cloud'; text: string } | null>(null);
  const license = LICENSE_BADGES[session.status];
  useFocusEffect(useCallback(() => { scheduleAutoSync(); }, []));
  const run = async (action: string, task: () => Promise<unknown>) => {
    if (blocked || running.current) return;
    running.current = true;
    setBusy(action); onBusyChange(true); setNotice(null);
    try { await task(); }
    catch (error) { Alert.alert('Account & cloud sync', messageForError(error)); }
    finally { running.current = false; setBusy(null); onBusyChange(false); }
  };
  const logout = () => Alert.alert('Back up before signing out', 'Export a backup or sync to Google Drive first. Signing out keeps the local database on this phone; another account on this phone will see the same local records.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Export Backup', onPress: () => void run('export', shareBackup) },
    { text: 'Sign Out', style: 'destructive', onPress: () => void run('logout', () => logoutUser()) },
  ]);
  const restore = () => void run('restore', async () => {
    const preview = await previewBackupFromGoogleDrive();
    const c = preview.summary.counts;
    const confirmed = await new Promise<boolean>((resolve) => Alert.alert('Replace local data from Google Drive?',
      `Backup: ${formatDateTime(preview.summary.exportedAt ?? preview.modifiedTime)}\n\n${c.customers} customers, ${c.loans} loans, ${c.payments} payments, ${c.expenses} expenses.\n\nAll current local records will be replaced. Export a local backup first if needed.`,
      [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: 'Restore & Replace', style: 'destructive', onPress: () => resolve(true) }],
      { cancelable: true, onDismiss: () => resolve(false) }));
    if (!confirmed) return;
    await restoreBackupFromGoogleDrive(preview);
    onRestored();
    setNotice({ area: 'cloud', text: 'Google Drive backup restored successfully.' });
  });
  return <>
    <View style={styles.hero}>
      <View style={styles.heroHeader}>
        <View style={styles.heroIcon}><Ionicons name="person-outline" size={22} color={Colors.textOnDark} /></View>
        <View style={styles.flex1}>
          <Text style={styles.heroLabel}>Account & License</Text>
          <Text style={styles.heroName}>{session.profile?.name || 'Admin'}</Text>
        </View>
        <AppButton label="Sign Out" icon="log-out-outline" compact variant="secondary"
          disabled={blocked} loading={busy === 'logout'} onPress={logout} />
      </View>
      <Text style={styles.heroLabel}>Admin email</Text>
      <Text selectable style={styles.email}>{session.profile?.email || '—'}</Text>
      <View style={[styles.badge, { backgroundColor: license.background }]}>
        <Ionicons name={session.status === 'active' ? 'shield-checkmark' : 'time-outline'} size={14} color={license.color} />
        <Text style={[styles.badgeText, { color: license.color }]}>
          {license.label}{session.status === 'trial' ? ` · ${session.daysLeft} ${session.daysLeft === 1 ? 'day' : 'days'} left` : ''}
        </Text>
      </View>
      {session.status === 'trial' && session.profile && <Text style={styles.heroNote}>Trial ends {formatDateTime(session.profile.trialEndsAt)}</Text>}
      {session.status === 'active' && session.profile?.subscriptionExpiresAt && <Text style={styles.heroNote}>Valid until {formatDateTime(session.profile.subscriptionExpiresAt)}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={`Copy Device ID ${session.deviceId}`}
        disabled={blocked || !session.deviceId} style={styles.devicePill}
        onPress={() => void run('copy', async () => {
          await Clipboard.setStringAsync(session.deviceId);
          setNotice({ area: 'account', text: 'Device ID copied.' });
        })}>
        <Ionicons name="phone-portrait-outline" size={16} color={Colors.textOnDark} />
        <Text style={styles.device}>Device ID · {session.deviceId || '—'}</Text>
        <Ionicons name="copy-outline" size={16} color={Colors.textOnDark} />
      </Pressable>
      <AppButton label="Refresh License Status" icon="refresh" compact variant="secondary" disabled={blocked} loading={busy === 'license'}
        onPress={() => void run('license', async () => { await refreshLicenseStatus(); setNotice({ area: 'account', text: 'License status checked with the server.' }); })} />
      {auth.currentUser && !auth.currentUser.emailVerified && <AppButton label="Resend Email Verification" compact variant="secondary" disabled={blocked}
        onPress={() => void run('verify-email', async () => { await resendVerificationEmail(); setNotice({ area: 'account', text: 'Verification email sent. Check your inbox.' }); })} />}
      {!!session.error && <Text accessibilityRole="alert" style={styles.heroError}>{session.error}</Text>}
      {notice?.area === 'account' && <Text accessibilityRole="alert" style={styles.heroSuccess}>{notice.text}</Text>}
    </View>
    {children}
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}><Ionicons name="cloud-outline" size={20} color={Colors.emeraldDark} /></View>
        <View style={styles.flex1}>
          <Text style={styles.title}>Google Drive Cloud Sync</Text>
          <Text style={styles.note}>Keep a cloud copy of your records and restore after reviewing its contents.</Text>
        </View>
      </View>
      {!isDriveConfigured() && <Text style={styles.warning}>Google Drive setup is pending. Configure the Google Web and platform OAuth client IDs to connect.</Text>}
      <View style={styles.connectionRow}>
        <Ionicons name={drive.connected ? 'checkmark-circle' : 'cloud-offline-outline'} size={16} color={drive.connected ? Colors.emeraldDark : Colors.textMuted} />
        <Text selectable style={styles.connectionText}>{drive.connected ? drive.email : 'No Google account connected'}</Text>
      </View>
      <AppButton label={drive.connected ? 'Reconnect Google Drive' : 'Connect Google Drive'} icon="logo-google" variant="secondary" disabled={blocked || !drive.requestReady} loading={busy === 'connect'} onPress={() => void run('connect', drive.connect)} />
      <AppButton label="Sync Backup to Drive Now" icon="cloud-upload-outline" disabled={blocked || !drive.connected} loading={busy === 'upload'} onPress={() => void run('upload', async () => { await uploadBackupToGoogleDrive(); setNotice({ area: 'cloud', text: 'Backup synced to Google Drive.' }); })} />
      <AppButton label="Restore from Google Drive" icon="cloud-download-outline" variant="outline" disabled={blocked || !drive.connected} loading={busy === 'restore'} onPress={restore} />
      <View style={styles.toggleRow}><View style={styles.toggleText}><Text style={styles.name}>Auto-Sync</Text><Text style={styles.note}>Quietly upload after collections and when opening Settings or returning to the app. An internet connection is required.</Text></View>
        <Switch accessibilityLabel="Google Drive Auto-Sync" value={drive.autoSync} disabled={blocked || !drive.connected} trackColor={{ true: Colors.emeraldDark }} onValueChange={(value) => void run('toggle', () => setDriveAutoSync(value))} />
      </View>
      <Text style={styles.note}>Last synced: {drive.lastSyncedAt ? formatDateTime(drive.lastSyncedAt) : 'Never'}</Text>
      {!!drive.error && <Text style={styles.error}>{drive.error}</Text>}
      {drive.connected && <AppButton label="Disconnect Google Drive" compact variant="outline" disabled={blocked} onPress={() => Alert.alert('Disconnect Google Drive?', 'Stops auto-sync and removes saved Google credentials from this app. Your backup stays in Drive.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', onPress: () => void run('disconnect', disconnectGoogleDrive) }])} />}
      {notice?.area === 'cloud' && <Text accessibilityRole="alert" style={styles.success}>{notice.text}</Text>}
    </View>
  </>;
}
const styles = StyleSheet.create({
  card: { padding: Spacing.lg, gap: Spacing.md, backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border },
  flex1: { flex: 1, minWidth: 0 },
  hero: { padding: Spacing.lg, gap: Spacing.sm, backgroundColor: Colors.navy, borderRadius: Radius.lg },
  heroHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  heroIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.navyLight },
  heroLabel: { color: '#CBD5E1', fontSize: 12, fontWeight: '600' },
  heroName: { color: Colors.textOnDark, fontSize: 18, fontWeight: '800' },
  email: { color: Colors.textOnDark, fontSize: 16, fontWeight: '600', marginTop: -Spacing.xs },
  heroNote: { color: '#CBD5E1', fontSize: 12, lineHeight: 18 },
  devicePill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, minHeight: 44, borderRadius: Radius.md, backgroundColor: Colors.navyLight },
  device: { flex: 1, minWidth: 0, color: Colors.textOnDark, fontSize: 12, fontWeight: '600' },
  heroError: { backgroundColor: Colors.dangerSoft, color: Colors.danger, padding: Spacing.sm, borderRadius: 8, fontSize: 13 },
  heroSuccess: { backgroundColor: Colors.emeraldSoft, color: Colors.emeraldDark, padding: Spacing.sm, borderRadius: 8, fontSize: 13 },
  cardHeader: { flexDirection: 'row', gap: Spacing.md },
  cardIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.emeraldSoft },
  title: { color: Colors.navy, fontWeight: '700', fontSize: 16 }, name: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  note: { color: Colors.textMuted, fontSize: 12, lineHeight: 18 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.md, alignSelf: 'flex-start', maxWidth: '100%' },
  badgeText: { flexShrink: 1, fontWeight: '700', fontSize: 12 },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  connectionText: { flex: 1, color: Colors.textMuted, fontSize: 13 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.navySoft, padding: Spacing.md, borderRadius: Radius.md }, toggleText: { flex: 1 },
  warning: { color: Colors.warning, lineHeight: 20 }, error: { color: Colors.danger, lineHeight: 20 }, success: { color: Colors.emeraldDark, lineHeight: 20 },
});
