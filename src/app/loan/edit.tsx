import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyState } from '@/components/EmptyState';
import { LoanForm } from '@/components/LoanForm';
import { ErrorBanner } from '@/components/ScreenState';
import { Colors, Spacing } from '@/constants/theme';
import { getCustomerById, getLoanById } from '@/db/database';
import { useDbQuery } from '@/hooks/useDbQuery';

async function loadLoan(id: number) {
  const loan = await getLoanById(id);
  const customer = loan ? await getCustomerById(loan.customer_id) : null;
  return { loan, customer };
}

export default function EditLoanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, reload } = useDbQuery(loadLoan, Number(id));
  if (data?.loan && data.customer) {
    return <LoanForm key={data.loan.id} initialLoan={data.loan} initialCustomer={data.customer} />;
  }
  return (
    <View style={styles.center}>
      <Stack.Title>Edit Loan</Stack.Title>
      {error ? (
        <>
          <ErrorBanner error={error} />
          <AppButton label="Retry" onPress={reload} />
        </>
      ) : !data ? (
        <ActivityIndicator size="large" color={Colors.emerald} />
      ) : (
        <EmptyState
          icon="alert-circle-outline"
          title="Loan not found"
          message="This loan or its customer may have been deleted."
          action={<AppButton label="Go back" variant="secondary" onPress={() => router.back()} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.md, backgroundColor: Colors.background },
});
