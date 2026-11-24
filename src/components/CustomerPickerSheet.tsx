import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppText as Text, AppTextInput as TextInput } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { EmptyState } from '@/components/EmptyState';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getCustomers } from '@/db/database';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { Customer } from '@/types/finance';

interface CustomerPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (customer: Customer) => void;
  onCreateNew: () => void;
  selectedId?: number;
}

export function CustomerPickerSheet({ visible, onClose, onSelect, onCreateNew, selectedId }: CustomerPickerSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Select Customer" tall>
      {/* Mounted only while open so each opening starts with a fresh list and empty search. */}
      {visible && <PickerBody onSelect={onSelect} onCreateNew={onCreateNew} selectedId={selectedId} />}
    </BottomSheet>
  );
}

function PickerBody({ onSelect, onCreateNew, selectedId }: Omit<CustomerPickerSheetProps, 'visible' | 'onClose'>) {
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search.trim(), 150);
  const { data: customers } = useDbQuery(getCustomers, query);

  return (
    <View style={styles.body}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, phone or guarantor"
          placeholderTextColor={Colors.tabInactive}
          style={styles.searchInput}
          autoCorrect={false}
          autoFocus
          accessibilityLabel="Search customers"
        />
      </View>
      <AppButton label="New Customer" icon="person-add" variant="outline" compact onPress={onCreateNew} />
      <FlatList
        data={customers ?? []}
        keyExtractor={(c) => String(c.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const selected = item.id === selectedId;
          return (
            <Pressable
              onPress={() => onSelect(item)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.rowText}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {item.phone}
                  {item.guarantor_name ? ` · Jamin: ${item.guarantor_name}` : ''}
                </Text>
              </View>
              {selected && <Ionicons name="checkmark-circle" size={22} color={Colors.emeraldDark} />}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          customers ? (
            <EmptyState
              icon={query ? 'search-outline' : 'people-outline'}
              title={query ? 'No matches' : 'No customers yet'}
              message={query ? `Nobody matches “${query}”.` : 'Create a customer first.'}
            />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: Spacing.md },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    minHeight: 48,
  },
  searchInput: { flex: 1, fontSize: 16, color: Colors.text, paddingVertical: Spacing.sm },
  list: { gap: Spacing.sm, paddingBottom: Spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  rowSelected: { borderColor: Colors.emerald },
  pressed: { opacity: 0.7 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Colors.textOnDark, fontWeight: '700' },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '700', color: Colors.text },
  meta: { fontSize: 13, color: Colors.textMuted },
});
