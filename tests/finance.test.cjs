// Run with Node 22.13+ (node:sqlite): node --test tests/finance.test.cjs
const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const project = path.resolve(__dirname, '..');
const directory = mkdtempSync(path.join(tmpdir(), 'finance-tracker-test-'));
const connections = [];
let sequence = 0;

// Execute the app's actual database functions against real SQLite. Only the Expo
// native transport is replaced; SQL, migrations, validation and transactions run unchanged.
function sqliteConnection(file) {
  const sql = new DatabaseSync(file);
  connections.push(sql);
  const params = (args) => Array.isArray(args[0]) ? args[0] : args;
  return {
    execAsync: async (source) => sql.exec(source),
    getFirstAsync: async (source, ...args) => {
      const row = sql.prepare(source).get(...params(args));
      return row ? { ...row } : null;
    },
    getAllAsync: async (source, ...args) => sql.prepare(source).all(...params(args)).map((row) => ({ ...row })),
    runAsync: async (source, ...args) => {
      const result = sql.prepare(source).run(...params(args));
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowid };
    },
    prepareAsync: async (source) => {
      const statement = sql.prepare(source);
      return { executeAsync: async (...args) => statement.run(...params(args)), finalizeAsync: async () => {} };
    },
    closeAsync: async () => sql.close(),
  };
}

