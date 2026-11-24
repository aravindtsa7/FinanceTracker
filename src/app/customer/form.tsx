import { router, Stack, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { AppText as Text } from '@/components/AppText';
import { EmptyState } from '@/components/EmptyState';
import { FormField } from '@/components/FormField';
import { FilterChips } from '@/components/FilterChips';
import { MultiPhotoPicker } from '@/components/MultiPhotoPicker';
import { PhotoPickerField } from '@/components/PhotoPickerField';
import { SectionTitle } from '@/components/ScreenState';
import { Colors, Spacing } from '@/constants/theme';
import { addCustomer, getCustomerById, updateCustomer } from '@/db/database';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { KYC_ID_TYPES, normalizeKycType } from '@/utils/customerKyc';
import { parseUriList } from '@/utils/photoUris';
import { isValidPhone } from '@/utils/phone';

interface FormValues {
  name: string;
  phone: string;
  alternate_phone: string;
  address: string;
  photo_uri: string;
  kyc_type: string;
  kyc_number: string;
  kyc_doc_uri: string;
  notes: string;
}
type FormErrors = Partial<Record<keyof FormValues, string>>;

const EMPTY: FormValues = {
  name: '',
  phone: '',
  alternate_phone: '',
  address: '',
  photo_uri: '',
  kyc_type: '',
  kyc_number: '',
  kyc_doc_uri: '[]',
  notes: '',
};

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.name.trim()) errors.name = 'Customer name is required';
  if (!values.phone.trim()) errors.phone = 'Phone number is required';
  else if (!isValidPhone(values.phone)) errors.phone = 'Enter a valid phone number (7–15 digits)';
  if (values.alternate_phone.trim() && !isValidPhone(values.alternate_phone)) {
    errors.alternate_phone = 'Enter a valid phone number (7–15 digits)';
  }
  return errors;
}

