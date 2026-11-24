import type { InterestMode, Loan, Payment, TenureType } from '@/types/finance';
import { addDays, addMonths, diffDays, diffMonths, todayStr } from '@/utils/date';

/** Rounds to 2 decimal places to keep currency values free of float drift. */
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Flat interest for the whole tenure: principal × rate%. */
export const interestFromRate = (loanAmount: number, rate: number) => roundMoney((loanAmount * rate) / 100);

/** Inverse of `interestFromRate`, kept to 4 decimals so typed ₹ values survive the round trip. */
export const rateFromInterest = (loanAmount: number, interest: number) =>
  loanAmount > 0 ? Math.round((interest / loanAmount) * 100 * 10_000) / 10_000 : 0;

export interface LoanTerms {
  total_payable: number;
  disbursal_amount: number;
  emi_amount: number;
}

/**
 * - AddToTotal:    total = principal + interest, handed over = principal − charges
 * - DeductUpfront: total = principal,            handed over = principal − interest − charges
 * EMI = total ÷ installments, rounded up to the rupee (the final installment may be smaller).
 */
export function calculateLoanTerms(
  loanAmount: number,
  interestAmount: number,
  period: number,
  charges = 0,
  mode: InterestMode = 'AddToTotal'
): LoanTerms {
  const total_payable = roundMoney(mode === 'AddToTotal' ? loanAmount + interestAmount : loanAmount);
  const disbursal_amount = roundMoney(
    mode === 'AddToTotal' ? loanAmount - charges : loanAmount - interestAmount - charges
  );
  return {
    total_payable,
    disbursal_amount,
    emi_amount: period > 0 ? Math.ceil(total_payable / period) : total_payable,
  };
}

function addPeriods(date: string, tenure: TenureType, n: number): string {
  switch (tenure) {
    case 'Daily':
      return addDays(date, n);
    case 'Weekly':
      return addDays(date, n * 7);
    case 'Monthly':
      return addMonths(date, n);
  }
}

export function firstDefaultDueDate(disbursalDate: string, tenure: TenureType): string {
  return addPeriods(disbursalDate, tenure, 1);
}

/** Date of the n-th installment (1-based), anchored to the first due date. */
export function installmentDate(disbursalDate: string, tenure: TenureType, n: number, emiStartDate?: string | null): string {
  return addPeriods(emiStartDate || firstDefaultDueDate(disbursalDate, tenure), tenure, n - 1);
}

/** Date of the final scheduled installment. */
export function maturityDate(disbursalDate: string, tenure: TenureType, period: number, emiStartDate?: string | null): string {
  return installmentDate(disbursalDate, tenure, period, emiStartDate);
}

type RepaymentSchedule = Pick<Loan, 'disbursal_date' | 'tenure_type' | 'period' | 'paid_amount' | 'emi_amount' | 'balance_amount' | 'status'> &
  Partial<Pick<Loan, 'emi_start_date'>>;

export function finalDueDate(loan: Pick<RepaymentSchedule, 'disbursal_date' | 'tenure_type' | 'period' | 'emi_start_date'>): string {
  return maturityDate(loan.disbursal_date, loan.tenure_type, loan.period, loan.emi_start_date);
}

/** A fully paid loan includes its smaller final installment, even when EMI was rounded up. */
export function paidInstallments(loan: Pick<RepaymentSchedule, 'period' | 'paid_amount' | 'emi_amount' | 'balance_amount'>): number {
  if (loan.balance_amount <= 0) return loan.period;
  return loan.emi_amount > 0
    ? Math.max(0, Math.min(loan.period, Math.floor(loan.paid_amount / loan.emi_amount + 1e-9)))
    : 0;
}

/** Earliest unpaid installment, retaining its original date when overdue. */
export function nextEmiDate(loan: RepaymentSchedule): string | null {
  if (loan.status === 'Completed' || loan.balance_amount <= 0) return null;
  const next = Math.min(loan.period, paidInstallments(loan) + 1);
  return installmentDate(loan.disbursal_date, loan.tenure_type, next, loan.emi_start_date);
}

