import type { ExpenseInput, PaymentMode } from '@/types/finance';
import { isValidDateStr } from '@/utils/date';
import { roundMoney } from '@/utils/loanCalculations';
import { parseNumber } from '@/utils/number';

export interface ExpenseFormValues {
  title: string;
  category: string;
  amount: string;
  expense_date: string;
  payment_mode: PaymentMode;
  notes: string;
}

export function expenseFormErrors(values: ExpenseFormValues): Partial<Record<keyof ExpenseFormValues, string>> {
  const errors: Partial<Record<keyof ExpenseFormValues, string>> = {};
  if (!values.title.trim()) errors.title = 'Enter a title or description';
  if (!values.category.trim()) errors.category = 'Select or enter a category';
  const amount = roundMoney(parseNumber(values.amount));
  if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'Enter an amount greater than zero';
  if (!isValidDateStr(values.expense_date)) errors.expense_date = 'Select a valid expense date';
  if (values.payment_mode !== 'Cash' && values.payment_mode !== 'UPI') errors.payment_mode = 'Select Cash or UPI';
  return errors;
}

export function expenseInputFromForm(values: ExpenseFormValues): ExpenseInput {
  const errors = expenseFormErrors(values);
  const error = Object.values(errors)[0];
  if (error) throw new Error(error);
  return {
    title: values.title.trim(), category: values.category.trim(), amount: roundMoney(parseNumber(values.amount)),
    expense_date: values.expense_date, payment_mode: values.payment_mode, notes: values.notes.trim(),
  };
}
