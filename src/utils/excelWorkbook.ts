import * as XLSX from 'xlsx';

import type { BackupData, CustomerWithSummary, FinanceReport } from '@/types/finance';
import { collectedInterest, nextEmiDate, roundMoney } from '@/utils/loanCalculations';
import { earningsSummary } from '@/utils/reporting';

const MONEY_FORMAT = '"₹"#,##0.00;[Red]("₹"#,##0.00);"-"';
type Cell = string | number;

/** Snapshot export: values match the database at export time, with no live/external links. */
export function createExcelWorkbook(data: BackupData): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: 'FinanceTracker Full Data Export', Author: 'FinanceTracker', Subject: 'All-time business data' };
  const customerById = new Map(data.customers.map((customer) => [customer.id, customer]));
  const customers = new Map<number, CustomerWithSummary>(data.customers.map((customer) => [customer.id, {
    ...customer, active_loans: 0, total_borrowed: 0, active_borrowed: 0, balance_due: 0,
  }]));
  const report: FinanceReport = {
    totalDisbursedAmount: 0, totalPrincipalLoaned: 0, totalDocumentCharges: 0,
    totalInterestExpected: 0, totalInterestCollected: 0, totalPaymentsCollected: 0,
    totalExpenses: 0, loansCount: data.loans.length, paymentsCount: data.payments.length, expensesCount: data.expenses.length,
  };
  const statuses = { Active: 0, Overdue: 0, Completed: 0 };
  for (const loan of data.loans) {
    statuses[loan.status]++;
    report.totalPrincipalLoaned += loan.loan_amount;
    report.totalDisbursedAmount += loan.disbursal_amount;
    report.totalDocumentCharges += loan.charges;
    report.totalInterestExpected += loan.interest_amount;
    report.totalInterestCollected += collectedInterest(loan);
    const summary = customers.get(loan.customer_id);
    if (summary) {
      summary.total_borrowed += loan.loan_amount;
      summary.balance_due += loan.total_payable - loan.paid_amount;
      if (loan.status !== 'Completed') {
        summary.active_loans++;
        summary.active_borrowed += loan.loan_amount;
      }
    }
  }
  let totalExtraChargesCollected = 0;
  const loanChargesMap = new Map<number, number>();
  for (const payment of data.payments) {
    report.totalPaymentsCollected += payment.amount + (payment.charges_amount ?? 0);
    const charges = payment.charges_amount ?? 0;
    if (charges > 0) {
      totalExtraChargesCollected += charges;
      loanChargesMap.set(payment.loan_id, (loanChargesMap.get(payment.loan_id) ?? 0) + charges);
    }
  }
  for (const expense of data.expenses) report.totalExpenses += expense.amount;
  const earnings = earningsSummary(report);

  function sheet(name: string, headers: string[], rows: Cell[][], moneyColumns: number[] = []) {
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    worksheet['!cols'] = headers.map((header, col) => ({
      wch: Math.min(48, Math.max(header.length + 2, 14,
        ...rows.slice(0, 150).map((row) => String(row[col] ?? '').length + 2))),
    }));
    worksheet['!rows'] = [{ hpt: 28 }];
    worksheet['!autofilter'] = { ref: worksheet['!ref']! };
    for (let r = 1; r <= rows.length; r++) {
      for (const c of moneyColumns) {
        const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
        if (cell?.t === 'n') { cell.v = roundMoney(cell.v as number); cell.z = MONEY_FORMAT; }
      }
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
    return worksheet;
  }

  const summary = sheet('Summary_Report', ['Metric', 'Value', 'Notes'], [
    ['Total Principal', report.totalPrincipalLoaned, 'Loan amount across all loans'],
    ['Total Disbursed', report.totalDisbursedAmount, 'Actual cash handed to customers'],
    ['Document Charges', report.totalDocumentCharges, 'Charges on all issued loans'],
    ['Interest Expected', report.totalInterestExpected, 'Interest amount across all loans'],
    ['Interest Collected', report.totalInterestCollected, 'Upfront interest at disbursal; add-to-total interest proportional to repayment, fully realized on completion'],
    ['Total Payments Collected', report.totalPaymentsCollected, 'All recorded payments including penalties and extra charges'],
    ['Total Extra Charges Collected', totalExtraChargesCollected, 'Penalties and extra charges collected across payments'],
    ['Total Expenses', report.totalExpenses, 'All recorded business expenses'],
    ['Net Earnings', earnings.netEarnings + totalExtraChargesCollected, 'Document charges + extra charges + interest collected − expenses'],
    ['Net Cash Flow', earnings.netCashflow, 'Payments collected (including extra charges) − disbursed − expenses'],
    ['Active Loans', statuses.Active, 'Status = Active'],
    ['Overdue Loans', statuses.Overdue, 'Status = Overdue'],
    ['Completed Loans', statuses.Completed, 'Status = Completed'],
    ['Customers Count', data.customers.length, 'All customers'],
    ['Payments Count', data.payments.length, 'All payments'],
    ['Expenses Count', data.expenses.length, 'All expenses'],
    ['Exported At', data.exported_at, 'All time; screen filters do not limit this export'],
  ]);
  for (let r = 1; r <= 10; r++) {
    summary[`B${r + 1}`].v = roundMoney(summary[`B${r + 1}`].v as number);
    summary[`B${r + 1}`].z = MONEY_FORMAT;
  }
  summary['!cols'] = [{ wch: 30 }, { wch: 28 }, { wch: 80 }];

  sheet('Customers', ['Customer ID', 'Name', 'Phone', 'Address', 'Guarantor Name', 'Guarantor Phone', 'Notes',
    'Created At', 'Active Loans', 'Total Borrowed', 'Active Borrowed', 'Balance Due', 'Alternate Contact Number'],
  Array.from(customers.values()).map((c) => [c.id, c.name, c.phone, c.address, c.guarantor_name, c.guarantor_phone,
    c.notes, c.created_at, c.active_loans, c.total_borrowed, c.active_borrowed, c.balance_due, c.alternate_phone ?? '']), [9, 10, 11]);

  sheet('Loans', ['Loan ID', 'Customer ID', 'Customer Name', 'Phone', 'Loan Amount', 'Tenure', 'Period',
    'Interest Mode', 'Interest Rate (%)', 'Interest Amount', 'Document Charges', 'Extra Charges Collected', 'Disbursal Date', 'Disbursal Amount',
    'EMI Amount', 'Total Payable', 'Paid Amount', 'Balance', 'Status', 'Closed Date', 'Next EMI Date', 'Guarantor Name', 'Guarantor Phone', 'Notes', 'Created At', 'EMI Start Date', 'EMI / Loan Paid', 'Monthly Loan Category'],
  data.loans.map((l) => [l.id, l.customer_id, customerById.get(l.customer_id)?.name ?? '',
    customerById.get(l.customer_id)?.phone ?? '', l.loan_amount, l.tenure_type, l.period, l.interest_mode,
    l.interest_rate, l.interest_amount, l.charges, loanChargesMap.get(l.id) ?? 0, l.disbursal_date, l.disbursal_amount, l.emi_amount,
    l.total_payable, l.paid_amount + (loanChargesMap.get(l.id) ?? 0), l.total_payable - l.paid_amount, l.status, l.closed_date ?? '', nextEmiDate(l) ?? 'Completed',
    l.guarantor_name ?? '', l.guarantor_phone ?? '', l.notes, l.created_at, l.emi_start_date ?? '', l.paid_amount,
    l.tenure_type === 'Monthly' ? l.monthly_type ?? '' : '']),
  [4, 9, 10, 11, 13, 14, 15, 16, 17, 26]);

  sheet('Payments', ['Payment ID', 'Date', 'Customer ID', 'Customer Name', 'Loan ID', 'EMI / Loan Paid', 'Extra Charges', 'Total Collected', 'Payment Mode', 'Notes', 'Created At'],
    data.payments.map((p) => [p.id, p.payment_date, p.customer_id, customerById.get(p.customer_id)?.name ?? '',
      p.loan_id, p.amount, p.charges_amount ?? 0, roundMoney((p.amount ?? 0) + (p.charges_amount ?? 0)), p.payment_mode, p.notes, p.created_at]), [5, 6, 7]);
  sheet('Expenses', ['Expense ID', 'Date', 'Title', 'Category', 'Amount', 'Payment Mode', 'Notes', 'Created At'],
    data.expenses.map((e) => [e.id, e.expense_date, e.title, e.category, e.amount, e.payment_mode, e.notes ?? '', e.created_at]), [4]);
  return workbook;
}

export function excelWorkbookBase64(data: BackupData): string {
  return XLSX.write(createExcelWorkbook(data), { type: 'base64', bookType: 'xlsx', compression: true });
}
