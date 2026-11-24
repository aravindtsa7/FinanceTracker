export type TenureType = 'Daily' | 'Weekly' | 'Monthly';

export type LoanStatus = 'Active' | 'Completed' | 'Overdue';

export type PaymentMode = 'Cash' | 'UPI';

/**
 * - `AddToTotal` (standard): total payable = principal + interest; handed over = principal − charges.
 * - `DeductUpfront` (piditham): total payable = principal; handed over = principal − interest − charges.
 */
export type InterestMode = 'AddToTotal' | 'DeductUpfront';

/** Dates are stored as `YYYY-MM-DD`; `created_at` is a local `YYYY-MM-DD HH:MM:SS` timestamp. */
export interface Customer {
  id: number;
  name: string;
  phone: string;
  alternate_phone: string;
  address: string;
  photo_uri: string;
  kyc_type: string;
  kyc_number: string;
  kyc_doc_uri: string;
  guarantor_name: string;
  guarantor_phone: string;
  notes: string;
  created_at: string;
}

export interface CustomerWithSummary extends Customer {
  active_loans: number;
  total_borrowed: number;
  active_borrowed: number;
  balance_due: number;
}

export interface Expense {
  id: number;
  title: string;
  category: string;
  amount: number;
  expense_date: string;
  payment_mode: PaymentMode;
  notes: string;
  created_at: string;
}

export interface ExpenseInput {
  title: string;
  category: string;
  amount: number;
  expense_date: string;
  payment_mode?: PaymentMode;
  notes?: string;
}

export interface FinanceReport {
  totalDisbursedAmount: number;
  totalPrincipalLoaned: number;
  totalDocumentCharges: number;
  totalInterestExpected: number;
  /** Upfront interest at disbursal; other interest realized proportionally on repayment or at completion. */
  totalInterestCollected: number;
  totalPaymentsCollected: number;
  totalExpenses: number;
  loansCount: number;
  paymentsCount: number;
  expensesCount: number;
}

export interface Loan {
  id: number;
  customer_id: number;
  /** Joined from `customers`. */
  customer_name: string;
  /** Joined from `customers`. */
  customer_phone: string;
  guarantor_name: string;
  guarantor_phone: string;
  loan_amount: number;
  tenure_type: TenureType;
  monthly_type: string | null;
  /** JSON array of document / collateral photo URIs. */
  doc_uris: string;
  /** Number of installments (days / weeks / months depending on `tenure_type`). */
  period: number;
  /** Flat interest percentage applied to `loan_amount` for the whole tenure. */
  interest_rate: number;
  interest_amount: number;
  interest_mode: InterestMode;
  charges: number;
  disbursal_date: string;
  emi_start_date: string | null;
  disbursal_amount: number;
  emi_amount: number;
  total_payable: number;
  paid_amount: number;
  balance_amount: number;
  status: LoanStatus;
  closed_date: string | null;
  total_charges_collected?: number;
  next_due_date?: string | null;
  notes: string;
  created_at: string;
}

export interface Payment {
  id: number;
  loan_id: number;
  customer_id: number;
  /** Joined from `customers`. */
  customer_name: string;
  amount: number;
  charges_amount: number;
  payment_date: string;
  payment_mode: PaymentMode;
  notes: string;
  created_at: string;
}

export interface LoanReminderNote {
  id: number;
  loan_id: number;
  note: string;
  created_at: string;
}

export interface DashboardStats {
  /** Loans that are not yet completed (Active + Overdue). */
  totalActiveLoans: number;
  totalPrincipalOut: number;
  totalBalancePending: number;
  todayTargetCollection: number;
  todayCollectedAmount: number;
  todayChargesCollected: number;
  overdueLoansCount: number;
}

/** A loan with an installment due on the requested day. */
export interface DueLoan extends Loan {
  /** Sum of payments already recorded for this loan on that day. */
  paid_today: number;
  /** Extra charges recorded today; excluded from installment collection targets. */
  charges_today: number;
  /** Expected collection for the day: the EMI, capped at the balance outstanding at the start of the day. */
  due_today: number;
  /** Scheduled installment falling due that day (1-based), or null when it is listed only because it is overdue. */
  installment_number: number | null;
  /** True when the loan is past its final installment date and still has a balance. */
  is_overdue: boolean;
}

// ---------- Inputs ----------

export interface CustomerInput {
  name: string;
  phone: string;
  alternate_phone?: string;
  photo_uri: string;
  kyc_type: string;
  kyc_number: string;
  kyc_doc_uri: string;
  address?: string;
  guarantor_name?: string;
  guarantor_phone?: string;
  notes?: string;
}

export interface LoanInput {
  customer_id: number;
  loan_amount: number;
  tenure_type: TenureType;
  monthly_type?: string | null;
  doc_uris?: string;
  period: number;
  interest_rate: number;
  charges?: number;
  disbursal_date: string;
  emi_start_date?: string | null;
  guarantor_name?: string;
  guarantor_phone?: string;
  closed_date?: string | null;
  notes?: string;
  /** Defaults to `AddToTotal`. */
  interest_mode?: InterestMode;
  /** Initial status; when omitted it is derived (Active, or Overdue if already past maturity). */
  status?: LoanStatus;
  /** Optional overrides; when omitted they are derived by `calculateLoanTerms`. */
  interest_amount?: number;
  disbursal_amount?: number;
  emi_amount?: number;
  total_payable?: number;
}

export type CreateLoanInput = LoanInput;

/** Editing keeps the original borrower and all payment records. */
export type LoanUpdateInput = Omit<LoanInput, 'customer_id'>;

export interface PaymentInput {
  loan_id: number;
  amount: number;
  charges_amount?: number;
  payment_date: string;
  payment_mode: PaymentMode;
  notes?: string;
}

export type CreatePaymentInput = PaymentInput;

// ---------- Raw table rows (used for backup / restore) ----------

export type LoanRow = Omit<Loan, 'customer_name' | 'customer_phone' | 'total_charges_collected' | 'next_due_date'>;
export type PaymentRow = Omit<Payment, 'customer_name'>;

export interface TableCounts {
  customers: number;
  loans: number;
  payments: number;
  expenses: number;
}

/** What a backup file contains, shown before the admin confirms a restore. */
export interface BackupSummary {
  version: number;
  /** ISO timestamp from the file, or null if the file doesn't record one. */
  exportedAt: string | null;
  counts: TableCounts;
}

export interface BackupData {
  app: 'FinanceTracker';
  version: number;
  exported_at: string;
  customers: Customer[];
  loans: LoanRow[];
  payments: PaymentRow[];
  expenses: Expense[];
  loan_reminders?: LoanReminderNote[];
}
