import type { FinanceReport } from '@/types/finance';
import { addDays, addMonths, isValidDateStr, todayStr } from '@/utils/date';
import { roundMoney } from '@/utils/loanCalculations';

export type DatePreset = 'All Time' | 'This Month' | 'Today' | 'Custom Range';
export interface DateRange {
  fromDate?: string;
  toDate?: string;
}
export interface DateFilter extends DateRange {
  preset: DatePreset;
}

export function presetDateRange(preset: DatePreset, today = todayStr()): DateFilter {
  if (preset === 'Today') return { preset, fromDate: today, toDate: today };
  if (preset === 'This Month') {
    const fromDate = `${today.slice(0, 7)}-01`;
    return { preset, fromDate, toDate: addDays(addMonths(fromDate, 1), -1) };
  }
  return { preset };
}

export function dateRangeError({ fromDate, toDate }: DateRange): string | null {
  if (fromDate && !isValidDateStr(fromDate)) return 'From date must be a valid date';
  if (toDate && !isValidDateStr(toDate)) return 'To date must be a valid date';
  return fromDate && toDate && fromDate > toDate ? 'From date cannot be after to date' : null;
}

export function earningsSummary(report: FinanceReport) {
  return {
    netEarnings: roundMoney(report.totalDocumentCharges + report.totalInterestCollected - report.totalExpenses),
    netCashflow: roundMoney(report.totalPaymentsCollected - report.totalDisbursedAmount - report.totalExpenses),
  };
}
