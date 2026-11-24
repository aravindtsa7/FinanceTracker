import { useLocalSearchParams } from 'expo-router';

import { LoanForm } from '@/components/LoanForm';

export default function NewLoanScreen() {
  const { customerId } = useLocalSearchParams<{ customerId?: string }>();
  return <LoanForm customerId={customerId ? Number(customerId) : undefined} />;
}
