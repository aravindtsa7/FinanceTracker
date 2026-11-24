import { openDatabaseAsync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import type {
  BackupData,
  BackupSummary,
  CreatePaymentInput,
  Customer,
  CustomerInput,
  CustomerWithSummary,
  DashboardStats,
  DueLoan,
  Expense,
  ExpenseInput,
  FinanceReport,
  InterestMode,
  Loan,
  LoanInput,
  LoanReminderNote,
  LoanRow,
  LoanStatus,
  LoanUpdateInput,
  Payment,
  PaymentInput,
  PaymentMode,
  PaymentRow,
  TableCounts,
  TenureType,
} from '@/types/finance';
import { isValidDateStr, todayStr } from '@/utils/date';
import { parseUriList } from '@/utils/photoUris';
import {
  calculateLoanTerms,
  installmentNumberOn,
  interestFromRate,
  isPastMaturity,
  nextEmiDate,
  roundMoney,
} from '@/utils/loanCalculations';

export type { CreatePaymentInput };

const DB_NAME = 'finance_tracker.db';
/** v6 adds alternate contacts, monthly categories and loan photos; older backups remain importable. */
export const BACKUP_VERSION = 6;

const TENURE_TYPES: readonly TenureType[] = ['Daily', 'Weekly', 'Monthly'];
const LOAN_STATUSES: readonly LoanStatus[] = ['Active', 'Completed', 'Overdue'];
const PAYMENT_MODES: readonly PaymentMode[] = ['Cash', 'UPI'];
const INTEREST_MODES: readonly InterestMode[] = ['AddToTotal', 'DeductUpfront'];

/** Shared connection used for reads and single-statement writes. */
const db = openDatabaseSync(DB_NAME);

const CONNECTION_PRAGMAS = `
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS customers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL,
    phone            TEXT    NOT NULL DEFAULT '',
    address          TEXT    NOT NULL DEFAULT '',
    guarantor_name   TEXT    NOT NULL DEFAULT '',
    guarantor_phone  TEXT    NOT NULL DEFAULT '',
    notes            TEXT    NOT NULL DEFAULT '',
    created_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS loans (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id      INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    loan_amount      REAL    NOT NULL CHECK (loan_amount > 0),
    tenure_type      TEXT    NOT NULL CHECK (tenure_type IN ('Daily', 'Weekly', 'Monthly')),
    period           INTEGER NOT NULL CHECK (period > 0),
    interest_rate    REAL    NOT NULL DEFAULT 0,
    interest_amount  REAL    NOT NULL DEFAULT 0,
    charges          REAL    NOT NULL DEFAULT 0,
    disbursal_date   TEXT    NOT NULL,
    disbursal_amount REAL    NOT NULL,
    emi_amount       REAL    NOT NULL,
    total_payable    REAL    NOT NULL,
    paid_amount      REAL    NOT NULL DEFAULT 0,
    balance_amount   REAL    NOT NULL,
    status           TEXT    NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Completed', 'Overdue')),
    guarantor_name   TEXT    NOT NULL DEFAULT '',
    guarantor_phone  TEXT    NOT NULL DEFAULT '',
    closed_date      TEXT    DEFAULT NULL,
    notes            TEXT    NOT NULL DEFAULT '',
    created_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id          INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    customer_id      INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    amount           REAL    NOT NULL CHECK (amount >= 0),
    charges_amount   REAL    NOT NULL DEFAULT 0,
    payment_date     TEXT    NOT NULL,
    payment_mode     TEXT    NOT NULL DEFAULT 'Cash' CHECK (payment_mode IN ('Cash', 'UPI')),
    notes            TEXT    NOT NULL DEFAULT '',
    created_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_loans_customer   ON loans(customer_id);
  CREATE INDEX IF NOT EXISTS idx_loans_status     ON loans(status);
  CREATE INDEX IF NOT EXISTS idx_payments_loan    ON payments(loan_id);
  CREATE INDEX IF NOT EXISTS idx_payments_date    ON payments(payment_date);
  CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
`;

/** Index i upgrades the schema from user_version i to i + 1. Append only — never edit a shipped migration. */
const MIGRATIONS: readonly string[] = [
  SCHEMA,
  `ALTER TABLE loans ADD COLUMN interest_mode TEXT NOT NULL DEFAULT 'AddToTotal'
     CHECK (interest_mode IN ('AddToTotal', 'DeductUpfront'));`,
  `CREATE TABLE expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    expense_date TEXT NOT NULL,
    payment_mode TEXT NOT NULL DEFAULT 'Cash' CHECK (payment_mode IN ('Cash', 'UPI')),
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX idx_expenses_date ON expenses(expense_date);
  CREATE INDEX idx_loans_disbursal_date ON loans(disbursal_date);`,
  `ALTER TABLE loans ADD COLUMN guarantor_name TEXT NOT NULL DEFAULT '';
   ALTER TABLE loans ADD COLUMN guarantor_phone TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE loans ADD COLUMN closed_date TEXT DEFAULT NULL;
   ALTER TABLE payments ADD COLUMN charges_amount REAL NOT NULL DEFAULT 0;`,
  `CREATE TABLE IF NOT EXISTS loan_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_loan_reminders_loan ON loan_reminders(loan_id);`,
];
const SCHEMA_VERSION = MIGRATIONS.length;

const LOAN_SELECT = `
  SELECT l.*, c.name AS customer_name, c.phone AS customer_phone,
         COALESCE((SELECT SUM(p.charges_amount) FROM payments p WHERE p.loan_id = l.id), 0) AS total_charges_collected
  FROM loans l
  JOIN customers c ON c.id = l.customer_id
`;

const PAYMENT_SELECT = `
  SELECT p.*, c.name AS customer_name
  FROM payments p
  JOIN customers c ON c.id = p.customer_id
`;

// ---------------------------------------------------------------------------
// Setup & internals
// ---------------------------------------------------------------------------

let initPromise: Promise<void> | null = null;

/** Creates / migrates the schema. Safe to call repeatedly; concurrent callers share one run. */
export function initDatabase(): Promise<void> {
  initPromise ??= (async () => {
    await db.execAsync(`PRAGMA journal_mode = WAL; ${CONNECTION_PRAGMAS}`);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    for (let version = row?.user_version ?? 0; version < SCHEMA_VERSION; version++) {
      // Each step and its version bump commit together, so a failed upgrade can simply be retried.
      try {
        await db.execAsync(`BEGIN; ${MIGRATIONS[version]} PRAGMA user_version = ${version + 1}; COMMIT;`);
      } catch (error) {
        await db.execAsync('ROLLBACK').catch(() => undefined);
        const msg = String(error).toLowerCase();
        // If the column or table was already added out of band, bump version safely and continue
        if (msg.includes('duplicate column')) {
          await db.execAsync(`PRAGMA user_version = ${version + 1};`);
          continue;
        }
        throw error;
      }
    }

    // Guard each addition independently, including partially upgraded databases.
    // Fail initialization if these migrations fail; never expose a half-upgraded schema.
    const loanColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(loans)');
    if (!loanColumns.some((column) => column.name === 'emi_start_date')) {
      await db.execAsync('ALTER TABLE loans ADD COLUMN emi_start_date TEXT DEFAULT NULL;');
    }
    if (!loanColumns.some((column) => column.name === 'monthly_type')) {
      await db.execAsync('ALTER TABLE loans ADD COLUMN monthly_type TEXT DEFAULT NULL;');
    }
    if (!loanColumns.some((column) => column.name === 'doc_uris')) {
      await db.execAsync("ALTER TABLE loans ADD COLUMN doc_uris TEXT NOT NULL DEFAULT '[]';");
    }
    const customerColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(customers)');
    for (const column of ['photo_uri', 'kyc_type', 'kyc_number', 'kyc_doc_uri', 'alternate_phone']) {
      if (!customerColumns.some((existing) => existing.name === column)) {
        await db.execAsync(`ALTER TABLE customers ADD COLUMN ${column} TEXT NOT NULL DEFAULT '';`);
      }
    }

    // Safe migration check: verify columns on loans and payments if missing
    try {
      const loanCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(loans)');
      const loanColNames = new Set(loanCols.map((c) => c.name));
      if (!loanColNames.has('guarantor_name')) {
        await db.execAsync("ALTER TABLE loans ADD COLUMN guarantor_name TEXT NOT NULL DEFAULT '';");
      }
      if (!loanColNames.has('guarantor_phone')) {
        await db.execAsync("ALTER TABLE loans ADD COLUMN guarantor_phone TEXT NOT NULL DEFAULT '';");
      }
      if (!loanColNames.has('closed_date')) {
        await db.execAsync('ALTER TABLE loans ADD COLUMN closed_date TEXT DEFAULT NULL;');
      }

      const paymentCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(payments)');
      const paymentColNames = new Set(paymentCols.map((c) => c.name));
      if (!paymentColNames.has('charges_amount')) {
        await db.execAsync('ALTER TABLE payments ADD COLUMN charges_amount REAL NOT NULL DEFAULT 0;');
      }

      // Check if legacy payments table has CHECK (amount > 0) and relax it to CHECK (amount >= 0)
      const paymentTableInfo = await db.getFirstAsync<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payments'"
      );
      if (paymentTableInfo?.sql && paymentTableInfo.sql.includes('amount > 0')) {
        await db.execAsync(`
          PRAGMA foreign_keys = OFF;
          CREATE TABLE IF NOT EXISTS payments_migration (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            loan_id          INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
            customer_id      INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
            amount           REAL    NOT NULL CHECK (amount >= 0),
            charges_amount   REAL    NOT NULL DEFAULT 0,
            payment_date     TEXT    NOT NULL,
            payment_mode     TEXT    NOT NULL DEFAULT 'Cash' CHECK (payment_mode IN ('Cash', 'UPI')),
            notes            TEXT    NOT NULL DEFAULT '',
            created_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
          );
          INSERT INTO payments_migration (id, loan_id, customer_id, amount, charges_amount, payment_date, payment_mode, notes, created_at)
          SELECT id, loan_id, customer_id, amount, charges_amount, payment_date, payment_mode, notes, created_at
          FROM payments;
          DROP TABLE payments;
          ALTER TABLE payments_migration RENAME TO payments;
          CREATE INDEX IF NOT EXISTS idx_payments_loan ON payments(loan_id);
          CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
          CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
          PRAGMA foreign_keys = ON;
        `);
      }

      // Backfill existing Completed loans that have closed_date IS NULL
      await db.execAsync(`
        UPDATE loans
        SET closed_date = COALESCE((SELECT MAX(payment_date) FROM payments WHERE loan_id = loans.id), disbursal_date)
        WHERE status = 'Completed' AND closed_date IS NULL;
      `);
    } catch {
      // Ignore if table does not exist yet or columns already present
    }
  })().catch((error) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

/**
 * Runs `task` atomically on a dedicated connection.
 * expo-sqlite's own exclusive transactions open a fresh connection that does not inherit
 * `PRAGMA foreign_keys`, so this sets the pragmas before starting the transaction.
 */
async function withWriteTransaction<T>(task: (txn: SQLiteDatabase) => Promise<T>): Promise<T> {
  await initDatabase();
  const txn = await openDatabaseAsync(DB_NAME, { useNewConnection: true });
  try {
    await txn.execAsync(CONNECTION_PRAGMAS);
    await txn.execAsync('BEGIN IMMEDIATE');
    try {
      const result = await task(txn);
      await txn.execAsync('COMMIT');
      return result;
    } catch (error) {
      await txn.execAsync('ROLLBACK');
      throw error;
    }
  } finally {
    await txn.closeAsync();
  }
}

/** Escapes LIKE wildcards so user input is matched literally. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function requireText(value: string | undefined, field: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) throw new Error(`${field} is required`);
  return trimmed;
}

function requireDate(value: string, field: string): string {
  if (!isValidDateStr(value)) throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  return value;
}

function requirePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be greater than zero`);
  return value;
}

/**
 * Status after paid/balance change: Completed once fully paid; Overdue when past maturity;
 * a manually flagged Overdue stays Overdue; otherwise Active.
 */
function deriveStatus(
  loan: Pick<LoanRow, 'disbursal_date' | 'tenure_type' | 'period'> & { status?: LoanStatus; emi_start_date?: string | null },
  balance: number,
  today: string
): LoanStatus {
  if (balance <= 0) return 'Completed';
  if (isPastMaturity(loan.disbursal_date, loan.tenure_type, loan.period, today, loan.emi_start_date)) return 'Overdue';
  return loan.status === 'Overdue' ? 'Overdue' : 'Active';
}

/** Recomputes paid / balance / status / closed_date for a loan from its payments. */
async function recalculateLoan(conn: SQLiteDatabase, loanId: number, paymentDate?: string): Promise<void> {
  const loan = await conn.getFirstAsync<LoanRow>('SELECT * FROM loans WHERE id = ?', loanId);
  if (!loan) throw new Error(`Loan #${loanId} not found`);
  const sum = await conn.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE loan_id = ?',
    loanId
  );
  const paid = roundMoney(sum?.total ?? 0);
  const balance = roundMoney(loan.total_payable - paid);
  const status = deriveStatus(loan, balance, todayStr());

  let closedDate: string | null = null;
  if (status === 'Completed') {
    if (paymentDate) {
      closedDate = paymentDate;
    } else {
      const latest = await conn.getFirstAsync<{ maxDate: string | null }>(
        'SELECT MAX(payment_date) AS maxDate FROM payments WHERE loan_id = ?',
        loanId
      );
      closedDate = latest?.maxDate ?? loan.closed_date ?? todayStr();
    }
  }

  await conn.runAsync(
    'UPDATE loans SET paid_amount = ?, balance_amount = ?, status = ?, closed_date = ? WHERE id = ?',
    paid,
    balance,
    status,
    closedDate,
    loanId
  );
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/** Searches name, contact numbers, KYC number and guarantor name (case-insensitive substring match). */
export async function getCustomers(searchQuery?: string): Promise<CustomerWithSummary[]> {
  await initDatabase();
  const q = searchQuery?.trim();
  const pattern = q ? likePattern(q) : null;
  return db.getAllAsync<CustomerWithSummary>(
    `SELECT c.*,
            COALESCE(s.active_loans, 0) AS active_loans,
            COALESCE(s.total_borrowed, 0) AS total_borrowed,
            COALESCE(s.active_borrowed, 0) AS active_borrowed,
            COALESCE(s.balance_due, 0) AS balance_due
     FROM customers c
     LEFT JOIN (
       SELECT customer_id,
              SUM(CASE WHEN status != 'Completed' THEN 1 ELSE 0 END) AS active_loans,
              SUM(loan_amount) AS total_borrowed,
              SUM(CASE WHEN status != 'Completed' THEN loan_amount ELSE 0 END) AS active_borrowed,
              SUM(balance_amount) AS balance_due
       FROM loans GROUP BY customer_id
     ) s ON s.customer_id = c.id
     ${q ? "WHERE c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.alternate_phone LIKE ? ESCAPE '\\' OR c.kyc_number LIKE ? ESCAPE '\\' OR c.guarantor_name LIKE ? ESCAPE '\\'" : ''}
     ORDER BY c.name COLLATE NOCASE`,
    pattern ? [pattern, pattern, pattern, pattern, pattern] : []
  );
}

export async function getCustomerById(id: number): Promise<Customer | null> {
  await initDatabase();
  return db.getFirstAsync<Customer>('SELECT * FROM customers WHERE id = ?', id);
}

/** Returns the new customer's id. */
export async function addCustomer(input: CustomerInput): Promise<number> {
  await initDatabase();
  const result = await db.runAsync(
    `INSERT INTO customers (name, phone, address, guarantor_name, guarantor_phone, notes, photo_uri, kyc_type, kyc_number, kyc_doc_uri, alternate_phone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    requireText(input.name, 'Name'),
    input.phone.trim(),
    input.address?.trim() ?? '',
    input.guarantor_name?.trim() ?? '',
    input.guarantor_phone?.trim() ?? '',
    input.notes?.trim() ?? '',
    input.photo_uri?.trim() ?? '',
    input.kyc_type?.trim() ?? '',
    input.kyc_number?.trim() ?? '',
    JSON.stringify(parseUriList(input.kyc_doc_uri)),
    input.alternate_phone?.trim() ?? ''
  );
  return result.lastInsertRowId;
}

export async function updateCustomer(id: number, input: CustomerInput): Promise<void> {
  await initDatabase();
  const result = await db.runAsync(
    `UPDATE customers
     SET name = ?, phone = ?, address = ?, guarantor_name = ?, guarantor_phone = ?, notes = ?,
         photo_uri = ?, kyc_type = ?, kyc_number = ?, kyc_doc_uri = ?, alternate_phone = ?
     WHERE id = ?`,
    requireText(input.name, 'Name'),
    input.phone.trim(),
    input.address?.trim() ?? '',
    input.guarantor_name?.trim() ?? '',
    input.guarantor_phone?.trim() ?? '',
    input.notes?.trim() ?? '',
    input.photo_uri?.trim() ?? '',
    input.kyc_type?.trim() ?? '',
    input.kyc_number?.trim() ?? '',
    JSON.stringify(parseUriList(input.kyc_doc_uri)),
    input.alternate_phone?.trim() ?? '',
    id
  );
  if (result.changes === 0) throw new Error(`Customer #${id} not found`);
}

/** Deletes the customer along with all their loans and payments (ON DELETE CASCADE). */
export async function deleteCustomer(id: number): Promise<void> {
  await initDatabase();
  await db.runAsync('DELETE FROM customers WHERE id = ?', id);
}

// ---------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------

/** Searches by customer name or phone; optional status and tenure filters. */
export async function getLoans(
  filterStatus?: LoanStatus | 'All',
  searchQuery?: string,
  filterTenure?: TenureType | 'All'
): Promise<Loan[]> {
  await initDatabase();
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filterStatus && filterStatus !== 'All') {
    where.push('l.status = ?');
    params.push(filterStatus);
  }
  if (filterTenure && filterTenure !== 'All') {
    where.push('l.tenure_type = ?');
    params.push(filterTenure);
  }
  const q = searchQuery?.trim();
  if (q) {
    const pattern = likePattern(q);
    where.push(`(c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR l.guarantor_name LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern, pattern);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.getAllAsync<Loan>(`${LOAN_SELECT} ${whereSql}`, params);

  const enriched = rows.map((loan) => ({
    ...loan,
    next_due_date: nextEmiDate(loan),
  }));

  return enriched.sort((a, b) => {
    const aCompleted = a.status === 'Completed';
    const bCompleted = b.status === 'Completed';

    if (aCompleted !== bCompleted) {
      return aCompleted ? 1 : -1;
    }

    if (!aCompleted) {
      // Active / Overdue loans: next_due_date ASC (earliest/most urgent EMI due date at top)
      const aDue = a.next_due_date ?? '9999-99-99';
      const bDue = b.next_due_date ?? '9999-99-99';
      const dueDiff = aDue.localeCompare(bDue);
      if (dueDiff !== 0) return dueDiff;
      return b.id - a.id;
    }

    // Completed loans: closed_date DESC (most recently closed first)
    const aClosed = a.closed_date ?? a.disbursal_date;
    const bClosed = b.closed_date ?? b.disbursal_date;
    const closedDiff = bClosed.localeCompare(aClosed);
    if (closedDiff !== 0) return closedDiff;
    return b.id - a.id;
  });
}

export async function getLoanById(id: number): Promise<Loan | null> {
  await initDatabase();
  const loan = await db.getFirstAsync<Loan>(`${LOAN_SELECT} WHERE l.id = ?`, id);
  if (loan) {
    loan.next_due_date = nextEmiDate(loan);
  }
  return loan;
}

export async function getLoansByCustomer(customerId: number): Promise<Loan[]> {
  await initDatabase();
  const loans = await db.getAllAsync<Loan>(
    `${LOAN_SELECT} WHERE l.customer_id = ? ORDER BY l.disbursal_date DESC, l.id DESC`,
    customerId
  );
  return loans.map((loan) => ({
    ...loan,
    next_due_date: nextEmiDate(loan),
  }));
}

function prepareLoan(input: LoanUpdateInput) {
  const loanAmount = requirePositive(input.loan_amount, 'Loan amount');
  if (!Number.isInteger(input.period) || input.period <= 0) throw new Error('Period must be a whole number above zero');
  if (!TENURE_TYPES.includes(input.tenure_type)) throw new Error(`Invalid tenure type "${input.tenure_type}"`);
  if (!Number.isFinite(input.interest_rate) || input.interest_rate < 0) throw new Error('Interest rate cannot be negative');
  const charges = input.charges ?? 0;
  if (!Number.isFinite(charges) || charges < 0) throw new Error('Charges cannot be negative');
  const disbursalDate = requireDate(input.disbursal_date, 'Disbursal date');
  const emiStartDate = input.emi_start_date == null ? null : requireDate(input.emi_start_date, 'EMI start date');
  if (emiStartDate && emiStartDate < disbursalDate) throw new Error('EMI start date cannot be before disbursal');
  const interestMode = input.interest_mode ?? 'AddToTotal';
  if (!INTEREST_MODES.includes(interestMode)) throw new Error(`Invalid interest mode "${interestMode}"`);
  if (input.status !== undefined && !LOAN_STATUSES.includes(input.status)) {
    throw new Error(`Invalid status "${input.status}"`);
  }

  const interestAmount = roundMoney(input.interest_amount ?? interestFromRate(loanAmount, input.interest_rate));
  if (!Number.isFinite(interestAmount) || interestAmount < 0) throw new Error('Interest amount cannot be negative');
  const terms = calculateLoanTerms(loanAmount, interestAmount, input.period, charges, interestMode);
  const totalPayable = requirePositive(roundMoney(input.total_payable ?? terms.total_payable), 'Total payable');
  const disbursalAmount = requirePositive(
    roundMoney(input.disbursal_amount ?? terms.disbursal_amount),
    'Disbursal amount'
  );
  const emiAmount = requirePositive(roundMoney(input.emi_amount ?? terms.emi_amount), 'EMI amount');
  return {
    loanAmount, charges: roundMoney(charges), disbursalDate, emiStartDate, interestMode,
    interestAmount, totalPayable, disbursalAmount, emiAmount,
  };
}

/** Returns the new loan's id. Interest / EMI / totals are derived unless explicitly supplied. */
export async function addLoan(input: LoanInput): Promise<number> {
  await initDatabase();
  const { loanAmount, charges, disbursalDate, emiStartDate, interestMode, interestAmount,
    totalPayable, disbursalAmount, emiAmount } = prepareLoan(input);
  const customer = await getCustomerById(input.customer_id);
  if (!customer) throw new Error(`Customer #${input.customer_id} not found`);
  const status = input.status ?? deriveStatus(
    { disbursal_date: disbursalDate, emi_start_date: emiStartDate, tenure_type: input.tenure_type, period: input.period },
    totalPayable, todayStr()
  );
  const closedDate = status === 'Completed' ? (input.closed_date ?? todayStr()) : null;

  const result = await db.runAsync(
    `INSERT INTO loans (
       customer_id, loan_amount, tenure_type, period, interest_rate, interest_amount, interest_mode, charges,
       disbursal_date, disbursal_amount, emi_amount, total_payable, paid_amount, balance_amount, status,
       guarantor_name, guarantor_phone, closed_date, notes, emi_start_date, monthly_type, doc_uris
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.customer_id,
    loanAmount,
    input.tenure_type,
    input.period,
    input.interest_rate,
    interestAmount,
    interestMode,
    roundMoney(charges),
    disbursalDate,
    disbursalAmount,
    emiAmount,
    totalPayable,
    totalPayable,
    status,
    input.guarantor_name?.trim() ?? '',
    input.guarantor_phone?.trim() ?? '',
    closedDate,
    input.notes?.trim() ?? '',
    emiStartDate,
    input.tenure_type === 'Monthly' ? input.monthly_type?.trim() || 'Finance' : null,
    JSON.stringify(parseUriList(input.doc_uris))
  );
  return result.lastInsertRowId;
}

/** Updates terms atomically against the current paid amount, preserving borrower and payments. */
export async function updateLoan(id: number, input: LoanUpdateInput): Promise<void> {
  const terms = prepareLoan(input);
  await withWriteTransaction(async (txn) => {
    const loan = await txn.getFirstAsync<LoanRow>('SELECT * FROM loans WHERE id = ?', id);
    if (!loan) throw new Error(`Loan #${id} not found`);
    if (terms.totalPayable < loan.paid_amount) {
      throw new Error(`Total payable cannot be less than the amount already paid (${loan.paid_amount})`);
    }
    const earliestPayment = await txn.getFirstAsync<{ date: string | null }>(
      'SELECT MIN(payment_date) AS date FROM payments WHERE loan_id = ?', id
    );
    if (earliestPayment?.date && terms.disbursalDate > earliestPayment.date) {
      throw new Error('Disbursal date cannot be after an existing payment date');
    }
    const balance = roundMoney(Math.max(0, terms.totalPayable - loan.paid_amount));
    const status = balance === 0 ? 'Completed' : input.status ?? deriveStatus(
      { disbursal_date: terms.disbursalDate, emi_start_date: terms.emiStartDate, tenure_type: input.tenure_type, period: input.period },
      balance, todayStr()
    );
    const closedDate = status === 'Completed' ? (input.closed_date ?? loan.closed_date ?? todayStr()) : null;
    await txn.runAsync(
      `UPDATE loans SET loan_amount = ?, tenure_type = ?, period = ?, interest_mode = ?,
       interest_rate = ?, interest_amount = ?, charges = ?, disbursal_date = ?,
       disbursal_amount = ?, emi_amount = ?, total_payable = ?, balance_amount = ?, status = ?,
       guarantor_name = ?, guarantor_phone = ?, closed_date = ?, notes = ?, emi_start_date = ?, monthly_type = ?, doc_uris = ?
       WHERE id = ?`,
      terms.loanAmount, input.tenure_type, input.period, terms.interestMode, input.interest_rate,
      terms.interestAmount, terms.charges, terms.disbursalDate, terms.disbursalAmount,
      terms.emiAmount, terms.totalPayable, balance, status,
      input.guarantor_name?.trim() ?? '', input.guarantor_phone?.trim() ?? '',
      closedDate,
      input.notes?.trim() ?? '', terms.emiStartDate,
      input.tenure_type === 'Monthly' ? (input.monthly_type ?? loan.monthly_type)?.trim() || 'Finance' : null,
      JSON.stringify(parseUriList(input.doc_uris ?? loan.doc_uris)), id
    );
  });
}

/** Manual status override (e.g. closing a loan with a settlement). */
export async function updateLoanStatus(id: number, status: LoanStatus): Promise<void> {
  await initDatabase();
  if (!LOAN_STATUSES.includes(status)) throw new Error(`Invalid status "${status}"`);
  const today = todayStr();
  const result = await db.runAsync(
    `UPDATE loans
     SET status = ?,
         closed_date = CASE WHEN ? = 'Completed' THEN COALESCE(closed_date, ?) ELSE NULL END
     WHERE id = ?`,
    status,
    status,
    today,
    id
  );
  if (result.changes === 0) throw new Error(`Loan #${id} not found`);
}

/** Deletes the loan and its payments (ON DELETE CASCADE). */
export async function deleteLoan(id: number): Promise<void> {
  await initDatabase();
  await db.runAsync('DELETE FROM loans WHERE id = ?', id);
}

/**
 * Promotes Active loans that are past their final installment (with money outstanding) to Overdue.
 * Never demotes: a loan the admin flagged Overdue stays Overdue until changed by hand or paid off.
 */
export async function refreshOverdueStatuses(todayDateStr: string = todayStr()): Promise<number> {
  await initDatabase();
  requireDate(todayDateStr, 'Today');
  const active = await db.getAllAsync<LoanRow>("SELECT * FROM loans WHERE status = 'Active' AND balance_amount > 0");
  const overdueIds = active
    .filter((loan) => isPastMaturity(loan.disbursal_date, loan.tenure_type, loan.period, todayDateStr, loan.emi_start_date))
    .map((loan) => loan.id);
  if (overdueIds.length === 0) return 0;
  await withWriteTransaction(async (txn) => {
    for (const id of overdueIds) {
      await txn.runAsync("UPDATE loans SET status = 'Overdue' WHERE id = ?", id);
    }
  });
  return overdueIds.length;
}

// ---------------------------------------------------------------------------
// Payments (Vasool)
// ---------------------------------------------------------------------------

/**
 * Records a collection and updates the loan's paid / balance / status atomically.
 * Extra charges (charges_amount) do not reduce loan balance.
 * Returns the new payment's id.
 */
export async function addPayment(input: PaymentInput): Promise<number> {
  const amount = roundMoney(input.amount ?? 0);
  const chargesAmount = roundMoney(input.charges_amount ?? 0);
  if (amount < 0 || !Number.isFinite(amount)) throw new Error('Payment amount cannot be negative');
  if (chargesAmount < 0 || !Number.isFinite(chargesAmount)) throw new Error('Charges amount cannot be negative');
  if (amount === 0 && chargesAmount === 0) {
    throw new Error('Payment amount or charges amount must be greater than zero');
  }

  const paymentDate = requireDate(input.payment_date, 'Payment date');
  if (!PAYMENT_MODES.includes(input.payment_mode)) throw new Error(`Invalid payment mode "${input.payment_mode}"`);

  return withWriteTransaction(async (txn) => {
    const loan = await txn.getFirstAsync<LoanRow>('SELECT * FROM loans WHERE id = ?', input.loan_id);
    if (!loan) throw new Error(`Loan #${input.loan_id} not found`);
    if (loan.balance_amount <= 0 && amount > 0) throw new Error('This loan is already fully paid');
    if (paymentDate < loan.disbursal_date) throw new Error('Payment date cannot be before the disbursal date');
    if (amount > loan.balance_amount) {
      throw new Error(`Amount exceeds the outstanding balance of ${loan.balance_amount}`);
    }

    const result = await txn.runAsync(
      `INSERT INTO payments (loan_id, customer_id, amount, charges_amount, payment_date, payment_mode, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      loan.id,
      loan.customer_id,
      amount,
      chargesAmount,
      paymentDate,
      input.payment_mode,
      input.notes?.trim() ?? ''
    );
    await recalculateLoan(txn, loan.id, paymentDate);
    return result.lastInsertRowId;
  });
}

/** Deletes a payment and recalculates the loan's paid / balance / status. */
export async function deletePayment(paymentId: number): Promise<void> {
  await withWriteTransaction(async (txn) => {
    const payment = await txn.getFirstAsync<PaymentRow>('SELECT * FROM payments WHERE id = ?', paymentId);
    if (!payment) throw new Error(`Payment #${paymentId} not found`);
    await txn.runAsync('DELETE FROM payments WHERE id = ?', paymentId);
    await recalculateLoan(txn, payment.loan_id);
  });
}

export async function getPaymentsByLoan(loanId: number): Promise<Payment[]> {
  await initDatabase();
  return db.getAllAsync<Payment>(
    `${PAYMENT_SELECT} WHERE p.loan_id = ? ORDER BY p.payment_date DESC, p.id DESC`,
    loanId
  );
}

export async function getRecentPayments(limit = 20): Promise<Payment[]> {
  await initDatabase();
  return db.getAllAsync<Payment>(`${PAYMENT_SELECT} ORDER BY p.payment_date DESC, p.id DESC LIMIT ?`, limit);
}

export async function getLoanReminders(loanId: number): Promise<LoanReminderNote[]> {
  await initDatabase();
  return db.getAllAsync<LoanReminderNote>(
    'SELECT * FROM loan_reminders WHERE loan_id = ? ORDER BY created_at DESC, id DESC', loanId
  );
}

export async function addLoanReminder(loanId: number, note: string): Promise<number> {
  await initDatabase();
  const result = await db.runAsync(
    "INSERT INTO loan_reminders (loan_id, note, created_at) VALUES (?, ?, datetime('now', 'localtime'))",
    loanId, requireText(note, 'Reminder note')
  );
  return result.lastInsertRowId;
}

export async function deleteLoanReminder(reminderId: number): Promise<void> {
  await initDatabase();
  await db.runAsync('DELETE FROM loan_reminders WHERE id = ?', reminderId);
}

// ---------------------------------------------------------------------------
// Dashboard & due logic
// ---------------------------------------------------------------------------

/**
 * Loans with a collection due on `todayDateStr`:
 * - an installment is scheduled that day, anchored to the EMI start date (Daily: every day;
 *   Weekly: every 7 days; Monthly: same day of month, clamped to month end), or
 * - the loan is past maturity with money outstanding (overdue loans are due every day).
 * Loans settled by a payment made that same day stay in the list so the day's collection is visible.
 */
export async function getTodayDueLoans(todayDateStr: string): Promise<DueLoan[]> {
  await initDatabase();
  const today = requireDate(todayDateStr, 'Today');
  const rows = await db.getAllAsync<Loan & { paid_today: number; charges_today: number }>(
    `SELECT l.*, c.name AS customer_name, c.phone AS customer_phone,
            COALESCE((SELECT SUM(p.charges_amount) FROM payments p WHERE p.loan_id = l.id), 0) AS total_charges_collected,
            COALESCE((SELECT SUM(p.amount) FROM payments p
                      WHERE p.loan_id = l.id AND p.payment_date = ?), 0) AS paid_today,
            COALESCE((SELECT SUM(p.charges_amount) FROM payments p
                      WHERE p.loan_id = l.id AND p.payment_date = ?), 0) AS charges_today
     FROM loans l
     JOIN customers c ON c.id = l.customer_id
     WHERE l.disbursal_date <= ?
       AND (l.status != 'Completed'
            OR EXISTS (SELECT 1 FROM payments p WHERE p.loan_id = l.id AND p.payment_date = ?))`,
    today,
    today,
    today,
    today
  );

  const due: DueLoan[] = [];
  for (const row of rows) {
    const paidToday = roundMoney(row.paid_today);
    const balanceAtStartOfDay = roundMoney(row.total_payable - row.paid_amount + paidToday);
    if (balanceAtStartOfDay <= 0) continue;

    const n = installmentNumberOn(row.disbursal_date, row.tenure_type, today, row.emi_start_date);
    const scheduled = n !== null && n <= row.period;
    const overdue = isPastMaturity(row.disbursal_date, row.tenure_type, row.period, today, row.emi_start_date);
    if (!scheduled && !overdue) continue;

    due.push({
      ...row,
      next_due_date: nextEmiDate(row),
      paid_today: paidToday,
      charges_today: roundMoney(row.charges_today),
      due_today: roundMoney(Math.min(row.emi_amount, balanceAtStartOfDay)),
      installment_number: scheduled ? n : null,
      is_overdue: overdue,
    });
  }

  return due.sort((a, b) => {
    const aPending = a.paid_today < a.due_today && a.balance_amount > 0;
    const bPending = b.paid_today < b.due_today && b.balance_amount > 0;

    // 1. Pending loans before already-collected loans
    if (aPending !== bPending) {
      return aPending ? -1 : 1;
    }

    // 2. Earliest due / most overdue first: next_due_date ASC
    const aDue = a.next_due_date ?? '9999-99-99';
    const bDue = b.next_due_date ?? '9999-99-99';
    const dueDiff = aDue.localeCompare(bDue);
    if (dueDiff !== 0) return dueDiff;

    // 3. Fallback: alphabetical by customer name
    return a.customer_name.localeCompare(b.customer_name);
  });
}

/** Also refreshes Active/Overdue statuses for `todayDateStr` before aggregating. */
export async function getDashboardStats(todayDateStr: string): Promise<DashboardStats> {
  await refreshOverdueStatuses(todayDateStr);

  const [totals, collected, dueLoans] = await Promise.all([
    db.getFirstAsync<{ count: number; principal: number; balance: number; overdue: number }>(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(loan_amount), 0) AS principal,
              COALESCE(SUM(total_payable - paid_amount), 0) AS balance,
              COALESCE(SUM(CASE WHEN status = 'Overdue' THEN 1 ELSE 0 END), 0) AS overdue
       FROM loans WHERE status != 'Completed'`
    ),
    db.getFirstAsync<{ total: number; charges: number }>(
      `SELECT COALESCE(SUM(amount + COALESCE(charges_amount, 0)), 0) AS total,
              COALESCE(SUM(charges_amount), 0) AS charges FROM payments WHERE payment_date = ?`,
      todayDateStr
    ),
    getTodayDueLoans(todayDateStr),
  ]);

  return {
    totalActiveLoans: totals?.count ?? 0,
    totalPrincipalOut: roundMoney(totals?.principal ?? 0),
    totalBalancePending: roundMoney(totals?.balance ?? 0),
    todayTargetCollection: roundMoney(dueLoans.reduce((sum, l) => sum + l.due_today, 0)),
    todayCollectedAmount: roundMoney(collected?.total ?? 0),
    todayChargesCollected: roundMoney(collected?.charges ?? 0),
    overdueLoansCount: totals?.overdue ?? 0,
  };
}

function dateRange(column: string, fromDate?: string, toDate?: string) {
  if (fromDate !== undefined) requireDate(fromDate, 'From date');
  if (toDate !== undefined) requireDate(toDate, 'To date');
  if (fromDate && toDate && fromDate > toDate) throw new Error('From date cannot be after to date');
  const conditions: string[] = [];
  const params: string[] = [];
  if (fromDate) {
    conditions.push(`${column} >= ?`);
    params.push(fromDate);
  }
  if (toDate) {
    conditions.push(`${column} <= ?`);
    params.push(toDate);
  }
  return { conditions, params };
}

function prepareExpense(input: ExpenseInput) {
  const mode = input.payment_mode ?? 'Cash';
  if (!PAYMENT_MODES.includes(mode)) throw new Error(`Invalid payment mode "${mode}"`);
  return [
    requireText(input.title, 'Title'), requireText(input.category, 'Category'),
    requirePositive(roundMoney(input.amount), 'Expense amount'),
    requireDate(input.expense_date, 'Expense date'), mode, input.notes?.trim() ?? '',
  ];
}

export async function addExpense(input: ExpenseInput): Promise<number> {
  await initDatabase();
  const result = await db.runAsync(
    'INSERT INTO expenses (title, category, amount, expense_date, payment_mode, notes) VALUES (?, ?, ?, ?, ?, ?)',
    prepareExpense(input)
  );
  return result.lastInsertRowId;
}

export async function updateExpense(id: number, input: ExpenseInput): Promise<void> {
  await initDatabase();
  const result = await db.runAsync(
    'UPDATE expenses SET title = ?, category = ?, amount = ?, expense_date = ?, payment_mode = ?, notes = ? WHERE id = ?',
    [...prepareExpense(input), id]
  );
  if (result.changes === 0) throw new Error(`Expense #${id} not found`);
}

export async function deleteExpense(id: number): Promise<void> {
  await initDatabase();
  await db.runAsync('DELETE FROM expenses WHERE id = ?', id);
}

/** Inclusive optional date bounds; literal substring search in title, category and notes. */
export async function getExpenses(fromDate?: string, toDate?: string, searchQuery?: string): Promise<Expense[]> {
  await initDatabase();
  const { conditions, params } = dateRange('expense_date', fromDate, toDate);
  const query = searchQuery?.trim();
  if (query) {
    conditions.push("(title LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')");
    const pattern = likePattern(query);
    params.push(pattern, pattern, pattern);
  }
  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY expense_date DESC, id DESC`, params
  );
}

/**
 * Inclusive bounds apply to each record's own business date, not created_at.
 * Upfront interest is recognized once at disbursal. Other interest is recognized
 * proportionally on repayments, with the remainder recognized at completion.
 * Charges are reported separately and are never included in collected interest.
 */
export async function getFinanceReport(fromDate?: string, toDate?: string): Promise<FinanceReport> {
  await initDatabase();
  const loans = dateRange('disbursal_date', fromDate, toDate);
  const payments = dateRange('p.payment_date', fromDate, toDate);
  const expenses = dateRange('expense_date', fromDate, toDate);
  const where = (range: ReturnType<typeof dateRange>) =>
    range.conditions.length ? `WHERE ${range.conditions.join(' AND ')}` : '';
  // Cumulative recognition through the end minus recognition before the start
  // keeps adjacent reporting ranges additive, even for settlements/overpayments.
  const interestParams: string[] = [];
  const interestAsOf = (date?: string, before = false): string => {
    const interest = 'MAX(0, l.interest_amount)';
    let upfront = '1';
    let completed = "l.status = 'Completed'";
    let paid = 'l.paid_amount';
    if (date) {
      const op = before ? '<' : '<=';
      upfront = `l.disbursal_date ${op} ?`;
      completed += ` AND COALESCE(l.closed_date,
        (SELECT MAX(payment_date) FROM payments WHERE loan_id = l.id), l.disbursal_date) ${op} ?`;
      paid = `(SELECT COALESCE(SUM(amount), 0) FROM payments WHERE loan_id = l.id AND payment_date ${op} ?)`;
      interestParams.push(date, date, date);
    }
    return `CASE WHEN l.interest_mode = 'DeductUpfront' THEN CASE WHEN ${upfront} THEN ${interest} ELSE 0 END
      WHEN ${completed} THEN ${interest}
      WHEN l.total_payable > 0 THEN MIN(${interest}, ${interest} * (MIN(MAX(0, ${paid}), l.total_payable) / l.total_payable))
      ELSE 0 END`;
  };
  const interestThroughEnd = interestAsOf(toDate);
  const interestBeforeStart = fromDate ? interestAsOf(fromDate, true) : '0';
  // One statement gives all aggregates the same SQLite snapshot without loading full tables.
  const report = await db.getFirstAsync<FinanceReport>(
    `SELECT * FROM
     (SELECT COALESCE(SUM(disbursal_amount), 0) AS totalDisbursedAmount,
             COALESCE(SUM(loan_amount), 0) AS totalPrincipalLoaned,
             COALESCE(SUM(charges), 0) AS totalDocumentCharges,
             COALESCE(SUM(interest_amount), 0) AS totalInterestExpected,
             COUNT(*) AS loansCount FROM loans ${where(loans)}),
     (SELECT COALESCE(SUM(p.amount + COALESCE(p.charges_amount, 0)), 0) AS totalPaymentsCollected,
             COUNT(*) AS paymentsCount FROM payments p JOIN loans l ON l.id = p.loan_id ${where(payments)}),
     (SELECT COALESCE(SUM(MAX(0, (${interestThroughEnd}) - (${interestBeforeStart}))), 0) AS totalInterestCollected FROM loans l),
     (SELECT COALESCE(SUM(amount), 0) AS totalExpenses,
             COUNT(*) AS expensesCount FROM expenses ${where(expenses)})`,
    [...loans.params, ...payments.params, ...interestParams, ...expenses.params]
  );
  if (!report) throw new Error('Could not calculate finance report');
  return {
    ...report,
    totalDisbursedAmount: roundMoney(report.totalDisbursedAmount),
    totalPrincipalLoaned: roundMoney(report.totalPrincipalLoaned),
    totalDocumentCharges: roundMoney(report.totalDocumentCharges),
    totalInterestExpected: roundMoney(report.totalInterestExpected),
    totalInterestCollected: roundMoney(report.totalInterestCollected),
    totalPaymentsCollected: roundMoney(report.totalPaymentsCollected),
    totalExpenses: roundMoney(report.totalExpenses),
  };
}

export async function getTableCounts(): Promise<TableCounts> {
  await initDatabase();
  const row = await db.getFirstAsync<TableCounts>(
    `SELECT (SELECT COUNT(*) FROM customers) AS customers,
            (SELECT COUNT(*) FROM loans) AS loans,
            (SELECT COUNT(*) FROM payments) AS payments,
            (SELECT COUNT(*) FROM expenses) AS expenses`
  );
  return row ?? { customers: 0, loans: 0, payments: 0, expenses: 0 };
}

// ---------------------------------------------------------------------------
// Backup & restore
// ---------------------------------------------------------------------------

export async function exportDatabaseToJson(): Promise<BackupData> {
  await initDatabase();
  const [customers, loans, payments, expenses, loanReminders] = await Promise.all([
    db.getAllAsync<Customer>('SELECT * FROM customers ORDER BY id'),
    db.getAllAsync<LoanRow>('SELECT * FROM loans ORDER BY id'),
    db.getAllAsync<PaymentRow>('SELECT * FROM payments ORDER BY id'),
    db.getAllAsync<Expense>('SELECT * FROM expenses ORDER BY id'),
    db.getAllAsync<LoanReminderNote>('SELECT * FROM loan_reminders ORDER BY id'),
  ]);
  return {
    app: 'FinanceTracker',
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    customers,
    loans,
    payments,
    expenses,
    loan_reminders: loanReminders,
  };
}

type FieldSpec = 'id' | 'number' | 'text' | 'requiredText' | 'date' | 'nullableDate' | 'nullableText' | readonly string[];

const CUSTOMER_FIELDS = {
  id: 'id',
  name: 'requiredText',
  phone: 'text',
  alternate_phone: 'text',
  address: 'text',
  photo_uri: 'text',
  kyc_type: 'text',
  kyc_number: 'text',
  kyc_doc_uri: 'text',
  guarantor_name: 'text',
  guarantor_phone: 'text',
  notes: 'text',
  created_at: 'text',
} satisfies Record<keyof Customer, FieldSpec>;

const LOAN_FIELDS = {
  id: 'id',
  customer_id: 'id',
  loan_amount: 'number',
  tenure_type: TENURE_TYPES,
  monthly_type: 'nullableText',
  doc_uris: 'text',
  period: 'id',
  interest_rate: 'number',
  interest_amount: 'number',
  interest_mode: INTEREST_MODES,
  charges: 'number',
  disbursal_date: 'date',
  emi_start_date: 'nullableDate',
  disbursal_amount: 'number',
  emi_amount: 'number',
  total_payable: 'number',
  paid_amount: 'number',
  balance_amount: 'number',
  status: LOAN_STATUSES,
  guarantor_name: 'text',
  guarantor_phone: 'text',
  closed_date: 'nullableText',
  notes: 'text',
  created_at: 'text',
} satisfies Record<keyof LoanRow, FieldSpec>;

const PAYMENT_FIELDS = {
  id: 'id',
  loan_id: 'id',
  customer_id: 'id',
  amount: 'number',
  charges_amount: 'number',
  payment_date: 'date',
  payment_mode: PAYMENT_MODES,
  notes: 'text',
  created_at: 'text',
} satisfies Record<keyof PaymentRow, FieldSpec>;

const EXPENSE_FIELDS = {
  id: 'id', title: 'requiredText', category: 'requiredText', amount: 'number',
  expense_date: 'date', payment_mode: PAYMENT_MODES, notes: 'text', created_at: 'text',
} satisfies Record<keyof Expense, FieldSpec>;

const REMINDER_FIELDS = {
  id: 'id', loan_id: 'id', note: 'requiredText', created_at: 'requiredText',
} satisfies Record<keyof LoanReminderNote, FieldSpec>;

type SqlRow = Record<string, string | number | null>;

function sanitizeRows(raw: unknown, fields: Record<string, FieldSpec>, table: string): SqlRow[] {
  if (!Array.isArray(raw)) throw new Error(`Backup is missing the "${table}" list`);
  const seen = new Set<number>();
  return raw.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new Error(`${table}[${index}] is not an object`);
    const source = item as Record<string, unknown>;
    const row: SqlRow = {};
    for (const [key, spec] of Object.entries(fields)) {
      const value = source[key];
      const fail = (why: string): never => {
        throw new Error(`${table}[${index}].${key} ${why}`);
      };
      if (Array.isArray(spec)) {
        if (typeof value !== 'string' || !spec.includes(value)) fail(`must be one of ${spec.join(', ')}`);
        row[key] = value as string;
      } else if (spec === 'id') {
        if (!Number.isInteger(value) || (value as number) <= 0) fail('must be a positive integer');
        row[key] = value as number;
      } else if (spec === 'number') {
        if ((value === undefined || value === null) && key === 'charges_amount') {
          row[key] = 0;
        } else {
          if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a number');
          row[key] = value as number;
        }
      } else if (spec === 'date') {
        if (typeof value !== 'string' || !isValidDateStr(value)) fail('must be a YYYY-MM-DD date');
        row[key] = value as string;
      } else if (spec === 'nullableText' || spec === 'nullableDate') {
        if (value === null || value === undefined || value === '') {
          row[key] = null;
        } else if (typeof value === 'string') {
          if (spec === 'nullableDate' && !isValidDateStr(value)) fail('must be a YYYY-MM-DD date or null');
          row[key] = value;
        } else {
          fail('must be a string or null');
        }
      } else {
        const text = value == null ? '' : String(value);
        if (spec === 'requiredText' && !text.trim()) fail('is required');
        row[key] = key === 'doc_uris' ? JSON.stringify(parseUriList(text)) : text;
      }
    }
    const id = row.id as number;
    if (seen.has(id)) throw new Error(`${table} contains duplicate id ${id}`);
    seen.add(id);
    return row;
  });
}

async function insertRows(txn: SQLiteDatabase, table: string, rows: SqlRow[]): Promise<void> {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const statement = await txn.prepareAsync(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  );
  try {
    for (const row of rows) {
      await statement.executeAsync(columns.map((c) => row[c]));
    }
  } finally {
    await statement.finalizeAsync();
  }
}

/** Parses and fully validates a backup (object or JSON string) without touching the database. */
function validateBackup(jsonData: unknown) {
  let data: unknown = jsonData;
  if (typeof jsonData === 'string') {
    try {
      data = JSON.parse(jsonData);
    } catch {
      throw new Error('The file is not valid JSON, so it cannot be a FinanceTracker backup');
    }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Backup file is not a JSON object');
  }
  const backup = data as Partial<Record<keyof BackupData, unknown>>;
  if (backup.app !== undefined && backup.app !== 'FinanceTracker') throw new Error('This is not a FinanceTracker backup');
  if (typeof backup.version !== 'number' || !Number.isInteger(backup.version) || backup.version < 1 || backup.version > BACKUP_VERSION) {
    throw new Error(`Unsupported backup version ${String(backup.version)}`);
  }

  const customers = sanitizeRows(backup.customers, CUSTOMER_FIELDS, 'customers');
  // v1 backups predate interest_mode; those loans were all "add to total".
  const rawLoans = Array.isArray(backup.loans)
    ? backup.loans.map((loan: unknown) =>
        typeof loan === 'object' && loan !== null && !('interest_mode' in loan)
          ? { ...loan, interest_mode: 'AddToTotal' }
          : loan
      )
    : backup.loans;
  const loans = sanitizeRows(rawLoans, LOAN_FIELDS, 'loans');
  const payments = sanitizeRows(backup.payments, PAYMENT_FIELDS, 'payments');
  const expenses = sanitizeRows(backup.version < 3 ? [] : backup.expenses, EXPENSE_FIELDS, 'expenses');
  const loanReminders = sanitizeRows(backup.loan_reminders === undefined ? [] : backup.loan_reminders, REMINDER_FIELDS, 'loan_reminders');
  for (const expense of expenses) {
    requirePositive(expense.amount as number, `Expense #${expense.id} amount`);
  }

  const customerIds = new Set(customers.map((c) => c.id));
  const loanCustomer = new Map(loans.map((l) => [l.id, l.customer_id]));
  for (const loan of loans) {
    if (loan.emi_start_date && loan.emi_start_date < (loan.disbursal_date as string)) {
      throw new Error(`Loan #${loan.id} EMI start date cannot be before disbursal`);
    }
    if (!customerIds.has(loan.customer_id)) {
      throw new Error(`Loan #${loan.id} references missing customer #${loan.customer_id}`);
    }
  }
  for (const reminder of loanReminders) {
    if (!loanCustomer.has(reminder.loan_id)) {
      throw new Error(`Reminder #${reminder.id} references missing loan #${reminder.loan_id}`);
    }
  }
  for (const payment of payments) {
    const owner = loanCustomer.get(payment.loan_id as number);
    if (owner === undefined) throw new Error(`Payment #${payment.id} references missing loan #${payment.loan_id}`);
    if (owner !== payment.customer_id) {
      throw new Error(`Payment #${payment.id} customer does not match loan #${payment.loan_id}`);
    }
  }

  const exportedAt = typeof backup.exported_at === 'string' ? backup.exported_at : null;
  return { version: backup.version, exportedAt, customers, loans, payments, expenses, loanReminders };
}

/**
 * Validates a backup and describes it, for showing a confirmation before restoring.
 * Throws with a readable message if the file is not a valid backup.
 */
export function inspectBackup(jsonData: unknown): BackupSummary {
  const { version, exportedAt, customers, loans, payments, expenses } = validateBackup(jsonData);
  return {
    version,
    exportedAt,
    counts: { customers: customers.length, loans: loans.length, payments: payments.length, expenses: expenses.length },
  };
}

/**
 * Replaces all data with the contents of a backup (object or JSON string).
 * Everything is validated first and written in a single transaction, so a bad file leaves the DB untouched.
 */
export async function importDatabaseFromJson(jsonData: unknown): Promise<TableCounts> {
  const { customers, loans, payments, expenses, loanReminders } = validateBackup(jsonData);

  await withWriteTransaction(async (txn) => {
    await txn.execAsync('DELETE FROM loan_reminders; DELETE FROM expenses; DELETE FROM payments; DELETE FROM loans; DELETE FROM customers;');
    await insertRows(txn, 'customers', customers);
    await insertRows(txn, 'loans', loans);
    await insertRows(txn, 'payments', payments);
    await insertRows(txn, 'expenses', expenses);
    await insertRows(txn, 'loan_reminders', loanReminders);
    // Re-derive totals from the restored payments so balances are always consistent.
    await txn.execAsync(`
      UPDATE loans SET paid_amount = ROUND(COALESCE((SELECT SUM(amount) FROM payments WHERE loan_id = loans.id), 0), 2);
      UPDATE loans SET balance_amount = MAX(0, ROUND(total_payable - paid_amount, 2));
      UPDATE loans SET status = 'Completed' WHERE balance_amount <= 0;
      UPDATE loans SET closed_date = COALESCE(closed_date, (SELECT MAX(payment_date) FROM payments WHERE loan_id = loans.id), disbursal_date) WHERE status = 'Completed' AND closed_date IS NULL;
    `);
  });

  return { customers: customers.length, loans: loans.length, payments: payments.length, expenses: expenses.length };
}

/** Deletes all records, including expenses, and restarts ids from 1. */
export async function clearAllData(): Promise<void> {
  await withWriteTransaction(async (txn) => {
    await txn.execAsync(`
      DELETE FROM loan_reminders;
      DELETE FROM expenses;
      DELETE FROM payments;
      DELETE FROM loans;
      DELETE FROM customers;
      DELETE FROM sqlite_sequence WHERE name IN ('loan_reminders', 'expenses', 'payments', 'loans', 'customers');
    `);
  });
}
