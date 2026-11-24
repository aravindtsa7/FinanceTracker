import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/AppText';
import { NavigationTitle } from '@/components/NavigationTitle';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { initDatabase } from '@/db/database';
import { useAuthLicense } from '@/hooks/useAuthLicense';
import { initializeAuthLicense, recordLocalTime, refreshLicenseStatus, watchDeviceBinding } from '@/services/authLicenseService';
import { initializeDrive, scheduleAutoSync } from '@/services/googleDriveBackup';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const session = useAuthLicense();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(() => {
    Promise.all([initDatabase(), initializeAuthLicense()])
      .then(() => {
        setError(null);
        setReady(true);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => SplashScreen.hideAsync());
  }, []);

  useEffect(init, [init]);

  const uid = session.profile?.uid ?? null;
  useEffect(() => { if (ready) void initializeDrive(uid).then(scheduleAutoSync); }, [uid, ready]);
  useEffect(() => watchDeviceBinding(), [uid, session.phase]);
  useEffect(() => {
    const check = () => {
      void recordLocalTime().catch(() => {});
      void refreshLicenseStatus().catch(() => {});
      scheduleAutoSync();
    };
    const appState = AppState.addEventListener('change', (value) => {
      if (value === 'active') check();
      else void recordLocalTime().catch(() => {});
    });
    const clockTimer = setInterval(() => { if (AppState.currentState === 'active') void recordLocalTime().catch(() => {}); }, 30_000);
    const syncTimer = setInterval(() => { if (AppState.currentState === 'active') check(); }, 5 * 60_000);
    return () => { appState.remove(); clearInterval(clockTimer); clearInterval(syncTimer); };
  }, []);

  if (error) {
    return (
      <View style={styles.errorScreen}>
        <StatusBar style="light" />
        <Ionicons name="warning" size={48} color={Colors.warning} />
        <Text style={styles.errorTitle}>Could not initialize the app</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retry} onPress={init}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!ready || !session.ready) return null;
  const authenticated = session.phase === 'session' && (session.status === 'active' || session.status === 'trial');
  const locked = session.phase === 'check-required' || (session.phase === 'session' && !authenticated);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.navy },
          headerTintColor: Colors.textOnDark,
          headerTitle: NavigationTitle,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: Colors.background },
        }}>
        <Stack.Protected guard={session.phase === 'signed-out'}>
          <Stack.Screen name="auth/login" options={{ headerShown: false }} />
          <Stack.Screen name="auth/register" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={session.phase === 'transfer'}>
          <Stack.Screen name="auth/device-transfer" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={locked}>
          <Stack.Screen name="license-lock" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={authenticated}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="google-drive" options={{ headerShown: false }} />
          {/* Titles are refined in-screen via <Stack.Title> (customer name, Add vs Edit). */}
          <Stack.Screen name="customer/[id]" options={{ title: 'Customer' }} />
          <Stack.Screen name="customer/form" options={{ title: 'Customer' }} />
          <Stack.Screen name="loan/new" options={{ title: 'New Loan' }} />
          <Stack.Screen name="loan/edit" options={{ title: 'Edit Loan' }} />
          <Stack.Screen name="loan/[id]" options={{ title: 'Loan Details' }} />
          <Stack.Screen name="reports" options={{ title: 'Financial Reports' }} />
          <Stack.Screen name="expenses" options={{ title: 'Expenses Tracker' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  errorScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
    backgroundColor: Colors.navy,
  },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.textOnDark },
  errorText: { fontSize: 14, color: Colors.tabInactive, textAlign: 'center' },
  retry: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.emerald,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
  },
  retryText: { color: Colors.textOnDark, fontWeight: '700' },
});
