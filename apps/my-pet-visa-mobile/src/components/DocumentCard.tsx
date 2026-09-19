import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AttachmentPicker } from './AttachmentPicker';
import { Card } from './Card';
import { Choice } from './Choice';
import { DateField } from './DateField';
import { Field } from './Field';
import type { DocDefinition } from '../data/documents';
import { DOC_STATUS_OPTIONS } from '../data/options';
import { colors, fonts, radius, spacing, typography } from '../theme';
import type { DocumentEntry } from '../types';
import { daysUntil, isPastDate } from '../utils';

interface Props {
  def: DocDefinition;
  /** null = the client has not answered yet. */
  entry: DocumentEntry | null;
  onChange: (entry: DocumentEntry) => void;
  onRemove?: () => void;
  travelDate?: string;
}

export function DocumentCard({ def, entry: saved, onChange, onRemove, travelDate }: Props) {
  const entry: DocumentEntry = saved ?? { docId: def.id, status: 'missing', attachments: [] };
  const answered = saved !== null;
  const hasIt = answered && (entry.status === 'current' || entry.status === 'expired');
  const expired = entry.expiresOn ? isPastDate(entry.expiresOn) : false;
  const expiresBeforeTrip = (() => {
    const tripDays = daysUntil(travelDate);
    const expDays = daysUntil(entry.expiresOn);
    return tripDays !== null && expDays !== null && expDays < tripDays;
  })();

  return (
    <Card>
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <Text style={typography.subheading}>{def.label}</Text>
          {def.essential ? <Text style={styles.essential}>Required</Text> : null}
        </View>
        {onRemove ? (
          <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${def.label}`}>
            <Text style={styles.remove}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={typography.small}>{def.help}</Text>

      <Choice
        label="Do you have this?"
        options={DOC_STATUS_OPTIONS}
        value={answered ? entry.status : ''}
        onChange={(status) => onChange({ ...entry, status })}
      />

      {hasIt && def.tracksExpiry ? (
        <View style={styles.dates}>
          <View style={styles.dateCol}>
            <DateField label="Given on" value={entry.issuedOn ?? ''} onChange={(issuedOn) => onChange({ ...entry, issuedOn })} optional />
          </View>
          <View style={styles.dateCol}>
            <DateField label="Expires" value={entry.expiresOn ?? ''} onChange={(expiresOn) => onChange({ ...entry, expiresOn })} optional />
          </View>
        </View>
      ) : null}

      {hasIt && (expired || expiresBeforeTrip) ? (
        <View style={styles.warn}>
          <Text style={styles.warnText}>
            {expired ? 'This looks expired. ' : 'This expires before your trip. '}
            We will plan a renewal into your timeline.
          </Text>
        </View>
      ) : null}

      {answered && entry.status === 'missing' && def.essential ? (
        <View style={styles.warn}>
          <Text style={styles.warnText}>No problem. We will map this into your plan.</Text>
        </View>
      ) : null}

      {hasIt ? (
        <>
          <Text style={typography.label}>Attach a photo or PDF</Text>
          <AttachmentPicker attachments={entry.attachments} onChange={(attachments) => onChange({ ...entry, attachments })} />
          <Field
            label="Notes"
            value={entry.notes ?? ''}
            onChangeText={(notes) => onChange({ ...entry, notes })}
            optional
            placeholder="e.g. given at another clinic"
          />
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  titleWrap: { flex: 1, gap: spacing.xs },
  essential: {
    alignSelf: 'flex-start',
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  remove: { color: colors.danger, fontFamily: fonts.sansSemiBold },
  dates: { flexDirection: 'row', gap: spacing.md },
  dateCol: { flex: 1 },
  warn: { backgroundColor: colors.warningLight, padding: spacing.md, borderRadius: radius.md },
  warnText: { ...typography.small, color: colors.warning, fontFamily: fonts.sansSemiBold },
});
