const assert = require('node:assert/strict');
const { test } = require('node:test');
const { existsSync, readFileSync } = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

// Exercise actual form event handlers with a small host for hooks/native views.
// Camera and gallery dialogs still need physical-device smoke testing.
function harness(overrides = {}, { dev = true } = {}) {
  const states = [];
  const effects = [];
  let cursor = 0;
  const element = (type, props) => ({ type, props });
  const native = {
    Platform: { OS: 'android' }, StyleSheet: { create: (styles) => styles },
    Alert: { alert: () => {} }, View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView',
    KeyboardAvoidingView: 'KeyboardAvoidingView', Image: 'Image', FlatList: 'FlatList', RefreshControl: 'RefreshControl',
  };
  const mocks = {
    react: {
      useState: (initial) => {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useRef: (initial) => {
        const index = cursor++;
        if (!(index in states)) states[index] = { current: initial };
        return states[index];
      },
      useMemo: (factory) => factory(),
      useCallback: (callback) => callback,
      useEffect: (effect, dependencies) => {
        const index = cursor++;
        const previous = states[index];
        if (!previous || dependencies.some((value, i) => value !== previous[i])) {
          states[index] = dependencies;
          effects.push(effect);
        }
      },
    },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native': native,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0, top: 0 }) },
    'expo-router': { router: { replace: () => {}, back: () => {}, push: () => {} }, Stack: { Title: 'Title' },
      useLocalSearchParams: () => ({ id: '1' }), useFocusEffect: () => {}, useNavigation: () => ({ dispatch: () => {} }) },
    'expo-router/react-navigation': { usePreventRemove: () => {} },
    '@expo/vector-icons/Ionicons': 'Ionicons',
    '@/components/AppButton': { AppButton: 'AppButton' },
    '@/components/AppText': { AppText: 'Text', AppTextInput: 'TextInput' },
    '@/components/BottomSheet': { BottomSheet: 'BottomSheet' },
    '@/components/DateField': { DateField: 'DateField' },
    '@/components/FormField': { FormField: 'FormField' },
    '@/components/FilterChips': { FilterChips: 'FilterChips' },
    '@/components/MultiPhotoPicker': { MultiPhotoPicker: 'MultiPhotoPicker' },
    '@/components/PhotoPickerField': { PhotoPickerField: 'PhotoPickerField' },
    '@/components/PhotoGallery': { PhotoGallery: 'PhotoGallery' },
    '@/components/SegmentedControl': { SegmentedControl: 'SegmentedControl' },
    '@/components/CustomerPickerSheet': { CustomerPickerSheet: 'CustomerPickerSheet' },
    '@/components/MetricStrip': { MetricStrip: 'MetricStrip' },
    '@/components/AccountCloudCards': { AccountCloudCards: 'AccountCloudCards' },
    '@/components/ExcelExportButtons': { ExcelExportButtons: 'ExcelExportButtons' },
    '@/components/PhotoPreview': { PhotoPreview: 'PhotoPreview' },
    '@/components/ScreenState': { SectionTitle: 'SectionTitle', ErrorBanner: 'ErrorBanner' },
    '@/components/StatusBadge': { StatusBadge: 'StatusBadge', STATUS_COLORS: { Active: {}, Overdue: {}, Completed: {} } },
    '@/components/EmptyState': { EmptyState: 'EmptyState' },
    '@/components/OptionSheet': { OptionSheet: 'OptionSheet' },
    '@/components/LoanEmiScheduleRow': { LoanEmiScheduleRow: 'LoanEmiScheduleRow' },
    '@/components/LoanPaymentRow': { LoanPaymentRow: 'LoanPaymentRow' },
    '@/components/LoanReminderNotes': { LoanReminderNotes: 'LoanReminderNotes' },
    '@/hooks/useDebouncedValue': { useDebouncedValue: (value) => value },
    '@/hooks/useResponsiveLayout': { useResponsiveLayout: () => ({ pagePadding: 16 }) },
    '@/hooks/useDbQuery': { useDbQuery: () => ({ data: null, loading: false }) },
    '@/services/googleDriveBackup': { scheduleAutoSync: () => {} },
    ...overrides,
  };
  const modules = new Map();
  const load = (relative) => {
    let filename = path.resolve(__dirname, '..', relative);
    if (!existsSync(filename)) filename = filename.replace(/\.ts$/, '.tsx');
    if (modules.has(filename)) return modules.get(filename).exports;
    const mod = new Module(filename, module);
    modules.set(filename, mod);
    mod.require = (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`);
      return require(id);
    };
    mod._compile(`const __DEV__ = ${dev};\n` + ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: filename,
    }).outputText, filename);
    return mod.exports;
  };
  return { load, states, render: (component, props) => {
    cursor = 0;
    const tree = component(props);
    for (const effect of effects.splice(0)) effect();
    return tree;
  } };
}

function find(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((child) => find(child, predicate));
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  return [...(predicate(tree) ? [tree] : []), ...find(tree.props.children, predicate)];
}

function textContent(tree) {
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree?.props ? textContent(tree.props.children) : '';
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const batch2Loan = (overrides = {}) => ({
  id: 1, customer_id: 1, customer_name: 'Borrower', customer_phone: '98765 43210',
  loan_amount: 1000, interest_rate: 0, interest_amount: 0, interest_mode: 'AddToTotal',
  tenure_type: 'Daily', period: 3, disbursal_date: '2026-10-01', emi_start_date: '2026-10-10',
  emi_amount: 334, total_payable: 1000, paid_amount: 450, balance_amount: 550,
  total_charges_collected: 50, status: 'Active', charges: 0, notes: '', ...overrides,
});

test('loan detail expands every installment and connects the same actual payment matches to the ledger', () => {
  const loan = batch2Loan();
  const payments = [
    { id: 2, loan_id: 1, amount: 350, charges_amount: 50, payment_date: '2026-10-30', payment_mode: 'UPI' },
    { id: 1, loan_id: 1, amount: 100, charges_amount: 0, payment_date: '2026-10-08', payment_mode: 'Cash' },
  ];
  const notes = [{ id: 1, loan_id: 1, note: 'Call tomorrow', created_at: '2026-10-30 12:00:00' }];
  const h = harness({
    '@/db/database': {},
    '@/hooks/useDbQuery': { useDbQuery: () => ({ data: { loan, payments, reminders: notes }, loading: false, reload: async () => {} }) },
  });
  const screen = h.load('src/app/loan/[id].tsx').default;
  let list = find(h.render(screen, {}), (node) => node.type === 'FlatList')[0];
  assert.equal(list.props.data.filter((row) => row.kind === 'installment').length, 0);
  const header = list.props.ListHeaderComponent;
  assert.match(textContent(header), /Total Paid ₹500/);
  assert.match(textContent(header), /Includes ₹50 extra charges/);
  assert.match(textContent(header), /Balance Due₹550/);
  const notesCard = find(header, (node) => node.type === 'LoanReminderNotes')[0];
  const headerBlocks = header.props.children.filter(Boolean);
  const notesIndex = headerBlocks.indexOf(notesCard);
  assert.match(textContent(headerBlocks[notesIndex - 1]), /Borrower/);
  assert.equal(find(headerBlocks[notesIndex + 1], (node) => node.type === 'StatusBadge').length, 1);
  assert.equal(find(header, (node) => node.type === 'LoanReminderNotes').length, 1);
  assert.equal(notesCard.props.loanId, 1);
  assert.deepEqual(notesCard.props.notes, notes);
  find(header, (node) => node.props.accessibilityLabel === 'EMI Schedule (All Installments)')[0].props.onPress();
  list = find(h.render(screen, {}), (node) => node.type === 'FlatList')[0];
  const installments = list.props.data.filter((row) => row.kind === 'installment');
  assert.equal(installments.length, 3);
  const first = list.props.renderItem({ item: installments[0] });
  assert.equal(first.props.installment.actualPaidDate, '2026-10-30');
  assert.equal(first.props.installment.daysDiff, 20);
  const ledger = list.props.data.find((row) => row.kind === 'payment' && row.payment.id === 2);
  const row = list.props.renderItem({ item: ledger });
  assert.deepEqual(row.props.matches.map((match) => match.installmentNumber), [1, 2]);
  assert.equal(row.props.matches[0].daysDiff, 20);
});

test('schedule and ledger rows clearly compare actual and scheduled dates, including partial and charges-only payments', () => {
  const h = harness();
  const scheduleRow = h.load('src/components/LoanEmiScheduleRow.tsx').LoanEmiScheduleRow;
  const installment = { installmentNumber: 1, scheduledDate: '2026-10-10', expectedAmount: 334,
    paidAmount: 334, status: 'Paid', actualPaidDate: '2026-10-30', daysDiff: 20 };
  let text = textContent(h.render(scheduleRow, { installment }));
  assert.match(text, /Scheduled EMI Date: 10 Oct 2026/);
  assert.match(text, /Actual Paid Date: 30 Oct 2026/);
  assert.match(text, /20 days late/);
  text = textContent(h.render(scheduleRow, { installment: { ...installment, status: 'Partial', paidAmount: 50 } }));
  assert.match(text, /₹50 paid · ₹284 remaining/);
  assert.match(text, /latest partial payment/);
  text = textContent(h.render(scheduleRow, { installment: { ...installment, actualPaidDate: '2026-10-10', daysDiff: 0 } }));
  assert.match(text, /Paid on time/);
  const ledgerRow = h.load('src/components/LoanPaymentRow.tsx').LoanPaymentRow;
  const payment = { id: 1, amount: 350, charges_amount: 50, payment_date: '2026-10-30', payment_mode: 'Cash' };
  const matches = [{ installmentNumber: 1, scheduledDate: '2026-10-10', amount: 334, daysDiff: 20, settlesInstallment: true }];
  text = textContent(h.render(ledgerRow, { payment, matches, disabled: false, onDelete: () => {} }));
  assert.match(text, /₹400/);
  assert.match(text, /Scheduled: 10 Oct 2026 · Paid: 30 Oct 2026/);
  assert.match(text, /20 days late/);
  text = textContent(h.render(ledgerRow, { payment: { ...payment, amount: 0 }, matches: [], disabled: false, onDelete: () => {} }));
  assert.match(text, /Charges only · no EMI settled/);
});

test('reminder UI saves trimmed notes once, refreshes, deletes per loan and preserves failed drafts', async () => {
  const notes = [];
  let refreshes = 0;
  let fail = false;
  const alerts = [];
  const h = harness({
    '@/db/database': {
      addLoanReminder: async (loan_id, note) => {
        if (fail) throw new Error('Storage full');
        notes.unshift({ id: 1, loan_id, note, created_at: '2026-10-30 12:00:00' });
      },
      deleteLoanReminder: async (id) => { assert.equal(id, 1); notes.splice(0, 1); },
    },
    'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: (s) => s }, Alert: { alert: (...args) => alerts.push(args) } },
  });
  const component = h.load('src/components/LoanReminderNotes.tsx').LoanReminderNotes;
  const render = () => h.render(component, { loanId: 7, notes, onChanged: async () => { refreshes++; } });
  let tree = render();
  assert.equal(find(tree, (node) => node.type === 'AppButton')[0].props.disabled, true);
  find(tree, (node) => node.type === 'FormField')[0].props.onChangeText('  Call after 5pm  ');
  tree = render();
  const save = find(tree, (node) => node.type === 'AppButton')[0];
  save.props.onPress(); save.props.onPress();
  await settle();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].loan_id, 7);
  assert.equal(notes[0].note, 'Call after 5pm');
  assert.equal(refreshes, 1);
  tree = render();
  assert.equal(find(tree, (node) => node.type === 'FormField')[0].props.value, '');
  assert.match(textContent(tree), /Call after 5pm/);
  find(tree, (node) => node.props.accessibilityLabel === 'Delete reminder: Call after 5pm')[0].props.onPress();
  await settle();
  assert.equal(notes.length, 0);
  assert.equal(refreshes, 2);
  find(render(), (node) => node.type === 'FormField')[0].props.onChangeText('Keep this draft');
  fail = true;
  find(render(), (node) => node.type === 'AppButton')[0].props.onPress();
  await settle();
  assert.equal(find(render(), (node) => node.type === 'FormField')[0].props.value, 'Keep this draft');
  assert.equal(alerts[0][0], 'Could not save note');
});

test('dashboard search, exclusive collection filters, metrics and collect action include charges without settling EMI targets', () => {
  const due = [
    batch2Loan({ id: 1, customer_name: 'Alice', period: 10, emi_amount: 110, total_payable: 1100,
      paid_amount: 80, balance_amount: 1020, total_charges_collected: 200, paid_today: 80, charges_today: 200, due_today: 110 }),
    batch2Loan({ id: 2, customer_name: 'Bob', period: 10, emi_amount: 110, total_payable: 1100,
      paid_amount: 110, balance_amount: 990, total_charges_collected: 0, paid_today: 110, charges_today: 0, due_today: 110 }),
    batch2Loan({ id: 3, customer_name: 'Carol', customer_phone: '9000000000', period: 10, emi_amount: 110, total_payable: 1100,
      paid_amount: 0, balance_amount: 1100, total_charges_collected: 150, paid_today: 0, charges_today: 150, due_today: 110 }),
  ];
  let reloads = 0;
  const data = { due, recent: [{ id: 1, loan_id: 1, customer_name: 'Alice', amount: 80, charges_amount: 200, payment_date: '2026-10-02', payment_mode: 'Cash' }],
    stats: { todayTargetCollection: 330, todayCollectedAmount: 540, todayChargesCollected: 350, totalBalancePending: 3110 } };
  const h = harness({
    '@/db/database': {},
    '@/components/DueLoanCard': { DueLoanCard: 'DueLoanCard' },
    '@/components/CollectPaymentSheet': { CollectPaymentSheet: 'CollectPaymentSheet' },
    '@/hooks/useDbQuery': { useDbQuery: () => ({ data, reload: async () => { reloads++; }, loading: false }) },
  });
  const screen = h.load('src/app/(tabs)/index.tsx').default;
  const render = () => h.render(screen, {});
  const getList = () => find(render(), (node) => node.type === 'FlatList')[0];
  let list = getList();
  assert.deepEqual(list.props.data.map((loan) => loan.id), [1, 3]);
  const metric = find(list.props.ListHeaderComponent, (node) => node.props.label === 'Collected Today')[0];
  assert.equal(metric.props.value, '₹540');
  assert.ok(find(list.props.ListHeaderComponent, (node) => node.props.accessibilityLabel === 'Pending (2)').length);
  find(list.props.ListHeaderComponent, (node) => node.props.accessibilityLabel === 'Collected (1)')[0].props.onPress();
  assert.deepEqual(getList().props.data.map((loan) => loan.id), [2]);
  find(getList().props.ListHeaderComponent, (node) => node.props.accessibilityLabel === 'All Due (3)')[0].props.onPress();
  find(render(), (node) => node.type === 'TextInput')[0].props.onChangeText('aLiCe');
  assert.deepEqual(getList().props.data.map((loan) => loan.id), [1]);
  find(render(), (node) => node.type === 'TextInput')[0].props.onChangeText('9876543210');
  assert.deepEqual(getList().props.data.map((loan) => loan.id), [1, 2]);
  find(render(), (node) => node.props.accessibilityLabel === 'Clear search')[0].props.onPress();
  list = getList();
  assert.equal(list.props.data.length, 3);
  list.props.renderItem({ item: due[0] }).props.onCollect();
  let sheet = find(render(), (node) => node.type === 'CollectPaymentSheet')[0];
  assert.equal(sheet.props.loan.id, 1);
  sheet.props.onSaved();
  sheet = find(render(), (node) => node.type === 'CollectPaymentSheet')[0];
  assert.equal(sheet.props.loan, null);
  assert.equal(reloads, 1);
  const footer = list.props.ListFooterComponent;
  const text = textContent(h.render(footer.type, footer.props));
  assert.match(text, /₹280/);
  assert.match(text, /₹80 EMI \+ ₹200 Charges/);
});

test('loan and collection cards show combined Total Paid, independent balances and isolated collect/call actions', () => {
  let opened = 0;
  let collected = 0;
  let called = 0;
  let stopped = 0;
  const h = harness({ '@/utils/phone': { callNumber: () => { called++; } } });
  const loan = batch2Loan({ total_payable: 1100, paid_amount: 80, total_charges_collected: 200,
    balance_amount: 9999, paid_today: 80, charges_today: 200, due_today: 110, installment_number: 1 });
  const card = h.render(h.load('src/components/DueLoanCard.tsx').DueLoanCard, {
    loan, onPress: () => { opened++; }, onCollect: () => { collected++; },
  });
  assert.equal(card.type, 'View');
  assert.match(textContent(card), /Total Paid ₹280/);
  const stats = find(card, (node) => node.props.label === 'Balance Due');
  assert.equal(stats[0].props.value, '₹1,020');
  assert.equal(find(card, (node) => node.props.text === 'Collected').length, 0);
  find(card, (node) => node.type === 'AppButton')[0].props.onPress();
  assert.equal(collected, 1);
  assert.equal(opened, 0);
  find(card, (node) => node.props.accessibilityLabel === 'Call Borrower')[0].props.onPress({ stopPropagation: () => { stopped++; } });
  assert.equal(called, 1);
  assert.equal(stopped, 1);
  const loanCard = h.render(h.load('src/components/LoanCard.tsx').LoanCard, { loan, showCustomer: true });
  assert.match(textContent(loanCard), /Total Paid ₹280/);
  assert.match(textContent(loanCard), /Balance ₹1,020/);
  assert.match(textContent(loanCard), /Incl. ₹200 charges/);
});

test('payment sheet saves positive amounts with blank/whitespace charges and rejects invalid charges', async () => {
  for (const [charges, shouldSave, expectedCharges] of [
    ['', true, 0], ['   ', true, 0], ['25.50', true, 25.5], ['invalid', false], ['-1', false], ['Infinity', false],
  ]) {
    const payments = [];
    const saved = [];
    const h = harness({ '@/db/database': { addPayment: async (input) => payments.push(input) } });
    const { CollectPaymentSheet } = h.load('src/components/CollectPaymentSheet.tsx');
    const loan = { id: 1, customer_name: 'Borrower', balance_amount: 1000, emi_amount: 100,
      disbursal_date: '2026-01-01', loan_amount: 1000, tenure_type: 'Daily', period: 10 };
    const sheet = h.render(CollectPaymentSheet, { loan, onClose: () => {}, onSaved: (value) => saved.push(value) });
    const form = sheet.props.children;
    h.states[0] = '100';
    h.states[1] = charges;
    const tree = h.render(form.type, form.props);
    const save = find(tree, (node) => node.type === 'AppButton')[0];
    await save.props.onPress();
    assert.equal(payments.length, shouldSave ? 1 : 0, `charges=${JSON.stringify(charges)}`);
    if (shouldSave) {
      assert.equal(payments[0].amount, 100);
      assert.equal(payments[0].charges_amount, expectedCharges);
      assert.deepEqual(saved, [100 + expectedCharges]);
    }
  }
});

test('loan EMI start follows disbursal/tenure until customized, supports reset and preserves custom dates on edit', async () => {
  const writes = [];
  const h = harness({ '@/db/database': { addLoan: async (input) => { writes.push(input); return 1; } } });
  const { LoanForm } = h.load('src/components/LoanForm.tsx');
  const props = { initialCustomer: { id: 1, name: 'Borrower', phone: '9876543210' } };
  const render = () => h.render(LoanForm, props);
  const date = (tree, label) => find(tree, (node) => node.type === 'DateField' && node.props.label === label)[0];
  const field = (tree, label) => find(tree, (node) => node.type === 'FormField' && node.props.label === label)[0];
  let tree = render();
  date(tree, 'Disbursal Date').props.onChange('2026-01-31');
  tree = render();
  assert.equal(date(tree, 'EMI Start Date').props.value, '2026-02-01');
  find(tree, (node) => node.type === 'SegmentedControl' && node.props.accessibilityLabel === 'Tenure type')[0].props.onChange('Monthly');
  tree = render();
  assert.equal(date(tree, 'EMI Start Date').props.value, '2026-02-28');
  date(tree, 'EMI Start Date').props.onChange('2026-03-15');
  tree = render();
  date(tree, 'Disbursal Date').props.onChange('2026-02-01');
  tree = render();
  assert.equal(date(tree, 'EMI Start Date').props.value, '2026-03-15');
  const reset = find(tree, (node) => typeof node.type === 'function' && node.props.onReset)[0];
  reset.props.onReset();
  tree = render();
  assert.equal(date(tree, 'EMI Start Date').props.value, '2026-03-01');
  field(tree, 'Loan Amount (Principal)').props.onChangeText('1000');
  field(tree, 'Period (Number of months)').props.onChangeText('3');
  date(tree, 'EMI Start Date').props.onChange('2026-03-20');
  tree = render();
  await find(tree, (node) => node.type === 'AppButton' && node.props.label === 'Save Loan')[0].props.onPress();
  assert.equal(writes[0].emi_start_date, '2026-03-20');
  const edit = harness({ '@/db/database': {} });
  const editedTree = edit.render(edit.load('src/components/LoanForm.tsx').LoanForm, {
    ...props, initialLoan: { loan_amount: 1000, period: 3, tenure_type: 'Monthly', interest_amount: 0,
      interest_rate: 0, charges: 0, interest_mode: 'AddToTotal', disbursal_date: '2026-02-01',
      emi_start_date: '2026-03-20', disbursal_amount: 1000, emi_amount: 334, total_payable: 1000 },
  });
  assert.equal(date(editedTree, 'EMI Start Date').props.value, '2026-03-20');
});

test('photo capture handles camera denial, gallery without broad permission, cancellation and persistence', async () => {
  let allowed = false;
  let result = { canceled: true, assets: null };
  const calls = [];
  const alerts = [];
  const changed = [];
  const busy = [];
  const h = harness({
    'expo-image-picker': {
      requestCameraPermissionsAsync: async () => ({ granted: allowed }),
      launchCameraAsync: async (options) => {
        assert.equal(options.allowsEditing, true);
        assert.equal(options.quality, 0.8);
        assert.deepEqual(options.aspect, [1, 1]);
        calls.push('camera'); return result;
      },
      launchImageLibraryAsync: async (options) => {
        assert.equal(options.allowsEditing, true);
        assert.equal(options.quality, 0.8);
        assert.deepEqual(options.aspect, [1, 1]);
        calls.push('gallery'); assert.deepEqual(options.mediaTypes, ['images']); return result;
      },
    },
    '@/utils/customerImages': { persistCustomerImage: async (asset) => { calls.push(asset.uri); return 'file:///documents/retained.jpg'; } },
    'react-native': { Platform: { OS: 'android' }, StyleSheet: { create: (s) => s }, Alert: { alert: (...args) => alerts.push(args) }, View: 'View' },
  });
  const component = h.load('src/components/PhotoPickerField.tsx').PhotoPickerField;
  const render = () => h.render(component, { label: 'KYC Document Photo', value: '', onChange: (uri) => changed.push(uri), onBusyChange: (value) => busy.push(value) });
  const click = async (label) => find(render(), (node) => node.type === 'AppButton' && node.props.label === label)[0].props.onPress();
  // onPress intentionally launches asynchronously; wait for the promise chain to settle.
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await click('Take Photo'); await settle();
  assert.equal(alerts.length, 1);
  assert.deepEqual(calls, []);
  await click('Choose from Gallery'); await settle();
  assert.deepEqual(changed, []);
  allowed = true;
  result = { canceled: false, assets: [{ uri: 'file:///cache/kyc.jpg' }] };
  await click('Take Photo'); await settle();
  assert.deepEqual(changed, ['file:///documents/retained.jpg']);
  assert.deepEqual(calls, ['gallery', 'camera', 'file:///cache/kyc.jpg']);
  assert.deepEqual(busy, [true, false, true, false, true, false]);
});

test('native image persistence copies out of cache; web retains an embeddable data URI', async () => {
  const copies = [];
  class Directory {
    constructor(parent, name) { this.uri = `${parent}/${name}`; }
    create(options) { assert.equal(options.idempotent, true); }
  }
  class File {
    constructor(parent, name) { this.uri = name ? `${parent.uri}/${name}` : parent; this.extension = '.png'; }
    async copy(destination) { copies.push([this.uri, destination.uri]); }
  }
  const native = harness({ 'expo-file-system': { Directory, File, Paths: { document: 'file:///documents' } } });
  const uri = await native.load('src/utils/customerImages.ts').persistCustomerImage({ uri: 'file:///cache/photo.png' });
  assert.match(uri, /^file:\/\/\/documents\/customer-images\/.*\.png$/);
  assert.deepEqual(copies, [['file:///cache/photo.png', uri]]);
  const web = harness({ 'expo-file-system': {}, 'react-native': { Platform: { OS: 'web' } } });
  assert.equal(await web.load('src/utils/customerImages.ts').persistCustomerImage({ uri: 'blob:temporary', base64: 'encoded' }), 'data:image/jpeg;base64,encoded');
});

test('multi-photo capture crops each image, appends/removes, prevents duplicate launches and retains photos on cancellation/failure', async () => {
  let allowed = false;
  let result = { canceled: true, assets: null };
  let fail = false;
  let photos = ['file:///old.jpg'];
  const launches = [], alerts = [], busy = [];
  const launch = async (options) => {
    assert.equal(options.allowsEditing, true);
    assert.equal(options.allowsMultipleSelection, false);
    assert.equal(options.quality, 0.8);
    assert.deepEqual(options.mediaTypes, ['images']);
    launches.push(options);
    return result;
  };
  const h = harness({
    'expo-image-picker': { requestCameraPermissionsAsync: async () => ({ granted: allowed }),
      launchCameraAsync: launch, launchImageLibraryAsync: launch },
    '@/utils/customerImages': { persistCustomerImage: async (asset) => {
      if (fail) throw new Error('Storage full');
      return asset.uri.replace('/cache/', '/documents/');
    } },
    'react-native': { Platform: { OS: 'android' }, View: 'View', StyleSheet: { create: (s) => s },
      Alert: { alert: (...args) => alerts.push(args) } },
  });
  const picker = h.load('src/components/MultiPhotoPicker.tsx').MultiPhotoPicker;
  const render = () => h.render(picker, { label: 'Documents', value: photos,
    onChange: (uris) => { photos = uris; }, onBusyChange: (value) => busy.push(value) });
  const button = (label) => find(render(), (node) => node.type === 'AppButton' && node.props.label === label)[0];
  button('Take Photo').props.onPress(); await settle();
  assert.equal(alerts[0][0], 'Camera permission needed');
  assert.equal(launches.length, 0);
  button('Choose from Gallery').props.onPress(); await settle();
  assert.deepEqual(photos, ['file:///old.jpg']);
  allowed = true;
  result = { canceled: false, assets: [{ uri: 'file:///cache/one.jpg' }] };
  const camera = button('Take Photo');
  camera.props.onPress(); camera.props.onPress(); await settle();
  assert.equal(launches.length, 2);
  assert.deepEqual(photos, ['file:///old.jpg', 'file:///documents/one.jpg']);
  result = { canceled: false, assets: [{ uri: 'file:///cache/two.jpg' }] };
  button('Choose from Gallery').props.onPress(); await settle();
  assert.equal(photos.length, 3);
  fail = true;
  button('Choose from Gallery').props.onPress(); await settle();
  assert.equal(photos.length, 3);
  assert.equal(alerts.at(-1)[1], 'Storage full');
  assert.equal(busy.at(-1), false);
  const gallery = find(render(), (node) => node.type === 'PhotoGallery')[0];
  gallery.props.onRemove(1);
  assert.deepEqual(photos, ['file:///old.jpg', 'file:///documents/two.jpg']);
});

test('photo gallery previews the selected full image, closes it and removes only the requested thumbnail', () => {
  const h = harness();
  const gallery = h.load('src/components/PhotoGallery.tsx').PhotoGallery;
  const removed = [];
  const props = { label: 'KYC', uris: ['file:///front.jpg', 'file:///back.jpg'], onRemove: (index) => removed.push(index) };
  let tree = h.render(gallery, props);
  assert.equal(find(tree, (node) => node.type === 'Image').length, 2);
  find(tree, (node) => node.props.accessibilityLabel === 'View KYC, photo 2 of 2')[0].props.onPress();
  tree = h.render(gallery, props);
  let preview = find(tree, (node) => node.type === 'PhotoPreview')[0];
  assert.equal(preview.props.uri, props.uris[1]);
  preview.props.onClose();
  tree = h.render(gallery, props);
  assert.equal(find(tree, (node) => node.type === 'PhotoPreview')[0].props.uri, null);
  find(tree, (node) => node.props.accessibilityLabel === 'Remove KYC, photo 1')[0].props.onPress();
  assert.deepEqual(removed, [0]);
  assert.equal(find(h.render(gallery, { ...props, onRemove: undefined }), (node) => node.props.accessibilityLabel?.startsWith('Remove')).length, 0);
});

test('loan form defaults monthly category, serializes photos and blocks saving until photo preparation ends', async () => {
  const writes = [];
  const h = harness({ '@/db/database': { addLoan: async (input) => { writes.push(input); return 1; } } });
  const form = h.load('src/components/LoanForm.tsx').LoanForm;
  const render = () => h.render(form, { initialCustomer: { id: 1, name: 'Borrower', phone: '9876543210' } });
  const field = (label) => find(render(), (node) => node.type === 'FormField' && node.props.label === label)[0];
  assert.equal(find(render(), (node) => node.type === 'FilterChips' && node.props.label === 'Monthly Loan Category').length, 0);
  find(render(), (node) => node.props.accessibilityLabel === 'Tenure type')[0].props.onChange('Monthly');
  const category = find(render(), (node) => node.type === 'FilterChips')[0];
  assert.deepEqual(category.props.options, ['Finance', 'Vehicle', 'Gold', 'Others']);
  assert.equal(category.props.value, 'Finance');
  category.props.onChange('Gold');
  field('Loan Amount (Principal)').props.onChangeText('1000');
  field('Period (Number of months)').props.onChangeText('3');
  const picker = find(render(), (node) => node.type === 'MultiPhotoPicker')[0];
  picker.props.onChange(['file:///one.jpg', 'file:///two.jpg']);
  picker.props.onBusyChange(true);
  let save = find(render(), (node) => node.type === 'AppButton' && node.props.label === 'Save Loan')[0];
  assert.equal(save.props.disabled, true);
  await save.props.onPress();
  assert.equal(writes.length, 0);
  picker.props.onBusyChange(false);
  save = find(render(), (node) => node.type === 'AppButton' && node.props.label === 'Save Loan')[0];
  await save.props.onPress();
  assert.equal(writes[0].monthly_type, 'Gold');
  assert.deepEqual(JSON.parse(writes[0].doc_uris), ['file:///one.jpg', 'file:///two.jpg']);
});

for (const tenure of ['Daily', 'Weekly']) {
  test(`editing monthly loan to ${tenure} clears category and preserves its photos`, async () => {
    const writes = [];
    const h = harness({ '@/db/database': { updateLoan: async (id, input) => writes.push(input) } });
    const form = h.load('src/components/LoanForm.tsx').LoanForm;
    const props = { initialCustomer: { id: 1, name: 'Borrower', phone: '9876543210' },
      initialLoan: batch2Loan({ tenure_type: 'Monthly', monthly_type: 'Vehicle', disbursal_amount: 1000, doc_uris: '["file:///car.jpg"]' }) };
    let tree = h.render(form, props);
    assert.equal(find(tree, (node) => node.type === 'FilterChips')[0].props.value, 'Vehicle');
    assert.deepEqual(find(tree, (node) => node.type === 'MultiPhotoPicker')[0].props.value, ['file:///car.jpg']);
    find(tree, (node) => node.props.accessibilityLabel === 'Tenure type')[0].props.onChange(tenure);
    tree = h.render(form, props);
    assert.equal(find(tree, (node) => node.type === 'FilterChips').length, 0);
    await find(tree, (node) => node.type === 'AppButton' && node.props.label === 'Save Changes')[0].props.onPress();
    assert.equal(writes[0].monthly_type, null);
    assert.equal(writes[0].doc_uris, '["file:///car.jpg"]');
  });
}

test('customer editing maps legacy KYC, validates optional alternate phones and saves multiple document URIs', async () => {
  const writes = [];
  const h = harness({ '@/db/database': {
    getCustomerById: async () => ({ id: 1, name: 'Borrower', phone: '9876543210', address: '', notes: '',
      kyc_type: 'Driving License', kyc_number: 'DL123', kyc_doc_uri: 'file:///legacy.jpg' }),
    updateCustomer: async (id, input) => writes.push(input),
  } });
  const form = h.load('src/app/customer/form.tsx').default;
  const render = () => h.render(form, {});
  render(); await settle();
  let tree = render();
  const chips = find(tree, (node) => node.type === 'FilterChips')[0];
  assert.deepEqual(chips.props.options, ['Aadhar', 'License', 'Others']);
  assert.equal(chips.props.value, 'License');
  assert.deepEqual(find(tree, (node) => node.type === 'MultiPhotoPicker')[0].props.value, ['file:///legacy.jpg']);
  const alternate = () => find(render(), (node) => node.type === 'FormField' && node.props.label === 'Alternate Contact Number')[0];
  const save = () => find(render(), (node) => node.type === 'AppButton' && node.props.label === 'Save Changes')[0].props.onPress();
  assert.equal(alternate().props.keyboardType, 'phone-pad');
  for (const invalid of ['123456', '1234567890123456', 'invalid']) {
    alternate().props.onChangeText(invalid);
    await save();
    assert.equal(writes.length, 0);
    assert.match(alternate().props.error, /7–15 digits/);
  }
  for (const valid of ['', '1234567', '+91 98765 43210', '123456789012345']) {
    alternate().props.onChangeText(valid);
    assert.equal(alternate().props.error, undefined);
  }
  tree = render();
  find(tree, (node) => node.type === 'MultiPhotoPicker')[0].props.onChange(['file:///legacy.jpg', 'file:///back.jpg']);
  await save();
  assert.equal(writes[0].alternate_phone, '123456789012345');
  assert.equal(writes[0].kyc_type, 'License');
  assert.equal(writes[0].kyc_number, 'DL123');
  assert.deepEqual(JSON.parse(writes[0].kyc_doc_uri), ['file:///legacy.jpg', 'file:///back.jpg']);
});

test('customers keep search/add fixed, scroll metrics/filters, and search all contact/KYC fields with exclusive loan filters', () => {
  const customer = (id, fields) => ({ id, name: `Customer ${id}`, phone: '', alternate_phone: '', kyc_number: '',
    guarantor_name: '', active_loans: 0, balance_due: 0, ...fields });
  const customers = [
    customer(1, { name: 'Alice', phone: '9000000001', active_loans: 2, balance_due: 400 }),
    customer(2, { name: 'Bob', alternate_phone: '7888888', active_loans: 1, balance_due: 600 }),
    customer(3, { name: 'Carla', kyc_number: 'DL1234' }),
    customer(4, { name: 'Devi' }),
  ];
  const navigation = [];
  const h = harness({ '@/db/database': {},
    'expo-router': { router: { push: (destination) => navigation.push(destination) } },
    '@/hooks/useDbQuery': { useDbQuery: () => ({ data: customers, loading: false, reload: () => {} }) },
  });
  const screen = h.load('src/app/(tabs)/customers.tsx').default;
  const render = () => h.render(screen, {});
  const list = () => find(render(), (node) => node.type === 'FlatList')[0];
  const header = () => list().props.ListHeaderComponent;
  const filters = () => find(header(), (node) => node.type === 'FilterChips')[0];
  const search = (query) => find(render(), (node) => node.props.accessibilityLabel === 'Search customers')[0].props.onChangeText(query);
  const ids = () => list().props.data.map((item) => item.id);
  assert.equal(find(header(), (node) => node.props.accessibilityLabel === 'Search customers').length, 0);
  assert.equal(find(header(), (node) => node.props.label === '+ Customer').length, 0);
  find(render(), (node) => node.props.label === '+ Customer')[0].props.onPress();
  assert.deepEqual(navigation, ['/customer/form']);
  const metrics = find(header(), (node) => node.type === 'MetricStrip')[0].props.items;
  assert.deepEqual(metrics.map((metric) => [metric.label, metric.value]), [
    ['Total Customers', 4], ['Active Borrowers', 2], ['Total Balance Due', '₹1,000'],
  ]);
  assert.deepEqual(filters().props.options, ['All', 'Active Loans', 'Settled / None']);
  filters().props.onChange('Active Loans'); assert.deepEqual(ids(), [1, 2]);
  filters().props.onChange('Settled / None'); assert.deepEqual(ids(), [3, 4]);
  filters().props.onChange('All');
  for (const [query, expected] of [[' alice ', [1]], ['9000000001', [1]], ['7888888', [2]], ['dl1234', [3]], ['missing', []]]) {
    search(query); assert.deepEqual(ids(), expected);
  }
  assert.equal(find(header(), (node) => node.type === 'MetricStrip')[0].props.items[0].value, 4);
  find(render(), (node) => node.props.accessibilityLabel === 'Clear search')[0].props.onPress();
  assert.deepEqual(ids(), [1, 2, 3, 4]);
});

test('compact customer cards show KYC, alternate indicator and balance, and calls do not open the customer', () => {
  const dialed = [];
  let opened = 0, stopped = 0;
  const h = harness({ 'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: (s) => s },
    Linking: { openURL: async (uri) => dialed.push(uri) }, Alert: { alert: () => {} } } });
  const card = h.load('src/components/CustomerCard.tsx').CustomerCard;
  const customer = { id: 1, name: 'Alice', phone: '+91 98765 43210', alternate_phone: '7123456', photo_uri: 'file:///alice.jpg',
    kyc_type: 'Aadhar', active_loans: 2, balance_due: 500 };
  const tree = h.render(card, { customer, onPress: () => { opened++; } });
  assert.match(textContent(tree), /AliceAadhar/);
  assert.match(textContent(tree), /2 active loans₹500 due/);
  assert.equal(find(tree, (node) => node.props.accessibilityLabel === 'Alternate phone: 7123456').length, 1);
  const avatar = find(tree, (node) => node.props.uri === customer.photo_uri)[0];
  assert.equal(avatar.props.size, 44);
  find(tree, (node) => node.props.accessibilityLabel === 'Call Alice')[0].props.onPress({ stopPropagation: () => { stopped++; } });
  assert.deepEqual(dialed, ['tel:+919876543210']);
  assert.equal(stopped, 1); assert.equal(opened, 0);
  tree.props.onPress(); assert.equal(opened, 1);
  const noPhone = h.render(card, { customer: { ...customer, phone: '', alternate_phone: '', kyc_type: '' }, onPress: () => {} });
  assert.equal(find(noPhone, (node) => node.props.accessibilityLabel === 'Call Alice').length, 0);
});

function accountHarness(status = 'trial') {
  const calls = [], alerts = [], busy = [];
  const session = { status, daysLeft: 3, deviceId: 'TSA-AAAA-1111', profile: { name: 'Admin', email: 'admin@example.com',
    trialEndsAt: '2026-11-25T00:00:00Z', subscriptionExpiresAt: '2026-12-31T00:00:00Z' } };
  const drive = { connected: true, email: 'drive@example.com', busy: false, requestReady: true, autoSync: false,
    lastSyncedAt: null, connect: async () => calls.push('connect') };
  const h = harness({
    '@/hooks/useAuthLicense': { useAuthLicense: () => session },
    '@/hooks/useGoogleDrive': { useGoogleDrive: () => drive },
    '@/config/firebase': { auth: { currentUser: { emailVerified: false } } },
    '@/services/authLicenseService': { logoutUser: async () => calls.push('logout'), messageForError: (e) => e.message,
      refreshLicenseStatus: async () => calls.push('license'), resendVerificationEmail: async () => calls.push('verify') },
    '@/services/googleDriveBackup': { scheduleAutoSync: () => {}, isDriveConfigured: () => true,
      uploadBackupToGoogleDrive: async () => calls.push('upload'), disconnectGoogleDrive: async () => calls.push('disconnect'),
      setDriveAutoSync: async (enabled) => calls.push(['auto', enabled]),
      previewBackupFromGoogleDrive: async () => ({ summary: { exportedAt: '2026-11-20T00:00:00Z',
        counts: { customers: 2, loans: 3, payments: 4, expenses: 1 } } }),
      restoreBackupFromGoogleDrive: async () => calls.push('restore') },
    '@/utils/backup': { shareBackup: async () => calls.push('share') },
    'expo-clipboard': { setStringAsync: async (value) => calls.push(['copy', value]) },
    'react-native': { View: 'View', Pressable: 'Pressable', Switch: 'Switch', StyleSheet: { create: (s) => s },
      Alert: { alert: (...args) => alerts.push(args) } },
  });
  const component = h.load('src/components/AccountCloudCards.tsx').AccountCloudCards;
  const render = (disabled = false) => h.render(component, { disabled, onBusyChange: (value) => busy.push(value),
    onRestored: () => calls.push('refreshed'), children: { type: 'Snapshot', props: {} } });
  const button = (label) => find(render(), (node) => node.type === 'AppButton' && node.props.label === label)[0];
  return { calls, alerts, busy, session, drive, render, button };
}

test('account hero displays truthful license pills, email/device, and the snapshot before cloud sync', async () => {
  for (const [status, expected] of [['active', 'Active Plan'], ['trial', '7-Day Trial · 3 days left'],
    ['expired', 'Plan Expired'], ['tampered', 'Device Time Check'], ['offline-check-required', 'License Check Needed']]) {
    const a = accountHarness(status);
    const tree = a.render();
    assert.match(textContent(tree.props.children[0]), new RegExp(expected));
    assert.match(textContent(tree.props.children[0]), /admin@example.com/);
    assert.match(textContent(tree.props.children[0]), /TSA-AAAA-1111/);
    assert.equal(tree.props.children[1].type, 'Snapshot');
    assert.match(textContent(tree.props.children[2]), /Google Drive Cloud Sync/);
    if (status === 'active') assert.match(textContent(tree.props.children[0]), /Valid until/);
    if (status === 'trial') assert.match(textContent(tree.props.children[0]), /Trial ends/);
  }
  const a = accountHarness();
  find(a.render(), (node) => node.props.accessibilityLabel === 'Copy Device ID TSA-AAAA-1111')[0].props.onPress();
  await settle();
  assert.deepEqual(a.calls, [['copy', 'TSA-AAAA-1111']]);
  a.button('Refresh License Status').props.onPress(); await settle();
  a.button('Resend Email Verification').props.onPress(); await settle();
  assert.ok(a.calls.includes('license')); assert.ok(a.calls.includes('verify'));
  assert.equal(a.button('Sign Out').props.disabled, false);
  assert.equal(find(a.render(true), (node) => node.props.label === 'Sign Out')[0].props.disabled, true);
});

test('redesigned account/cloud actions retain restore and sign-out confirmations and prevent duplicate uploads', async () => {
  const a = accountHarness();
  const upload = a.button('Sync Backup to Drive Now');
  upload.props.onPress(); upload.props.onPress(); await settle();
  assert.equal(a.calls.filter((call) => call === 'upload').length, 1);
  find(a.render(), (node) => node.type === 'Switch')[0].props.onValueChange(true); await settle();
  assert.ok(a.calls.some((call) => Array.isArray(call) && call[0] === 'auto' && call[1]));
  a.button('Restore from Google Drive').props.onPress(); await settle();
  assert.ok(!a.calls.includes('restore'));
  a.alerts.at(-1)[2].find((option) => option.text === 'Cancel').onPress(); await settle();
  assert.ok(!a.calls.includes('restore'));
  a.button('Restore from Google Drive').props.onPress(); await settle();
  a.alerts.at(-1)[2].find((option) => option.text === 'Restore & Replace').onPress(); await settle();
  assert.ok(a.calls.includes('restore')); assert.ok(a.calls.includes('refreshed'));
  a.button('Sign Out').props.onPress();
  assert.ok(!a.calls.includes('logout'));
  a.alerts.at(-1)[2].find((option) => option.text === 'Sign Out').onPress(); await settle();
  assert.ok(a.calls.includes('logout'));
  assert.equal(a.busy.at(-1), false);
});

test('Profile groups exports/restore/manage actions, keeps three snapshot metrics and blocks data actions during cloud work', async () => {
  const calls = [];
  const overrides = {
    '@/db/database': { clearAllData: async () => calls.push('clear'), importDatabaseFromJson: async () => calls.push('restore') },
    '@/db/devSeed': { seedDemoData: async () => calls.push('seed') },
    '@/utils/backup': { canSaveToFolder: true, shareBackup: async () => calls.push('share'),
      saveBackupToFolder: async () => { calls.push('folder'); return null; }, pickBackupFile: async () => null },
    '@/hooks/useDbQuery': { useDbQuery: () => ({ data: { counts: { customers: 2, loans: 3, payments: 4, expenses: 1 } },
      loading: false, reload: async () => {} }) },
  };
  const h = harness(overrides);
  const screen = h.load('src/app/(tabs)/settings.tsx').default;
  const render = () => h.render(screen, {});
  let tree = render();
  assert.deepEqual(find(tree, (node) => node.type === 'MetricStrip')[0].props.items.map((item) => [item.label, item.value]),
    [['Customers', 2], ['Loans', 3], ['Payments', 4]]);
  const section = (title) => find(render(), (node) => node.props.title === title)[0];
  assert.deepEqual(find(section('Export & Excel Reports'), (node) => node.type === 'AppButton').map((node) => node.props.label),
    ['Share JSON Backup', 'Save Backup to Folder']);
  assert.equal(find(section('Export & Excel Reports'), (node) => node.type === 'ExcelExportButtons').length, 1);
  assert.equal(section('Manage Data').props.subtle, true);
  assert.equal(find(section('Manage Data'), (node) => node.props.label === 'Seed Demo Data').length, 1);
  const share = find(tree, (node) => node.props.label === 'Share JSON Backup')[0];
  await share.props.onPress(); assert.deepEqual(calls, ['share']);
  find(render(), (node) => node.type === 'AccountCloudCards')[0].props.onBusyChange(true);
  tree = render();
  assert.equal(find(tree, (node) => node.props.label === 'Import Backup File')[0].props.disabled, true);
  assert.equal(find(tree, (node) => node.type === 'ExcelExportButtons')[0].props.disabled, true);
  const release = harness(overrides, { dev: false });
  const releaseTree = release.render(release.load('src/app/(tabs)/settings.tsx').default, {});
  assert.equal(find(releaseTree, (node) => node.props.label === 'Seed Demo Data').length, 0);
  assert.equal(find(releaseTree, (node) => node.props.label === 'Clear All Data').length, 1);
});
