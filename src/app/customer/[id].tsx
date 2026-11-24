import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { CustomerAvatar } from '@/components/CustomerAvatar';
import { PhotoPreview } from '@/components/PhotoPreview';
import { PhotoGallery } from '@/components/PhotoGallery';
import { EmptyState } from '@/components/EmptyState';
import { LoanCard } from '@/components/LoanCard';
import { ErrorBanner, SectionTitle } from '@/components/ScreenState';
import { SummaryStrip } from '@/components/SummaryStrip';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { deleteCustomer, getCustomerById, getLoansByCustomer } from '@/db/database';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import type { Customer, Loan } from '@/types/finance';
import { formatCurrency, formatDate } from '@/utils/format';
import { roundMoney } from '@/utils/loanCalculations';
import { parseUriList } from '@/utils/photoUris';
import { callNumber } from '@/utils/phone';

async function loadCustomer(id: number) {
  const [customer, loans] = await Promise.all([getCustomerById(id), getLoansByCustomer(id)]);
  return { customer, loans };
}

function summarize(loans: Loan[]) {
  const open = loans.filter((l) => l.status !== 'Completed');
  return {
    openCount: open.length,
    overdueCount: open.filter((l) => l.status === 'Overdue').length,
    principal: roundMoney(loans.reduce((sum, l) => sum + l.loan_amount, 0)),
    activePrincipal: roundMoney(open.reduce((sum, l) => sum + l.loan_amount, 0)),
    balance: roundMoney(loans.reduce((sum, l) => sum + l.balance_amount, 0)),
  };
}

