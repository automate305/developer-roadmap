import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useT } from '../i18n';
import { colors, fonts, radius, spacing, TAP_TARGET, typography } from '../theme';

export interface SelectItem {
  /** What is stored. */
  value: string;
  /** What is shown. Defaults to the value. */
  label?: string;
}

interface Props {
  label: string;
  value: string;
  options: (string | SelectItem)[];
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  /** Let the client type something not in the list. */
  allowCustom?: boolean;
  optional?: boolean;
}

/**
 * Dropdown that opens a full-screen list with a search box. Works identically
 * on iOS, Android and web, and the rows are big enough to tap easily.
 */
export function Select({ label, value, options, onChange, placeholder, hint, error, allowCustom, optional }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const items: SelectItem[] = useMemo(
    () => options.map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value })),
    [options],
  );
  const selected = items.find((i) => i.value === value);
  const shown = selected?.label ?? value;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((o) => (o.label ?? o.value).toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [items, query]);

  const customMatch =
    allowCustom && query.trim() && !items.some((o) => (o.label ?? o.value).toLowerCase() === query.trim().toLowerCase());

  const pick = (v: string) => {
    onChange(v);
    setQuery('');
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={typography.label}>
        {label}
        {optional ? <Text style={styles.optional}> {t('optional')}</Text> : null}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown || placeholder || t('tapToChoose')}`}
        onPress={() => setOpen(true)}
        style={[styles.trigger, error ? styles.triggerError : null]}
      >
        <Text style={[styles.triggerText, !value && styles.placeholder]} numberOfLines={1}>
          {shown || placeholder || t('tapToChoose')}
        </Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={typography.small}>{hint}</Text> : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={typography.heading}>{label}</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={12} accessibilityRole="button">
              <Text style={styles.close}>{t('close')}</Text>
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={allowCustom ? t('searchOrType') : t('search')}
            placeholderTextColor={colors.placeholder}
            style={styles.search}
            autoFocus
            autoCorrect={false}
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.value}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              customMatch ? (
                <Pressable style={[styles.row, styles.customRow]} onPress={() => pick(query.trim())}>
                  <Text style={styles.rowText}>{t('useCustom', { value: query.trim() })}</Text>
                </Pressable>
              ) : null
            }
            renderItem={({ item }) => {
              const isSelected = item.value === value;
              return (
                <Pressable style={[styles.row, isSelected && styles.rowSelected]} onPress={() => pick(item.value)}>
                  <Text style={[styles.rowText, isSelected && styles.rowTextSelected]}>{item.label ?? item.value}</Text>
                  {isSelected ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={!customMatch ? <Text style={[typography.small, styles.empty]}>{t('noMatches')}</Text> : null}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  optional: { color: colors.textMuted, fontFamily: fonts.sans },
  trigger: {
    minHeight: TAP_TARGET + 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  triggerError: { borderColor: colors.danger },
  triggerText: { fontSize: 17, fontFamily: fonts.sans, color: colors.text, flex: 1 },
  placeholder: { color: colors.placeholder },
  chevron: { fontSize: 22, color: colors.textMuted, marginTop: -8 },
  error: { color: colors.danger, fontSize: 14, fontFamily: fonts.sans },
  modal: { flex: 1, backgroundColor: colors.background },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
  close: { color: colors.brandBlue, fontSize: 17, fontFamily: fonts.sansBold },
  search: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    minHeight: TAP_TARGET,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    fontSize: 17,
    fontFamily: fonts.sans,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  row: {
    minHeight: TAP_TARGET + 8,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowSelected: { backgroundColor: colors.primaryLight },
  customRow: { backgroundColor: colors.brandBlueLight },
  rowText: { fontSize: 17, fontFamily: fonts.sans, color: colors.text },
  rowTextSelected: { fontFamily: fonts.sansBold, color: colors.primary },
  check: { color: colors.brandBlue, fontSize: 18, fontFamily: fonts.sansBold },
  empty: { padding: spacing.xl, textAlign: 'center' },
});