/**
 * Returns the installment number that falls exactly on `date`, or null when no installment is scheduled that day.
 * Numbers beyond `period` are returned too, so callers can decide how to treat days after maturity.
 */
export function installmentNumberOn(disbursalDate: string, tenure: TenureType, date: string, emiStartDate?: string | null): number | null {
  const start = emiStartDate || firstDefaultDueDate(disbursalDate, tenure);
  const days = diffDays(start, date);
  if (days < 0) return null;
  switch (tenure) {
    case 'Daily':
      return days + 1;
    case 'Weekly':
      return days % 7 === 0 ? days / 7 + 1 : null;
    case 'Monthly': {
      const months = diffMonths(start, date);
      return addMonths(start, months) === date ? months + 1 : null;
    }
  }
}

/** How many installments have fallen due on or before `onDate` (0…period). */
export function installmentsElapsed(
  disbursalDate: string,
  tenure: TenureType,
  period: number,
  onDate: string,
  emiStartDate?: string | null
): number {
  const start = emiStartDate || firstDefaultDueDate(disbursalDate, tenure);
  const days = diffDays(start, onDate);
  if (days < 0) return 0;
  let count: number;
  switch (tenure) {
    case 'Daily':
      count = days + 1;
      break;
    case 'Weekly':
      count = Math.floor(days / 7) + 1;
      break;
    case 'Monthly': {
      const months = diffMonths(start, onDate);
      count = diffDays(addMonths(start, months), onDate) >= 0 ? months + 1 : months;
      break;
    }
  }
  return Math.max(0, Math.min(period, count));
}

/** True when the final installment date has passed and money is still outstanding. */
export function isPastMaturity(
  disbursalDate: string,
  tenure: TenureType,
  period: number,
  onDate: string,
  emiStartDate?: string | null
): boolean {
  return diffDays(maturityDate(disbursalDate, tenure, period, emiStartDate), onDate) > 0;
}

/** Upfront interest is retained at disbursal. Repayment interest never includes penalties. */
export function collectedInterest(loan: Pick<Loan, 'interest_amount' | 'interest_mode' | 'total_payable' | 'paid_amount' | 'status'>): number {
  const interest = Number.isFinite(loan.interest_amount) ? Math.max(0, loan.interest_amount) : 0;
  if (loan.interest_mode === 'DeductUpfront' || loan.status === 'Completed') return interest;
  if (!Number.isFinite(loan.total_payable) || loan.total_payable <= 0) return 0;
  const paid = Number.isFinite(loan.paid_amount) ? Math.max(0, loan.paid_amount) : 0;
  return Math.min(interest, interest * (Math.min(paid, loan.total_payable) / loan.total_payable));
}

export interface EmiPaymentAllocation {
  paymentId: number;
  paymentDate: string;
  amount: number;
  daysDiff: number;
  /** This payment finished covering this installment, rather than only contributing to it. */
  settlesInstallment: boolean;
}

export interface LoanEmiInstallment {
  installmentNumber: number;
  scheduledDate: string;
  expectedAmount: number;
  paidAmount: number;
  status: 'Paid' | 'Partial' | 'Overdue' | 'Upcoming';
  /** Completion date for paid EMIs; latest contributing payment date for partial EMIs. */
  actualPaidDate: string | null;
  daysDiff: number | null;
  allocations: EmiPaymentAllocation[];
}

type ScheduleLoan = Pick<Loan, 'id' | 'disbursal_date' | 'tenure_type' | 'period' | 'emi_amount' | 'total_payable'> &
  Partial<Pick<Loan, 'emi_start_date'>>;
type SchedulePayment = Pick<Payment, 'id' | 'loan_id' | 'amount' | 'payment_date'>;