export default function CustomerDetailScreen() {
  const { pagePadding } = useResponsiveLayout();
  const { id } = useLocalSearchParams<{ id: string }>();
  const customerId = Number(id);
  const { data, error, loading, reload } = useDbQuery(loadCustomer, customerId);
  const [deleting, setDeleting] = useState(false);

  if (!data) {
    return (
      <View style={styles.center}>
        <Stack.Title>Customer</Stack.Title>
        {error ? <ErrorBanner error={error} /> : <ActivityIndicator size="large" color={Colors.emerald} />}
      </View>
    );
  }

  const { customer, loans } = data;
  if (!customer) {
    return (
      <View style={styles.center}>
        <Stack.Title>Customer</Stack.Title>
        <EmptyState
          icon="person-remove-outline"
          title="Customer not found"
          message="This customer may have been deleted."
          action={<AppButton label="Go back" variant="secondary" onPress={() => router.back()} />}
        />
      </View>
    );
  }

  const stats = summarize(loans);

  const confirmDelete = () => {
    const loanText =
      loans.length === 0
        ? 'all of their loans and payment records'
        : `all ${loans.length} of their loan${loans.length === 1 ? '' : 's'} and every payment record`;
    Alert.alert(
      `Delete ${customer.name}?`,
      `This will permanently delete ${customer.name} along with ${loanText}. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteCustomer(customer.id);
              router.back();
            } catch (e) {
              setDeleting(false);
              Alert.alert('Could not delete customer', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ]
    );
  };

  const newLoan = () =>
    router.push({ pathname: '/loan/new', params: { customerId: String(customer.id) } });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingHorizontal: pagePadding }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}>
      <Stack.Title>{customer.name}</Stack.Title>
      <ErrorBanner error={error} />

      <ProfileCard customer={customer} />

      <View style={styles.actions}>
        <AppButton
          label="Call"
          icon="call"
          compact
          style={styles.action}
          disabled={!customer.phone}
          onPress={() => callNumber(customer.phone)}
        />
        <AppButton
          label="Call Alternate"
          icon="call"
          compact
          style={styles.action}
          disabled={!customer.alternate_phone}
          onPress={() => callNumber(customer.alternate_phone)}
        />
        <AppButton
          label="Edit"
          icon="create-outline"
          variant="secondary"
          compact
          style={styles.action}
          onPress={() => router.push({ pathname: '/customer/form', params: { id: String(customer.id) } })}
        />
        <AppButton
          label="Delete"
          icon="trash-outline"
          variant="danger"
          compact
          loading={deleting}
          style={styles.action}
          onPress={confirmDelete}
        />
      </View>

      <SectionTitle>Loan Summary</SectionTitle>
      <SummaryStrip
        items={[
          { label: stats.overdueCount ? `Active loans (${stats.overdueCount} overdue)` : 'Active loans', value: stats.openCount },
          { label: 'Total borrowed', value: formatCurrency(stats.principal) },
          { label: 'Active borrowed', value: formatCurrency(stats.activePrincipal) },
          { label: 'Balance due', value: formatCurrency(stats.balance), color: Colors.emerald },
        ]}
      />

      <View style={styles.loansHeader}>
        <SectionTitle>{`Loans (${loans.length})`}</SectionTitle>
        <AppButton label="New Loan" icon="add-circle" compact onPress={newLoan} />
      </View>

      {loans.length === 0 ? (
        <EmptyState
          icon="cash-outline"
          title="No loans yet"
          message={`Issue a loan to ${customer.name} to start tracking collections.`}
          action={<AppButton label="New Loan" icon="add-circle" onPress={newLoan} />}
        />
      ) : (
        loans.map((loan) => (
          <LoanCard
            key={loan.id}
            loan={loan}
            onPress={() => router.push({ pathname: '/loan/[id]', params: { id: String(loan.id) } })}
          />
        ))
      )}
    </ScrollView>
  );
}

function InfoRow({ icon, label, value }: { icon: ComponentProps<typeof Ionicons>['name']; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={Colors.navyLight} style={styles.infoIcon} />
      <View style={styles.infoText}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function ProfileCard({ customer }: { customer: Customer }) {
  const [preview, setPreview] = useState<string | null>(null);
  const kycPhotos = parseUriList(customer.kyc_doc_uri);
  return (
    <View style={styles.card}>
      <View style={styles.profileHeader}>
        <Pressable disabled={!customer.photo_uri} accessibilityRole="button" accessibilityLabel="View customer photo"
          onPress={() => setPreview(customer.photo_uri)}>
          <CustomerAvatar name={customer.name} uri={customer.photo_uri} size={72} />
        </Pressable>
        <View style={styles.infoText}>
          <Text style={styles.name}>{customer.name}</Text>
          <Text style={styles.since}>Customer since {formatDate(customer.created_at)}</Text>
        </View>
      </View>
      <InfoRow icon="call-outline" label="Phone" value={customer.phone || '—'} />
      {!!customer.alternate_phone && <InfoRow icon="call-outline" label="Alternate Contact Number" value={customer.alternate_phone} />}
      {!!customer.address && <InfoRow icon="location-outline" label="Address" value={customer.address} />}
      {!!customer.kyc_type && <InfoRow icon="card-outline" label="KYC ID Type" value={customer.kyc_type} />}
      {!!customer.kyc_number && <InfoRow icon="id-card-outline" label="KYC ID Number" value={customer.kyc_number} />}
      {kycPhotos.length > 0 && (
        <View>
          <Text style={styles.infoLabel}>KYC Document Photos · Tap to view</Text>
          <PhotoGallery label="KYC Document Photos" uris={kycPhotos} />
        </View>
      )}
      {!!customer.notes && <InfoRow icon="document-text-outline" label="Notes / ID proof" value={customer.notes} />}
      <PhotoPreview uri={preview} title="Customer photo" onClose={() => setPreview(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.background,
  },
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xl * 2 },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  name: { fontSize: 20, fontWeight: '800', color: Colors.text },
  since: { fontSize: 13, color: Colors.textMuted },
  infoRow: { flexDirection: 'row', gap: Spacing.md },
  infoIcon: { marginTop: 2 },
  infoText: { flex: 1, minWidth: 0 },
  infoLabel: { fontSize: 12, color: Colors.textMuted },
  infoValue: { fontSize: 15, color: Colors.text, lineHeight: 21 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  action: { flexBasis: '47%', flexGrow: 1, minWidth: 0 },
  loansHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
});
