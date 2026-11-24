import { addCustomer, addLoan, addPayment } from '@/db/database';
import { addDays, addMonths, todayStr } from '@/utils/date';

/**
 * Development-only sample data covering each tenure type, a loan due today and an overdue loan.
 * Only wired to a button when `__DEV__` is true.
 */
export async function seedDemoData(): Promise<void> {
  const today = todayStr();
  const emptyKyc = { photo_uri: '', kyc_type: '', kyc_number: '', kyc_doc_uri: '' };

  const ravi = await addCustomer({ ...emptyKyc, name: 'Ravi Kumar', phone: '9876543210', address: 'Gandhi Nagar' });
  const meena = await addCustomer({
    ...emptyKyc,
    name: 'Meena S',
    phone: '9123456780',
  });
  const arjun = await addCustomer({ ...emptyKyc, name: 'Arjun P', phone: '9988776655', notes: 'Shop owner' });

  // Daily: 10,000 @ 20% over 100 days, started 10 days ago, 8 collections so far.
  const daily = await addLoan({
    customer_id: ravi,
    loan_amount: 10000,
    tenure_type: 'Daily',
    period: 100,
    interest_rate: 20,
    charges: 200,
    disbursal_date: addDays(today, -10),
  });
  for (let d = 1; d <= 8; d++) {
    await addPayment({ loan_id: daily, amount: 120, payment_date: addDays(today, -10 + d), payment_mode: 'Cash' });
  }

  // Weekly: due today (exactly 3 weeks after disbursal).
  const weekly = await addLoan({
    customer_id: meena,
    loan_amount: 20000,
    tenure_type: 'Weekly',
    period: 12,
    interest_rate: 15,
    guarantor_name: 'Suresh',
    guarantor_phone: '9000000001',
    disbursal_date: addDays(today, -21),
  });
  await addPayment({ loan_id: weekly, amount: 1917, payment_date: addDays(today, -14), payment_mode: 'UPI' });
  await addPayment({ loan_id: weekly, amount: 1917, payment_date: addDays(today, -7), payment_mode: 'UPI' });

  // Monthly: due today (exactly 1 month after disbursal).
  await addLoan({
    customer_id: arjun,
    loan_amount: 50000,
    tenure_type: 'Monthly',
    period: 10,
    interest_rate: 24,
    disbursal_date: addMonths(today, -1),
  });

  // Deduct upfront (piditham): 5,000 @ 10% → hand over 4,500, collect 5,000 over 50 days.
  await addLoan({
    customer_id: ravi,
    loan_amount: 5000,
    tenure_type: 'Daily',
    period: 50,
    interest_rate: 10,
    interest_mode: 'DeductUpfront',
    disbursal_date: addDays(today, -3),
  });

  // Overdue: 30-day daily loan that ended 5 days ago, partly repaid.
  const overdue = await addLoan({
    customer_id: arjun,
    loan_amount: 3000,
    tenure_type: 'Daily',
    period: 30,
    interest_rate: 10,
    disbursal_date: addDays(today, -35),
  });
  await addPayment({ loan_id: overdue, amount: 2000, payment_date: addDays(today, -6), payment_mode: 'Cash' });
}