export default function CustomerFormScreen() {
  const { pagePadding } = useResponsiveLayout();
  // `next=loan`: opened from the New Loan customer picker, so continue to the loan form after creating.
  const params = useLocalSearchParams<{ id?: string; next?: string }>();
  const editId = params.id ? Number(params.id) : null;
  const isEdit = editId !== null;
  const insets = useSafeAreaInsets();

  const [values, setValues] = useState<FormValues>(EMPTY);
  const [initialValues, setInitialValues] = useState<FormValues>(EMPTY);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const handledLeave = useRef<(() => void) | null>(null);
  const alertOpen = useRef(false);
  const navigation = useNavigation();
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing'>(isEdit ? 'loading' : 'ready');
  const dirty = loadState === 'ready' &&
    (Object.keys(EMPTY) as (keyof FormValues)[]).some((field) => values[field] !== initialValues[field]);

  const confirmDiscard = useCallback((leave: () => void) => {
    if (alertOpen.current || saving) return;
    alertOpen.current = true;
    Alert.alert('Discard changes?', 'You have unsaved customer details. Are you sure you want to go back?', [
      { text: 'Stay', style: 'cancel', onPress: () => { alertOpen.current = false; } },
      { text: 'Discard', style: 'destructive', onPress: () => {
        alertOpen.current = false;
        setInitialValues(values);
        setPendingLeave(() => leave);
      } },
    ], { cancelable: false });
  }, [saving, values]);

  // SDK 57 exposes the native-stack-aware hook through Expo Router's React Navigation exports.
  usePreventRemove(dirty, ({ data }) => confirmDiscard(() => navigation.dispatch(data.action)));

  // Wait for removal prevention to be disabled before replaying a discard or successful save.
  useEffect(() => {
    if (!dirty && pendingLeave && handledLeave.current !== pendingLeave) {
      handledLeave.current = pendingLeave;
      pendingLeave();
    }
  }, [dirty, pendingLeave]);

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!dirty) return false;
      confirmDiscard(() => {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)/customers');
      });
      return true;
    });
    return () => subscription.remove();
  }, [dirty, confirmDiscard]));

  const phoneRef = useRef<TextInput>(null);
  const alternatePhoneRef = useRef<TextInput>(null);
  const addressRef = useRef<TextInput>(null);
  const notesRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (editId === null) return;
    let cancelled = false;
    getCustomerById(editId)
      .then((customer) => {
        if (cancelled) return;
        if (!customer) {
          setLoadState('missing');
          return;
        }
        const loaded = {
          name: customer.name,
          phone: customer.phone,
          alternate_phone: customer.alternate_phone ?? '',
          address: customer.address,
          photo_uri: customer.photo_uri ?? '',
          kyc_type: normalizeKycType(customer.kyc_type),
          kyc_number: customer.kyc_number ?? '',
          kyc_doc_uri: JSON.stringify(parseUriList(customer.kyc_doc_uri)),
          notes: customer.notes,
        };
        setValues(loaded);
        setInitialValues(loaded);
        setLoadState('ready');
      })
      .catch(() => !cancelled && setLoadState('missing'));
    return () => {
      cancelled = true;
    };
  }, [editId]);

  const setField = (field: keyof FormValues) => (text: string) => {
    setValues((current) => ({ ...current, [field]: text }));
    // After the first save attempt, re-validate as the user types so errors clear immediately.
    if (submitted) setErrors(validate({ ...values, [field]: text }));
  };

  const save = async () => {
    if (saving || pickingPhoto) return;
    setSubmitted(true);
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      if (isEdit) {
        await updateCustomer(editId, values);
        setInitialValues(values);
        setPendingLeave(() => () => router.back());
        return;
      }
      const id = String(await addCustomer(values));
      setInitialValues(values);
      // Replace the form so Back from the next screen doesn't return to a stale form.
      setPendingLeave(() => () => {
        if (params.next === 'loan') router.replace({ pathname: '/loan/new', params: { customerId: id } });
        else router.replace({ pathname: '/customer/[id]', params: { id } });
      });
    } catch (e) {
      Alert.alert('Could not save customer', e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const title = isEdit ? 'Edit Customer' : 'Add Customer';

  if (loadState !== 'ready') {
    return (
      <View style={styles.center}>
        <Stack.Title>{title}</Stack.Title>
        {loadState === 'loading' ? (
          <ActivityIndicator size="large" color={Colors.emerald} />
        ) : (
          <EmptyState
            icon="person-remove-outline"
            title="Customer not found"
            message="This customer may have been deleted."
            action={<AppButton label="Go back" variant="secondary" onPress={() => router.back()} />}
          />
        )}
      </View>
    );
  }

  const errorCount = Object.keys(errors).length;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 20}>
      <Stack.Title>{title}</Stack.Title>
      <ScrollView
        ref={scrollViewRef}
        pointerEvents={saving ? 'none' : 'auto'}
        contentContainerStyle={[styles.content, { paddingHorizontal: pagePadding }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive">
        <SectionTitle>Customer</SectionTitle>
        <PhotoPickerField label="Customer Photo" value={values.photo_uri} onChange={setField('photo_uri')}
          disabled={saving || pickingPhoto} onBusyChange={setPickingPhoto} />
        <FormField
          label="Customer Name"
          required
          value={values.name}
          onChangeText={setField('name')}
          error={errors.name}
          placeholder="e.g. Ravi Kumar"
          autoCapitalize="words"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => phoneRef.current?.focus()}
        />
        <FormField
          ref={phoneRef}
          label="Phone Number"
          required
          value={values.phone}
          onChangeText={setField('phone')}
          error={errors.phone}
          placeholder="e.g. 98765 43210"
          keyboardType="phone-pad"
          autoComplete="tel"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => alternatePhoneRef.current?.focus()}
        />
        <FormField
          ref={alternatePhoneRef}
          label="Alternate Contact Number"
          value={values.alternate_phone}
          onChangeText={setField('alternate_phone')}
          error={errors.alternate_phone}
          placeholder="Optional"
          keyboardType="phone-pad"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => addressRef.current?.focus()}
        />
        <FormField
          ref={addressRef}
          label="Address"
          value={values.address}
          onChangeText={setField('address')}
          placeholder="House / street, area, town"
          multiline
        />

        <SectionTitle>KYC Details</SectionTitle>
        <FilterChips label="KYC ID Type" options={KYC_ID_TYPES}
          value={values.kyc_type} onChange={setField('kyc_type')} />
        <FormField label="KYC ID Number" value={values.kyc_number} onChangeText={setField('kyc_number')}
          placeholder="Optional" autoCapitalize="characters" autoCorrect={false} />
        <MultiPhotoPicker label="KYC Document Photos" value={parseUriList(values.kyc_doc_uri)}
          onChange={(uris) => setField('kyc_doc_uri')(JSON.stringify(uris))}
          disabled={saving || pickingPhoto} onBusyChange={setPickingPhoto} />

        <SectionTitle>Other</SectionTitle>
        <FormField
          ref={notesRef}
          label="Notes / ID Proof Info"
          value={values.notes}
          onChangeText={setField('notes')}
          onFocus={() => {
            setTimeout(() => {
              scrollViewRef.current?.scrollToEnd({ animated: true });
            }, 150);
          }}
          placeholder="e.g. Aadhaar last 4 digits, occupation, reference"
          multiline
        />
      </ScrollView>

      <View style={[styles.footer, { paddingHorizontal: pagePadding }, { paddingBottom: Spacing.md + insets.bottom }]}>
        {errorCount > 0 && (
          <Text style={styles.footerError}>
            Please fix {errorCount === 1 ? 'the highlighted field' : `${errorCount} highlighted fields`}.
          </Text>
        )}
        <AppButton
          label={isEdit ? 'Save Changes' : 'Save Customer'}
          icon="checkmark-circle"
          loading={saving}
          disabled={pickingPhoto}
          onPress={save}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: 160 },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.sm,
  },
  footerError: { color: Colors.danger, fontSize: 13, textAlign: 'center' },
});