function loadApp(file, overrides = {}) {
  const modules = new Map();
  const sqlite = { openDatabaseSync: () => sqliteConnection(file), openDatabaseAsync: async () => sqliteConnection(file) };
  function load(relative) {
    const filename = path.join(project, relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const mod = new Module(filename, module);
    modules.set(filename, mod);
    mod.paths = module.paths;
    mod.require = (id) => {
      if (Object.hasOwn(overrides, id)) return overrides[id];
      if (id === 'expo-sqlite') return sqlite;
      if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`);
      return require(id);
    };
    mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filename,
    }).outputText, filename);
    return mod.exports;
  }
  return { db: load('src/db/database.ts'), schedule: load('src/utils/loanCalculations.ts'), load };
}

function freshApp(overrides) {
  return loadApp(path.join(directory, `${++sequence}.db`), overrides);
}

const customerInput = { name: 'Borrower', phone: '9876543210' };
const loanInput = (customer_id, overrides = {}) => ({
  customer_id, loan_amount: 1000, tenure_type: 'Daily', period: 10,
  interest_rate: 10, charges: 20, disbursal_date: '2026-10-01', status: 'Active', ...overrides,
});
const expenseInput = (overrides = {}) => ({
  title: 'Office rent', category: 'Office', amount: 250, expense_date: '2026-10-10', ...overrides,
});

after(() => {
  for (const sql of connections) { try { sql.close(); } catch { /* Already closed by transaction helper. */ } }
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('finance-tracker-test-'));
  rmSync(directory, { recursive: true, force: true });
});

for (const version of [1, 2]) {
  test(`schema v${version} upgrades to v6 without losing existing records`, async () => {
    const file = path.join(directory, `${++sequence}.db`);
    const sql = new DatabaseSync(file);
    const source = readFileSync(path.join(project, 'src/db/database.ts'), 'utf8');
    sql.exec(source.match(/const SCHEMA = `([\s\S]*?)`;/)[1]);
    if (version === 2) sql.exec("ALTER TABLE loans ADD COLUMN interest_mode TEXT NOT NULL DEFAULT 'AddToTotal'");
    sql.exec(`INSERT INTO customers (id, name) VALUES (1, 'Existing');
      INSERT INTO loans (id, customer_id, loan_amount, tenure_type, period, disbursal_date,
        disbursal_amount, emi_amount, total_payable, balance_amount)
      VALUES (1, 1, 1000, 'Monthly', 10, '2026-01-31', 1000, 100, 1000, 1000);
      PRAGMA user_version = ${version};`);
    const { db } = loadApp(file);
    await Promise.all([db.initDatabase(), db.initDatabase()]);
    assert.equal(sql.prepare('PRAGMA user_version').get().user_version, 6);
    assert.equal((await db.getLoanById(1)).emi_start_date, null);
    assert.equal((await db.getCustomerById(1)).photo_uri, '');
    assert.deepEqual(await db.getLoanReminders(1), []);
    assert.equal((await db.getLoanById(1)).interest_mode, 'AddToTotal');
    assert.equal((await db.getCustomerById(1)).name, 'Existing');
    await db.addExpense(expenseInput());
    assert.equal((await db.getTableCounts()).expenses, 1);
    sql.close();
  });
}

test('expense CRUD validates inputs and supports inclusive/open bounds and literal search', async () => {
  const { db } = freshApp();
  const id = await db.addExpense(expenseInput({ title: '100% stationery', notes: 'A_B' }));
  await db.addExpense(expenseInput({ expense_date: '2026-10-11' }));
  assert.equal((await db.getExpenses('2026-10-10', '2026-10-10', '%')).length, 1);
  assert.equal((await db.getExpenses(undefined, undefined, 'A_B')).length, 1);
  assert.equal((await db.getExpenses('2026-10-11')).length, 1);
  assert.equal((await db.getExpenses(undefined, '2026-10-10')).length, 1);
  assert.equal((await db.getExpenses())[0].payment_mode, 'Cash');
  await db.updateExpense(id, expenseInput({ amount: 500, payment_mode: 'UPI' }));
  assert.equal((await db.getExpenses(undefined, undefined, 'rent')).find((e) => e.id === id).amount, 500);
  await assert.rejects(db.addExpense(expenseInput({ amount: 0 })), /greater than zero/);
  await assert.rejects(db.addExpense(expenseInput({ title: ' ' })), /Title is required/);
  await assert.rejects(db.addExpense(expenseInput({ expense_date: '2026-02-30' })), /valid/);
  await assert.rejects(db.getExpenses('2026-11-01', '2026-10-01'), /From date/);
  await assert.rejects(db.updateExpense(999, expenseInput()), /not found/);
  await db.deleteExpense(id);
  assert.equal((await db.getExpenses()).length, 1);
});

test('loan edits preserve payments, reject invalid reductions/dates, complete and reopen correctly', async () => {
  const { db } = freshApp();
  const customer = await db.addCustomer(customerInput);
  const input = loanInput(customer);
  const id = await db.addLoan(input);
  await db.addPayment({ loan_id: id, amount: 400, payment_date: '2026-10-02', payment_mode: 'Cash' });
  await db.updateLoan(id, { ...input, loan_amount: 2000, interest_rate: 20, period: 12, notes: 'Revised' });
  let loan = await db.getLoanById(id);
  assert.equal(loan.total_payable, 2400);
  assert.equal(loan.paid_amount, 400);
  assert.equal(loan.balance_amount, 2000);
  assert.equal(loan.notes, 'Revised');
  assert.equal((await db.getPaymentsByLoan(id)).length, 1);
  await assert.rejects(db.updateLoan(id, { ...input, total_payable: 399 }), /already paid/);
  assert.equal((await db.getLoanById(id)).total_payable, 2400);
  await assert.rejects(db.updateLoan(id, { ...input, disbursal_date: '2026-10-03' }), /existing payment/);
  await db.updateLoan(id, { ...input, total_payable: 400, status: 'Active' });
  loan = await db.getLoanById(id);
  assert.equal(loan.balance_amount, 0);
  assert.equal(loan.status, 'Completed');
  const { status: _status, ...deriveInput } = input;
  await db.updateLoan(id, { ...deriveInput, period: 10000 });
  assert.equal((await db.getLoanById(id)).status, 'Active');
  await assert.rejects(db.updateLoan(999, input), /not found/);
});

test('customer aggregates distinguish active principal from lifetime borrowing and sum all balances', async () => {
  const { db } = freshApp();
  const customer = await db.addCustomer({ ...customerInput, name: '100% Borrower' });
  await db.addCustomer({ ...customerInput, name: 'No loans' });
  await db.addLoan(loanInput(customer));
  await db.addLoan(loanInput(customer, { loan_amount: 2000, status: 'Overdue' }));
  await db.addLoan(loanInput(customer, { loan_amount: 500, status: 'Completed' }));
  const [summary] = await db.getCustomers('%');
  assert.equal(summary.active_loans, 2);
  assert.equal(summary.total_borrowed, 3500);
  assert.equal(summary.active_borrowed, 3000);
  assert.equal(summary.balance_due, 3850);
  assert.equal((await db.getCustomers('No loans'))[0].active_borrowed, 0);
});

test('reports use each record date, include older repayments and recognize upfront interest at disbursal', async () => {
  const { db } = freshApp();
  const customer = await db.addCustomer(customerInput);
  const older = await db.addLoan(loanInput(customer, { disbursal_date: '2026-09-01' }));
  const current = await db.addLoan(loanInput(customer, { interest_mode: 'DeductUpfront' }));
  await db.addPayment({ loan_id: older, amount: 110, payment_date: '2026-10-01', payment_mode: 'Cash' });
  await db.addPayment({ loan_id: current, amount: 100, payment_date: '2026-10-31', payment_mode: 'UPI' });
  await db.addPayment({ loan_id: older, amount: 110, payment_date: '2026-11-01', payment_mode: 'Cash' });
  await db.addExpense(expenseInput());
  await db.addExpense(expenseInput({ expense_date: '2026-11-01' }));
  assert.deepEqual(await db.getFinanceReport('2026-10-01', '2026-10-31'), {
    totalDisbursedAmount: 880, totalPrincipalLoaned: 1000, totalDocumentCharges: 20,
    totalInterestExpected: 100, totalInterestCollected: 110, totalPaymentsCollected: 210,
    totalExpenses: 250, loansCount: 1, paymentsCount: 2, expensesCount: 1,
  });
  assert.equal((await db.getFinanceReport()).totalPaymentsCollected, 320);
  assert.equal((await db.getFinanceReport(undefined, '2026-09-30')).totalExpenses, 0);
  assert.equal((await db.getFinanceReport('2027-01-01')).loansCount, 0);
  await assert.rejects(db.getFinanceReport('bad'), /valid/);
});

test('current backup round trips expenses, old backups import, invalid restore leaves data intact and clear resets ids', async () => {
  const { db } = freshApp();
  const customer = await db.addCustomer(customerInput);
  const loan = await db.addLoan(loanInput(customer));
  await db.addPayment({ loan_id: loan, amount: 110, payment_date: '2026-10-02', payment_mode: 'Cash' });
  await db.addExpense(expenseInput());
  const backup = await db.exportDatabaseToJson();
  assert.equal(backup.version, db.BACKUP_VERSION);
  assert.equal(db.inspectBackup(backup).counts.expenses, 1);
  await db.clearAllData();
  await db.importDatabaseFromJson(JSON.stringify(backup));
  assert.equal((await db.getExpenses())[0].amount, 250);
  assert.equal((await db.getLoanById(loan)).balance_amount, 990);
  const invalid = { ...backup, expenses: [{ ...backup.expenses[0], amount: -1 }] };
  await assert.rejects(db.importDatabaseFromJson(invalid), /greater than zero/);
  await assert.rejects(db.importDatabaseFromJson({ ...backup, expenses: undefined }), /expenses/);
  assert.equal((await db.getTableCounts()).expenses, 1);
  // Also exercise rollback after validation succeeds but a SQLite constraint fails.
  await assert.rejects(db.importDatabaseFromJson({ ...backup, loans: [{ ...backup.loans[0], loan_amount: -1 }] }));
  assert.equal((await db.getTableCounts()).expenses, 1);
  for (const version of [1, 2]) {
    const oldLoan = { ...backup.loans[0] };
    if (version === 1) delete oldLoan.interest_mode;
    await db.importDatabaseFromJson({ ...backup, version, loans: [oldLoan], expenses: undefined });
    assert.equal((await db.getTableCounts()).expenses, 0);
    assert.equal((await db.getLoanById(loan)).interest_mode, 'AddToTotal');
  }
  await db.addExpense(expenseInput());
  await db.clearAllData();
  assert.deepEqual(await db.getTableCounts(), { customers: 0, loans: 0, payments: 0, expenses: 0 });
  assert.equal(await db.addExpense(expenseInput()), 1);
});

test('EMI schedule handles partial/advance payments, overdue dates, month ends and final rounded EMI', () => {
  const { schedule } = freshApp();
  const loan = { disbursal_date: '2024-01-31', tenure_type: 'Monthly', period: 3,
    emi_amount: 334, paid_amount: 333, balance_amount: 667, status: 'Active' };
  assert.equal(schedule.paidInstallments(loan), 0);
  assert.equal(schedule.nextEmiDate(loan), '2024-02-29');
  assert.equal(schedule.nextEmiDate({ ...loan, paid_amount: 668 }), '2024-04-29');
  assert.equal(schedule.nextEmiDate({ ...loan, status: 'Overdue' }), '2024-02-29');
  assert.equal(schedule.nextEmiDate({ ...loan, status: 'Completed' }), null);
  assert.equal(schedule.paidInstallments({ ...loan, paid_amount: 1000, balance_amount: 0 }), 3);
  assert.equal(schedule.installmentsElapsed('2024-01-31', 'Monthly', 3, '2024-02-28'), 0);
  assert.equal(schedule.installmentsElapsed('2024-01-31', 'Monthly', 3, '2024-02-29'), 1);
  assert.equal(schedule.installmentsElapsed('2024-01-31', 'Monthly', 3, '2025-01-01'), 3);
  assert.equal(schedule.nextEmiDate({ ...loan, tenure_type: 'Weekly' }), '2024-02-07');
  assert.equal(schedule.nextEmiDate({ ...loan, tenure_type: 'Daily' }), '2024-02-01');
  const elapsed = schedule.installmentsElapsed('2026-10-01', 'Daily', 100, '2026-10-08');
  const paid = schedule.paidInstallments({ period: 100, emi_amount: 100, paid_amount: 500, balance_amount: 9500 });
  assert.equal(Math.max(0, elapsed - paid), 2);
});

test('report presets cover full calendar months including leap years, reset, and reject reversed ranges', () => {
  const { load } = freshApp();
  const reporting = load('src/utils/reporting.ts');
  assert.deepEqual(reporting.presetDateRange('This Month', '2024-02-15'), {
    preset: 'This Month', fromDate: '2024-02-01', toDate: '2024-02-29',
  });
  assert.deepEqual(reporting.presetDateRange('This Month', '2026-12-01'), {
    preset: 'This Month', fromDate: '2026-12-01', toDate: '2026-12-31',
  });
  assert.deepEqual(reporting.presetDateRange('Today', '2026-10-26'), {
    preset: 'Today', fromDate: '2026-10-26', toDate: '2026-10-26',
  });
  assert.deepEqual(reporting.presetDateRange('All Time'), { preset: 'All Time' });
  assert.equal(reporting.dateRangeError({ fromDate: '2026-10-02', toDate: '2026-10-01' }), 'From date cannot be after to date');
  assert.equal(reporting.dateRangeError({ fromDate: '2026-02-30' }), 'From date must be a valid date');
  assert.equal(reporting.dateRangeError({ toDate: '2026-10-26' }), null);
  assert.equal(reporting.dateRangeError({ fromDate: '2026-10-26', toDate: '2026-10-26' }), null);
});

test('expense form handles required/custom fields, sub-cent amounts, invalid dates and updates filtered totals immediately', async () => {
  const { db, load } = freshApp();
  const form = load('src/utils/expenseForm.ts');
  const values = { title: ' Custom expense ', category: ' Insurance ', amount: '1,234.567',
    expense_date: '2026-10-26', payment_mode: 'UPI', notes: ' Renewed ' };
  assert.deepEqual(form.expenseInputFromForm(values), {
    title: 'Custom expense', category: 'Insurance', amount: 1234.57,
    expense_date: '2026-10-26', payment_mode: 'UPI', notes: 'Renewed',
  });
  assert.equal(Object.keys(form.expenseFormErrors({ ...values, title: '', category: ' ', amount: '0.001',
    expense_date: 'bad', payment_mode: 'Card' })).length, 5);
  for (const amount of ['0', '-1', 'Infinity', 'word', '1.2.3', '']) {
    assert.throws(() => form.expenseInputFromForm({ ...values, amount }), /greater than zero/);
  }
  const id = await db.addExpense(form.expenseInputFromForm(values));
  assert.equal((await db.getFinanceReport('2026-10-26', '2026-10-26')).totalExpenses, 1234.57);
  await db.updateExpense(id, form.expenseInputFromForm({ ...values, amount: '250', expense_date: '2026-11-01' }));
  assert.equal((await db.getExpenses('2026-10-01', '2026-10-31')).length, 0);
  assert.equal((await db.getFinanceReport()).totalExpenses, 250);
  await db.deleteExpense(id);
  assert.equal((await db.getFinanceReport()).totalExpenses, 0);
});

test('net earnings and cash flow follow the requested formulas including negative and zero results', () => {
  const { load } = freshApp();
  const { earningsSummary } = load('src/utils/reporting.ts');
  const base = { totalDocumentCharges: 50, totalInterestCollected: 20, totalExpenses: 100,
    totalPaymentsCollected: 150, totalDisbursedAmount: 500 };
  assert.deepEqual(earningsSummary(base), { netEarnings: -30, netCashflow: -450 });
  assert.deepEqual(earningsSummary({ ...base, totalExpenses: 10, totalDisbursedAmount: 100 }), {
    netEarnings: 60, netCashflow: 40,
  });
  assert.deepEqual(earningsSummary({ totalDocumentCharges: 0, totalInterestCollected: 0, totalExpenses: 0,
    totalPaymentsCollected: 0, totalDisbursedAmount: 0 }), { netEarnings: 0, netCashflow: 0 });
});

test('Excel round trip includes all five sheets, joined records, typed cells and totals matching the database', async () => {
  const XLSX = require('xlsx');
  const { db, load } = freshApp();
  const exporter = load('src/utils/excelWorkbook.ts');
  const name = '=HYPERLINK("https://example.com","borrower")';
  const customer = await db.addCustomer({ ...customerInput, name, phone: '00123456789',
    guarantor_name: 'Guarantor', guarantor_phone: '00987654321', address: 'Chennai', notes: 'Customer notes' });
  const active = await db.addLoan(loanInput(customer));
  await db.addLoan(loanInput(customer, { tenure_type: 'Weekly', status: 'Overdue', interest_mode: 'DeductUpfront' }));
  const completed = await db.addLoan(loanInput(customer, { interest_rate: 0 }));
  await db.addPayment({ loan_id: active, amount: 110, payment_date: '2026-10-02', payment_mode: 'Cash', notes: 'First EMI' });
  await db.updateLoanStatus(active, 'Active');
  await db.addPayment({ loan_id: completed, amount: 1000, payment_date: '2026-10-03', payment_mode: 'UPI' });
  await db.addExpense(expenseInput({ notes: 'Rent receipt' }));
  const backup = await db.exportDatabaseToJson();
  const report = await db.getFinanceReport();
  const workbook = XLSX.read(exporter.excelWorkbookBase64(backup), { type: 'base64', cellStyles: true, cellNF: true });
  assert.deepEqual(workbook.SheetNames, ['Summary_Report', 'Customers', 'Loans', 'Payments', 'Expenses']);
  const rows = (sheet) => XLSX.utils.sheet_to_json(workbook.Sheets[sheet]);
  const summary = Object.fromEntries(rows('Summary_Report').map((row) => [row.Metric, row.Value]));
  assert.equal(summary['Total Principal'], report.totalPrincipalLoaned);
  assert.equal(summary['Total Disbursed'], report.totalDisbursedAmount);
  assert.equal(summary['Document Charges'], report.totalDocumentCharges);
  assert.equal(summary['Interest Expected'], report.totalInterestExpected);
  assert.equal(summary['Interest Collected'], report.totalInterestCollected);
  assert.equal(summary['Total Payments Collected'], report.totalPaymentsCollected);
  assert.equal(summary['Total Expenses'], report.totalExpenses);
  assert.equal(summary['Active Loans'], 1);
  assert.equal(summary['Overdue Loans'], 1);
  assert.equal(summary['Completed Loans'], 1);
  const [borrower] = rows('Customers');
  const [customerSummary] = await db.getCustomers();
  assert.equal(borrower['Active Borrowed'], customerSummary.active_borrowed);
  assert.equal(borrower['Total Borrowed'], customerSummary.total_borrowed);
  assert.equal(borrower['Balance Due'], customerSummary.balance_due);
  assert.equal(borrower.Phone, '00123456789');
  assert.equal(borrower['Guarantor Phone'], '00987654321');
  assert.equal(workbook.Sheets.Customers.B2.t, 's');
  assert.equal(workbook.Sheets.Customers.B2.f, undefined);
  assert.equal(workbook.Sheets.Customers.B2.v, name);
  assert.equal(rows('Loans').length, 3);
  assert.equal(rows('Loans').find((row) => row['Loan ID'] === active)['Next EMI Date'], '2026-10-03');
  assert.equal(rows('Loans').find((row) => row['Loan ID'] === completed)['Next EMI Date'], 'Completed');
  assert.equal(rows('Loans')[0]['Customer Name'], name);
  assert.equal(rows('Payments').length, 2);
  assert.equal(rows('Payments')[0]['Customer Name'], name);
  assert.equal(rows('Expenses')[0].Notes, 'Rent receipt');
  assert.equal(workbook.Sheets.Loans.E2.t, 'n');
  assert.match(workbook.Sheets.Loans.E2.z, /₹/);
  for (const sheet of Object.values(workbook.Sheets)) {
    assert.ok(sheet['!autofilter']);
    assert.ok(sheet['!cols'].every((column) => column.width >= 14));
  }
});

test('empty Excel exports retain all worksheet headers and zero summary values', async () => {
  const { db, load } = freshApp();
  const XLSX = require('xlsx');
  const exporter = load('src/utils/excelWorkbook.ts');
  const workbook = XLSX.read(exporter.excelWorkbookBase64(await db.exportDatabaseToJson()), { type: 'base64' });
  assert.equal(workbook.SheetNames.length, 5);
  for (const name of ['Customers', 'Loans', 'Payments', 'Expenses']) {
    assert.ok(workbook.Sheets[name].A1.v);
    assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets[name]).length, 0);
  }
  assert.equal(workbook.Sheets.Summary_Report.B2.v, 0);
});

test('Excel share and Android folder export write valid binary workbooks with the correct MIME and handle cancellation/failure', async () => {
  const XLSX = require('xlsx');
  const writes = [];
  const shares = [];
  let available = true;
  let pickerError = null;
  let writeError = false;
  class MemoryFile {
    constructor(parent, name) { this.name = name; this.uri = `${parent}/${name}`; }
    create(options) { this.options = options; }
    write(contents, options) {
      if (writeError) throw new Error('Storage full');
      assert.equal(options.encoding, 'base64');
      writes.push({ file: this, bytes: Buffer.from(contents, 'base64') });
    }
  }
  const fs = {
    File: MemoryFile, Paths: { cache: 'file:///cache' },
    Directory: { pickDirectoryAsync: async () => {
      if (pickerError) throw pickerError;
      return { createFile: (name, mime) => {
        assert.equal(mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        return new MemoryFile('content://chosen-folder', name);
      } };
    } },
  };
  const overrides = {
    'expo-file-system': fs,
    'expo-file-system/legacy': {
      EncodingType: { Base64: 'base64' },
      StorageAccessFramework: {
        requestDirectoryPermissionsAsync: async () => {
          if (pickerError) throw pickerError;
          return { granted: true, directoryUri: 'content://chosen-folder' };
        },
        createFileAsync: async (directoryUri, name, mime) => {
          assert.equal(mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          return `${directoryUri}/${name}`;
        },
        writeAsStringAsync: async (uri, base64, options) => {
          if (writeError) throw new Error('Storage full');
          assert.equal(options.encoding, 'base64');
          writes.push({ file: { uri }, bytes: Buffer.from(base64, 'base64') });
        },
      },
    },
    'react-native': { Platform: { OS: 'android' } },
    'expo-sharing': { isAvailableAsync: async () => available, shareAsync: async (...args) => shares.push(args) },
  };
  const { db, load } = freshApp(overrides);
  const exporter = load('src/utils/excelExport.ts');
  assert.equal(exporter.excelFileName('2026-10-26'), 'FinanceTracker_Export_2026-10-26.xlsx');
  await db.addExpense(expenseInput());
  await exporter.shareExcel();
  assert.equal(writes[0].file.options.overwrite, true);
  assert.equal(shares[0][1].mimeType, exporter.EXCEL_MIME);
  assert.equal(shares[0][1].UTI, 'org.openxmlformats.spreadsheetml.sheet');
  assert.match(shares[0][0], /FinanceTracker_Export_\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.equal(XLSX.read(writes[0].bytes, { type: 'buffer' }).Sheets.Expenses.E2.v, 250);
  const saved = await exporter.saveExcelToFolder();
  assert.match(saved.fileName, /\.xlsx$/);
  assert.match(writes[1].file.uri, /^content:/);
  assert.equal(XLSX.read(writes[1].bytes, { type: 'buffer' }).SheetNames.length, 5);
  pickerError = Object.assign(new Error('Dismissed'), { code: 'ERR_PICKER_CANCELLED' });
  assert.equal(await exporter.saveExcelToFolder(), null);
  assert.equal(writes.length, 2);
  pickerError = new Error('Permission denied');
  assert.equal((await exporter.saveExcelToFolder()).fallbackShared, true);
  pickerError = null;
  writeError = true;
  await assert.rejects(exporter.saveExcelToFolder(), /Storage full/);
  available = false;
  await assert.rejects(exporter.shareExcel(), /not available/);
  const ios = freshApp({ ...overrides, 'react-native': { Platform: { OS: 'ios' } } }).load('src/utils/excelExport.ts');
  assert.equal(ios.canSaveExcelToFolder, false);
  await assert.rejects(ios.saveExcelToFolder(), /only supported on Android/);
});

test('custom EMI dates govern daily/weekly/monthly schedules, maturity, edits and due queries', async () => {
  const { db, schedule, load } = freshApp();
  const customer = await db.addCustomer(customerInput);
  for (const [tenure, second, final] of [
    ['Daily', '2026-11-16', '2026-11-17'],
    ['Weekly', '2026-11-22', '2026-11-29'],
    ['Monthly', '2026-12-15', '2027-01-15'],
  ]) {
    const id = await db.addLoan(loanInput(customer, { tenure_type: tenure, period: 3, emi_start_date: '2026-11-15' }));
    const loan = await db.getLoanById(id);
    assert.equal(schedule.nextEmiDate(loan), '2026-11-15');
    assert.equal(schedule.nextEmiDate({ ...loan, paid_amount: loan.emi_amount }), second);
    assert.equal(schedule.finalDueDate(loan), final);
    assert.equal(schedule.installmentsElapsed(loan.disbursal_date, tenure, 3, '2026-11-14', loan.emi_start_date), 0);
    assert.equal(schedule.installmentsElapsed(loan.disbursal_date, tenure, 3, '2026-11-15', loan.emi_start_date), 1);
    assert.equal((await db.getTodayDueLoans('2026-11-14')).some((due) => due.id === id), false);
    assert.equal((await db.getTodayDueLoans('2026-11-15')).find((due) => due.id === id).installment_number, 1);
    assert.equal((await db.getTodayDueLoans(second)).find((due) => due.id === id).installment_number, 2);
    await db.refreshOverdueStatuses(final);
    assert.equal((await db.getLoanById(id)).status, 'Active');
    const dayAfter = load('src/utils/date.ts').addDays(final, 1);
    await db.refreshOverdueStatuses(dayAfter);
    assert.equal((await db.getLoanById(id)).status, 'Overdue');
    await db.updateLoan(id, { ...loanInput(customer), tenure_type: tenure, period: 3, emi_start_date: null });
    assert.equal((await db.getLoanById(id)).next_due_date, schedule.firstDefaultDueDate('2026-10-01', tenure));
  }
  const sameDay = await db.addLoan(loanInput(customer, { emi_start_date: '2026-10-01' }));
  assert.equal((await db.getTodayDueLoans('2026-10-01')).find((due) => due.id === sameDay).installment_number, 1);
  await assert.rejects(db.addLoan(loanInput(customer, { emi_start_date: '2026-09-30' })), /before disbursal/);
  await assert.rejects(db.addLoan(loanInput(customer, { emi_start_date: '2026-02-30' })), /valid/);
  assert.equal(schedule.installmentDate('2024-01-01', 'Monthly', 2, '2024-01-31'), '2024-02-29');
  assert.equal(schedule.installmentDate('2024-01-01', 'Monthly', 3, '2024-01-31'), '2024-03-31');
});

test('KYC, EMI dates and reminders survive backup restore; legacy defaults, validation and cascades work', async () => {
  const { db } = freshApp();
  const details = { ...customerInput, photo_uri: 'file:///customer.jpg', kyc_type: 'PAN',
    kyc_number: 'ABCDE1234F', kyc_doc_uri: 'file:///pan.jpg' };
  const customer = await db.addCustomer(details);
  await db.updateCustomer(customer, { ...details, kyc_type: 'ID Card', kyc_number: 'ID123' });
  const loan = await db.addLoan(loanInput(customer, { emi_start_date: '2026-11-01' }));
  const first = await db.addLoanReminder(loan, ' Call tomorrow ');
  const second = await db.addLoanReminder(loan, 'Bring receipt');
  assert.deepEqual((await db.getLoanReminders(loan)).map((note) => note.note), ['Bring receipt', 'Call tomorrow']);
  await db.deleteLoanReminder(second);
  await assert.rejects(db.addLoanReminder(loan, '  '), /required/);
  await assert.rejects(db.addLoanReminder(99999, 'Missing loan'), /FOREIGN KEY/);
  const backup = await db.exportDatabaseToJson();
  assert.equal(backup.loan_reminders[0].id, first);
  assert.ok(backup.loan_reminders[0].created_at);
  await db.clearAllData();
  await db.importDatabaseFromJson(JSON.stringify(backup));
  assert.equal((await db.getCustomerById(customer)).photo_uri, details.photo_uri);
  assert.equal((await db.getCustomerById(customer)).kyc_number, 'ID123');
  assert.equal((await db.getLoanById(loan)).emi_start_date, '2026-11-01');
  assert.equal((await db.getLoanReminders(loan))[0].note, 'Call tomorrow');
  await assert.rejects(db.importDatabaseFromJson({ ...backup, loan_reminders: [{ ...backup.loan_reminders[0], loan_id: 99999 }] }), /missing loan/);
  await assert.rejects(db.importDatabaseFromJson({ ...backup, loan_reminders: null }), /loan_reminders/);
  await assert.rejects(db.importDatabaseFromJson({ ...backup, loans: [{ ...backup.loans[0], emi_start_date: 'bad' }] }), /date/);
  assert.equal((await db.getLoanReminders(loan)).length, 1);
  await db.deleteLoan(loan);
  assert.deepEqual(await db.getLoanReminders(loan), []);
  // Older backups contain neither KYC fields nor reminder arrays nor EMI start dates.
  const oldCustomer = { ...backup.customers[0] };
  for (const field of ['photo_uri', 'kyc_type', 'kyc_number', 'kyc_doc_uri']) delete oldCustomer[field];
  const oldLoan = { ...backup.loans[0] };
  delete oldLoan.emi_start_date;
  await db.importDatabaseFromJson({ ...backup, version: 4, customers: [oldCustomer], loans: [oldLoan], loan_reminders: undefined });
  const restored = await db.getCustomerById(customer);
  for (const field of ['photo_uri', 'kyc_type', 'kyc_number', 'kyc_doc_uri']) assert.equal(restored[field], '');
  assert.equal((await db.getLoanById(loan)).emi_start_date, null);
  assert.deepEqual(await db.getLoanReminders(loan), []);
  await db.addLoanReminder(loan, 'Cascade on customer deletion');
  await db.deleteCustomer(customer);
  assert.deepEqual((await db.exportDatabaseToJson()).loan_reminders, []);
});

test('partially applied column migrations resume safely without overwriting existing KYC', async () => {
  const file = path.join(directory, `${++sequence}.db`);
  const first = loadApp(file).db;
  const customer = await first.addCustomer({ ...customerInput, photo_uri: 'file:///keep.jpg' });
  const loan = await first.addLoan(loanInput(customer));
  const sql = new DatabaseSync(file);
  sql.exec(`ALTER TABLE loans DROP COLUMN emi_start_date;
    ALTER TABLE customers DROP COLUMN kyc_type;
    ALTER TABLE customers DROP COLUMN kyc_doc_uri;
    PRAGMA user_version = 5;`);
  const db = loadApp(file).db;
  await Promise.all([db.initDatabase(), db.initDatabase()]);
  assert.equal((await db.getLoanById(loan)).emi_start_date, null);
  assert.equal((await db.getCustomerById(customer)).photo_uri, 'file:///keep.jpg');
  assert.equal((await db.getCustomerById(customer)).kyc_doc_uri, '');
  for (const field of ['photo_uri', 'kyc_type', 'kyc_number', 'kyc_doc_uri']) {
    assert.equal(sql.prepare('PRAGMA table_info(customers)').all().filter((column) => column.name === field).length, 1);
  }
  sql.close();
});

test('Batch 1 guarded column migrations repair partial schemas and remain idempotent', async () => {
  for (const missing of ['alternate_phone', 'monthly_type', 'doc_uris']) {
    const file = path.join(directory, `${++sequence}.db`);
    const first = loadApp(file).db;
    const customer = await first.addCustomer({ ...customerInput, alternate_phone: '7654321' });
    const loan = await first.addLoan(loanInput(customer, { tenure_type: 'Monthly', monthly_type: 'Gold', doc_uris: '["file:///gold.jpg"]' }));
    const sql = new DatabaseSync(file);
    sql.exec(`ALTER TABLE ${missing === 'alternate_phone' ? 'customers' : 'loans'} DROP COLUMN ${missing}`);
    const db = loadApp(file).db;
    await Promise.all([db.initDatabase(), db.initDatabase()]);
    const restoredCustomer = await db.getCustomerById(customer);
    const restoredLoan = await db.getLoanById(loan);
    assert.equal(restoredCustomer.alternate_phone, missing === 'alternate_phone' ? '' : '7654321');
    assert.equal(restoredLoan.monthly_type, missing === 'monthly_type' ? null : 'Gold');
    assert.equal(restoredLoan.doc_uris, missing === 'doc_uris' ? '[]' : '["file:///gold.jpg"]');
    // A fresh app connection runs the guards again, without duplicating or resetting columns.
    await loadApp(file).db.initDatabase();
    const customerColumns = sql.prepare('PRAGMA table_info(customers)').all();
    const loanColumns = sql.prepare('PRAGMA table_info(loans)').all();
    assert.equal(customerColumns.filter((column) => column.name === 'alternate_phone').length, 1);
    assert.equal(loanColumns.filter((column) => column.name === 'monthly_type').length, 1);
    assert.equal(loanColumns.filter((column) => column.name === 'doc_uris').length, 1);
    sql.close();
  }
});

test('alternate contacts, monthly categories and photo lists survive CRUD, backup restore and Excel export', async () => {
  const { db, load } = freshApp();
  const details = { ...customerInput, alternate_phone: '7000001', kyc_type: 'Aadhar',
    kyc_number: '1234', kyc_doc_uri: '["file:///front.jpg","file:///back.jpg"]' };
  const customer = await db.addCustomer(details);
  assert.deepEqual((await db.getCustomers('7000001')).map((row) => row.id), [customer]);
  await db.updateCustomer(customer, { ...details, alternate_phone: ' 7000002 ' });
  assert.equal((await db.getCustomers('7000001')).length, 0);
  assert.equal((await db.getCustomers('7000002'))[0].alternate_phone, '7000002');
  const monthly = await db.addLoan(loanInput(customer, { tenure_type: 'Monthly', monthly_type: 'Gold', doc_uris: '["file:///gold.jpg","file:///receipt.jpg"]' }));
  const defaults = await db.addLoan(loanInput(customer, { tenure_type: 'Monthly' }));
  const daily = await db.addLoan(loanInput(customer, { monthly_type: 'Gold' }));
  assert.equal((await db.getLoanById(defaults)).monthly_type, 'Finance');
  assert.equal((await db.getLoanById(daily)).monthly_type, null);
  assert.equal((await db.getLoanById(daily)).doc_uris, '[]');
  await db.updateLoan(defaults, loanInput(customer, { tenure_type: 'Monthly', monthly_type: 'Vehicle', doc_uris: '["file:///car.jpg"]' }));
  await db.updateLoan(defaults, loanInput(customer, { tenure_type: 'Weekly', monthly_type: 'Gold' }));
  assert.equal((await db.getLoanById(defaults)).monthly_type, null);
  assert.equal((await db.getLoanById(defaults)).doc_uris, '["file:///car.jpg"]');
  await db.updateLoan(defaults, loanInput(customer, { tenure_type: 'Weekly', doc_uris: '[]' }));
  assert.equal((await db.getLoanById(defaults)).doc_uris, '[]');
  const backup = await db.exportDatabaseToJson();
  await db.clearAllData();
  await db.importDatabaseFromJson(JSON.stringify(backup));
  assert.equal((await db.getCustomerById(customer)).alternate_phone, '7000002');
  assert.equal((await db.getCustomerById(customer)).kyc_doc_uri, details.kyc_doc_uri);
  assert.equal((await db.getLoanById(monthly)).monthly_type, 'Gold');
  assert.equal((await db.getLoanById(monthly)).doc_uris, '["file:///gold.jpg","file:///receipt.jpg"]');
  const XLSX = require('xlsx');
  const workbook = load('src/utils/excelWorkbook.ts').createExcelWorkbook(await db.exportDatabaseToJson());
  const loans = XLSX.utils.sheet_to_json(workbook.Sheets.Loans);
  assert.equal(loans.find((row) => row['Loan ID'] === monthly)['Monthly Loan Category'], 'Gold');
  assert.equal(loans.find((row) => row['Loan ID'] === daily)['Monthly Loan Category'], '');
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Customers)[0]['Alternate Contact Number'], '7000002');
  // Restore a pre-Batch 1 backup with a legacy single KYC URI and no new columns.
  const legacyCustomer = { ...backup.customers[0], kyc_doc_uri: 'file:///legacy.jpg' };
  delete legacyCustomer.alternate_phone;
  const legacyLoans = backup.loans.map(({ monthly_type, doc_uris, ...row }) => row);
  await db.importDatabaseFromJson({ ...backup, version: 5, customers: [legacyCustomer], loans: legacyLoans });
  assert.equal((await db.getCustomerById(customer)).alternate_phone, '');
  assert.equal((await db.getLoanById(monthly)).monthly_type, null);
  assert.equal((await db.getLoanById(monthly)).doc_uris, '[]');
  const { parseUriList } = load('src/utils/photoUris.ts');
  assert.deepEqual(parseUriList((await db.getCustomerById(customer)).kyc_doc_uri), ['file:///legacy.jpg']);
});

test('photo list parsing tolerates legacy URIs, missing/invalid JSON and mixed arrays; KYC labels map gracefully', () => {
  const { load } = freshApp();
  const { parseUriList } = load('src/utils/photoUris.ts');
  for (const raw of [undefined, null, '', '  ', '[]', '{}', 'null', '123', '[broken', '"broken']) {
    assert.deepEqual(parseUriList(raw), []);
  }
  assert.deepEqual(parseUriList(' file:///legacy.jpg '), ['file:///legacy.jpg']);
  assert.deepEqual(parseUriList('"file:///legacy.jpg"'), ['file:///legacy.jpg']);
  assert.deepEqual(parseUriList('["file:///one.jpg",null,17," ",{}," file:///two.jpg "]'), ['file:///one.jpg', 'file:///two.jpg']);
  assert.deepEqual(parseUriList('data:image/jpeg;base64,abc'), ['data:image/jpeg;base64,abc']);
  const { normalizeKycType } = load('src/utils/customerKyc.ts');
  for (const type of ['Aadhar', 'Aadhaar', 'aadhaar card']) assert.equal(normalizeKycType(type), 'Aadhar');
  for (const type of ['License', 'Driving License', 'Driving Licence']) assert.equal(normalizeKycType(type), 'License');
  for (const type of ['ID Card', 'PAN', 'Voter ID', 'Other', 'unknown']) assert.equal(normalizeKycType(type), 'Others');
  assert.equal(normalizeKycType(''), '');
});

test('customer search matches KYC numbers and alternate phones, with literal wildcard handling', async () => {
  const { db } = freshApp();
  const id = await db.addCustomer({ ...customerInput, kyc_number: 'DL_100%', alternate_phone: '7000001' });
  await db.addCustomer({ ...customerInput, name: 'Another customer', kyc_number: 'DLX1000' });
  for (const query of ['dl_100%', '7000001', '_', '%']) {
    assert.deepEqual((await db.getCustomers(query)).map((customer) => customer.id), [id]);
  }
});

test('interest realization is capped, safe for zero totals, additive by date and consistent with Excel including charges', async () => {
  const { db, schedule, load } = freshApp();
  const customer = await db.addCustomer(customerInput);
  const add = await db.addLoan(loanInput(customer));
  const upfront = await db.addLoan(loanInput(customer, { interest_mode: 'DeductUpfront', disbursal_date: '2026-09-01' }));
  await db.addPayment({ loan_id: add, amount: 550, charges_amount: 35, payment_date: '2026-10-02', payment_mode: 'Cash' });
  await db.addPayment({ loan_id: upfront, amount: 100, charges_amount: 15, payment_date: '2026-10-02', payment_mode: 'Cash' });
  assert.equal((await db.getFinanceReport()).totalInterestCollected, 150);
  assert.equal((await db.getFinanceReport('2026-09-01', '2026-09-30')).totalInterestCollected, 100);
  assert.equal((await db.getFinanceReport('2026-10-01', '2026-10-31')).totalInterestCollected, 50);
  // Completion realizes only the remaining interest; charges never count as interest or repayment.
  await db.updateLoan(add, { ...loanInput(customer), status: 'Completed', closed_date: '2026-11-01' });
  assert.equal((await db.getFinanceReport('2026-11-01', '2026-11-30')).totalInterestCollected, 50);
  assert.equal((await db.getFinanceReport()).totalInterestCollected, 200);
  const backup = await db.exportDatabaseToJson();
  const XLSX = require('xlsx');
  const workbook = load('src/utils/excelWorkbook.ts').createExcelWorkbook(backup);
  const rows = (name) => XLSX.utils.sheet_to_json(workbook.Sheets[name]);
  const summary = Object.fromEntries(rows('Summary_Report').map((row) => [row.Metric, row.Value]));
  assert.equal(summary['Interest Collected'], 200);
  assert.equal(summary['Total Payments Collected'], 700);
  assert.equal(summary['Total Payments Collected'], (await db.getFinanceReport()).totalPaymentsCollected);
  assert.equal(summary['Net Cash Flow'], 700 - 980 - 880);
  const exportedLoan = rows('Loans').find((row) => row['Loan ID'] === add);
  assert.equal(exportedLoan['Paid Amount'], 585);
  assert.equal(exportedLoan['EMI / Loan Paid'], 550);
  assert.equal(exportedLoan.Balance, 550);
  assert.equal(rows('Payments')[0]['Total Collected'], 585);
  const base = { interest_amount: 100, interest_mode: 'AddToTotal', total_payable: 1100, paid_amount: 550, status: 'Active' };
  assert.equal(schedule.collectedInterest(base), 50);
  assert.equal(schedule.collectedInterest({ ...base, paid_amount: 5000 }), 100);
  for (const total_payable of [0, -1, NaN, Infinity]) {
    assert.equal(schedule.collectedInterest({ ...base, total_payable }), 0);
  }
  assert.equal(schedule.collectedInterest({ ...base, paid_amount: 0, interest_mode: 'DeductUpfront' }), 100);
  assert.equal(schedule.collectedInterest({ ...base, status: 'Completed' }), 100);
  const invalidTotals = { ...backup, loans: backup.loans.map((loan) => ({ ...loan, total_payable: 0, paid_amount: 0, status: 'Active' })) };
  const safeWorkbook = load('src/utils/excelWorkbook.ts').createExcelWorkbook(invalidTotals);
  assert.equal(XLSX.utils.sheet_to_json(safeWorkbook.Sheets.Summary_Report).find((row) => row.Metric === 'Interest Collected').Value, 100);
});

test('database reports guard non-positive totals and cap overpaid interest at the configured amount', async () => {
  const file = path.join(directory, `${++sequence}.db`);
  const { db } = loadApp(file);
  const customer = await db.addCustomer(customerInput);
  const id = await db.addLoan(loanInput(customer));
  const sql = new DatabaseSync(file);
  for (const total of [0, -1]) {
    sql.prepare('UPDATE loans SET total_payable = ?, paid_amount = 500 WHERE id = ?').run(total, id);
    assert.equal((await db.getFinanceReport()).totalInterestCollected, 0);
    assert.equal((await db.getFinanceReport('2026-10-01', '2026-10-31')).totalInterestCollected, 0);
  }
  sql.prepare('UPDATE loans SET total_payable = 1100, paid_amount = 5000 WHERE id = ?').run(id);
  assert.equal((await db.getFinanceReport()).totalInterestCollected, 100);
  sql.prepare("UPDATE loans SET total_payable = 0, status = 'Completed' WHERE id = ?").run(id);
  assert.equal((await db.getFinanceReport()).totalInterestCollected, 100);
  sql.close();
});

test('full EMI schedule allocates chronological payments across partial installments and indexes ledger matches', () => {
  const { schedule } = freshApp();
  const loan = Object.freeze({ id: 1, disbursal_date: '2026-10-01', emi_start_date: '2026-10-10',
    tenure_type: 'Daily', period: 3, emi_amount: 334, total_payable: 1000 });
  const payment = (id, amount, payment_date, extras = {}) => Object.freeze({ id, loan_id: 1, amount, payment_date, ...extras });
  const payments = Object.freeze([
    payment(2, 350, '2026-10-30', { charges_amount: 500 }),
    payment(4, 1000, '2026-10-01', { loan_id: 2 }),
    payment(3, 0, '2026-10-09', { charges_amount: 1000 }),
    payment(1, 100, '2026-10-08'),
  ]);
  const entries = schedule.buildLoanEmiSchedule(loan, payments, '2026-11-01');
  assert.deepEqual(entries.map((row) => [row.installmentNumber, row.scheduledDate, row.expectedAmount]), [
    [1, '2026-10-10', 334], [2, '2026-10-11', 334], [3, '2026-10-12', 332],
  ]);
  assert.deepEqual(entries.map((row) => [row.paidAmount, row.status, row.actualPaidDate, row.daysDiff]), [
    [334, 'Paid', '2026-10-30', 20], [116, 'Partial', '2026-10-30', 19], [0, 'Overdue', null, null],
  ]);
  const ledger = schedule.paymentEmiMatches(entries);
  assert.equal(ledger.has(3), false); // Charges-only payments settle no installment.
  assert.equal(ledger.has(4), false); // Unrelated borrowers/loans cannot pay this schedule.
  assert.deepEqual(ledger.get(2).map((match) => [match.installmentNumber, match.amount, match.settlesInstallment]), [[1, 234, true], [2, 116, false]]);
  assert.equal(ledger.get(1)[0].daysDiff, -2);
  assert.equal(schedule.paymentTimingLabel(20), '20 days late');
  assert.equal(schedule.paymentTimingLabel(-1), '1 day early');
  assert.equal(schedule.paymentTimingLabel(0), 'On time');
});

test('schedule includes every daily/weekly/monthly due date, handles leap months and exact cents', () => {
  const { schedule } = freshApp();
  const base = { id: 1, disbursal_date: '2024-01-01', emi_start_date: '2024-01-31',
    tenure_type: 'Monthly', period: 3, emi_amount: 33.34, total_payable: 100 };
  for (const [tenure_type, dates] of [
    ['Daily', ['2024-01-31', '2024-02-01', '2024-02-02']],
    ['Weekly', ['2024-01-31', '2024-02-07', '2024-02-14']],
    ['Monthly', ['2024-01-31', '2024-02-29', '2024-03-31']],
  ]) {
    const entries = schedule.buildLoanEmiSchedule({ ...base, tenure_type }, [], '2024-01-31');
    assert.deepEqual(entries.map((row) => row.scheduledDate), dates);
    assert.ok(entries.every((row) => row.status === 'Upcoming'));
    assert.deepEqual(entries.map((row) => row.expectedAmount), [33.34, 33.34, 33.32]);
  }
  const fallback = schedule.buildLoanEmiSchedule({ ...base, emi_start_date: null }, [], '2024-01-01');
  assert.equal(fallback[0].scheduledDate, '2024-02-01');
  const paid = schedule.buildLoanEmiSchedule(base, [
    { id: 3, loan_id: 1, amount: 66.66, payment_date: '2024-03-31' },
    { id: 2, loan_id: 1, amount: 33.33, payment_date: '2024-01-31' },
    { id: 1, loan_id: 1, amount: 0.01, payment_date: '2024-01-31' },
  ], '2024-03-31');
  assert.deepEqual(paid.map((row) => row.status), ['Paid', 'Paid', 'Paid']);
  assert.equal(paid[0].actualPaidDate, '2024-01-31');
  assert.equal(paid[0].daysDiff, 0);
  assert.equal(paid[2].expectedAmount, 33.32);
  const long = schedule.buildLoanEmiSchedule({ ...base, period: 5000, tenure_type: 'Daily', emi_amount: 1, total_payable: 5000 }, [], '2024-01-01');
  assert.equal(long.length, 5000);
  assert.equal(long[4999].installmentNumber, 5000);
  const closed = schedule.buildLoanEmiSchedule({ ...base, status: 'Completed', paid_amount: 100 }, [], '2025-01-01');
  assert.ok(closed.every((row) => row.status === 'Overdue' && row.actualPaidDate === null));
});

test('schedule rebuilds from actual records after backdated payment deletion', async () => {
  const { db, schedule } = freshApp();
  const customer = await db.addCustomer(customerInput);
  const id = await db.addLoan(loanInput(customer, { period: 3, interest_rate: 0, emi_start_date: '2026-10-10' }));
  const first = await db.addPayment({ loan_id: id, amount: 334, payment_date: '2026-10-09', payment_mode: 'Cash' });
  await db.addPayment({ loan_id: id, amount: 334, payment_date: '2026-10-11', payment_mode: 'Cash' });
  await db.addPayment({ loan_id: id, amount: 332, payment_date: '2026-10-13', payment_mode: 'Cash' });
  let rows = schedule.buildLoanEmiSchedule(await db.getLoanById(id), await db.getPaymentsByLoan(id), '2026-10-14');
  assert.deepEqual(rows.map((row) => row.daysDiff), [-1, 0, 1]);
  await db.deletePayment(first);
  rows = schedule.buildLoanEmiSchedule(await db.getLoanById(id), await db.getPaymentsByLoan(id), '2026-10-14');
  assert.deepEqual(rows.map((row) => [row.status, row.actualPaidDate]), [
    ['Paid', '2026-10-11'], ['Partial', '2026-10-13'], ['Overdue', null],
  ]);
});

test('dashboard combines charges in collections but excludes them from targets, repayment and market balance', async () => {
  const { db, schedule } = freshApp();
  const customer = await db.addCustomer(customerInput);
  const id = await db.addLoan(loanInput(customer));
  const feesOnly = await db.addLoan(loanInput(customer));
  const notDue = await db.addLoan(loanInput(customer, { tenure_type: 'Monthly' }));
  await db.addPayment({ loan_id: id, amount: 80, charges_amount: 200, payment_date: '2026-10-02', payment_mode: 'Cash' });
  await db.addPayment({ loan_id: feesOnly, amount: 0, charges_amount: 150, payment_date: '2026-10-02', payment_mode: 'UPI' });
  await db.addPayment({ loan_id: notDue, amount: 0, charges_amount: 50, payment_date: '2026-10-02', payment_mode: 'Cash' });
  let stats = await db.getDashboardStats('2026-10-02');
  assert.equal(stats.todayCollectedAmount, 480);
  assert.equal(stats.todayChargesCollected, 400);
  assert.equal(stats.todayTargetCollection, 220);
  assert.equal(stats.totalBalancePending, 3220);
  const due = await db.getTodayDueLoans('2026-10-02');
  assert.equal(due.length, 2);
  const row = due.find((loan) => loan.id === id);
  assert.equal(row.paid_today, 80);
  assert.equal(row.charges_today, 200);
  assert.equal(row.due_today, 110);
  assert.equal(schedule.loanTotalPaid(row), 280);
  assert.equal(schedule.loanBalanceDue(row), 1020);
  assert.ok(row.paid_today < row.due_today); // Large penalties do not mark a target collected.
  const fees = due.find((loan) => loan.id === feesOnly);
  assert.equal(fees.paid_today, 0);
  assert.equal(fees.charges_today, 150);
  await db.addPayment({ loan_id: id, amount: 30, payment_date: '2026-10-02', payment_mode: 'Cash' });
  stats = await db.getDashboardStats('2026-10-02');
  assert.equal(stats.todayCollectedAmount, 510);
  assert.equal(stats.todayTargetCollection, 220);
  assert.equal(stats.totalBalancePending, 3190);
  assert.equal((await db.getDashboardStats('2026-10-03')).todayChargesCollected, 0);
});