/**
 * Allocate recorded EMI/loan payments to installments oldest-first, in integer paise.
 * Charges and manual status changes never create fictitious installment payments.
 * Input arrays are not mutated; complexity is linear after sorting the payments.
 */
export function buildLoanEmiSchedule(
  loan: ScheduleLoan,
  payments: readonly SchedulePayment[],
  onDate = todayStr()
): LoanEmiInstallment[] {
  if (!Number.isInteger(loan.period) || loan.period <= 0) return [];
  const cents = (amount: number) => Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
  const chronological = payments
    .filter((payment) => payment.loan_id === loan.id && cents(payment.amount) > 0)
    .slice()
    .sort((a, b) => a.payment_date.localeCompare(b.payment_date) || a.id - b.id);
  const schedule: LoanEmiInstallment[] = [];
  let totalRemaining = cents(loan.total_payable);
  const emi = cents(loan.emi_amount);
  let paymentIndex = 0;
  let paymentRemaining = chronological[0] ? cents(chronological[0].amount) : 0;

  for (let n = 1; n <= loan.period; n++) {
    const expected = n === loan.period ? totalRemaining : Math.min(emi, totalRemaining);
    totalRemaining -= expected;
    const scheduledDate = installmentDate(loan.disbursal_date, loan.tenure_type, n, loan.emi_start_date);
    const allocations: EmiPaymentAllocation[] = [];
    let paid = 0;
    while (paid < expected && paymentIndex < chronological.length) {
      const payment = chronological[paymentIndex];
      const amount = Math.min(expected - paid, paymentRemaining);
      paid += amount;
      paymentRemaining -= amount;
      allocations.push({
        paymentId: payment.id,
        paymentDate: payment.payment_date,
        amount: amount / 100,
        daysDiff: diffDays(scheduledDate, payment.payment_date),
        settlesInstallment: paid === expected,
      });
      if (paymentRemaining === 0) {
        paymentIndex++;
        paymentRemaining = chronological[paymentIndex] ? cents(chronological[paymentIndex].amount) : 0;
      }
    }
    const latest = allocations[allocations.length - 1];
    schedule.push({
      installmentNumber: n,
      scheduledDate,
      expectedAmount: expected / 100,
      paidAmount: paid / 100,
      status: paid === expected ? 'Paid' : paid > 0 ? 'Partial' : scheduledDate < onDate ? 'Overdue' : 'Upcoming',
      actualPaidDate: latest?.paymentDate ?? null,
      daysDiff: latest?.daysDiff ?? null,
      allocations,
    });
  }
  return schedule;
}

export interface PaymentEmiMatch extends EmiPaymentAllocation {
  installmentNumber: number;
  scheduledDate: string;
}

/** Index the same allocations for the ledger, so its comparison cannot drift from the schedule. */
export function paymentEmiMatches(schedule: readonly LoanEmiInstallment[]): Map<number, PaymentEmiMatch[]> {
  const matches = new Map<number, PaymentEmiMatch[]>();
  for (const installment of schedule) {
    for (const allocation of installment.allocations) {
      const entries = matches.get(allocation.paymentId) ?? [];
      entries.push({ ...allocation, installmentNumber: installment.installmentNumber, scheduledDate: installment.scheduledDate });
      matches.set(allocation.paymentId, entries);
    }
  }
  return matches;
}

export function paymentTimingLabel(days: number): string {
  if (days === 0) return 'On time';
  const count = Math.abs(days);
  return `${count} ${count === 1 ? 'day' : 'days'} ${days > 0 ? 'late' : 'early'}`;
}

export const loanTotalPaid = (loan: Pick<Loan, 'paid_amount' | 'total_charges_collected'>): number =>
  roundMoney(loan.paid_amount + (loan.total_charges_collected ?? 0));

export const loanBalanceDue = (loan: Pick<Loan, 'total_payable' | 'paid_amount'>): number =>
  roundMoney(loan.total_payable - loan.paid_amount);
