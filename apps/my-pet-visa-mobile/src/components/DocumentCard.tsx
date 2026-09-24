import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AttachmentPicker } from './AttachmentPicker';
import { Card } from './Card';
import { Choice } from './Choice';
import { DateField } from './DateField';
import { Field } from './Field';
import type { DocDefinition } from '../data/documents';
import { DOC_STATUS_OPTIONS, localize } from '../data/options';
import { useLanguage } from '../i18n';
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
  const { t, lang } = useLanguage();
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
          <Text style={typography.subheading}>{def.label[lang]}</Text>
          {def.essential ? <Text style={styles.essential}>{t('docRequired')}</Text> : null}
        </View>
        {onRemove ? (
          <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${t('remove')} ${def.label[lang]}`}>
            <Text style={styles.remove}>{t('remove')}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={typography.small}>{def.help[lang]}</Text>

      <Choice
        label={t('docHaveIt')}
        options={localize(DOC_STATUS_OPTIONS, lang)}
        value={answered ? entry.status : ''}
        onChange={(status) => onChange({ ...entry, status })}
      />

      {hasIt && def.tracksExpiry ? (
        <View style={styles.dates}>
          <View style={styles.dateCol}>
            <DateField label={t('docGivenOn')} value={entry.issuedOn ?? ''} onChange={(issuedOn) => onChange({ ...entry, issuedOn })} optional />
          </View>
          <View style={styles.dateCol}>
            <DateField label={t('docExpires')} value={entry.expiresOn ?? ''} onChange={(expiresOn) => onChange({ ...entry, expiresOn })} optional />
          </View>
        </View>
      ) : null}

      {hasIt && (expired || expiresBeforeTrip) ? (
        <View style={styles.warn}>
          <Text style={styles.warnText}>{expired ? t('docExpiredWarn') : t('docExpiresBeforeTrip')}</Text>
        </View>
      ) : null}

      {answered && entry.status === 'missing' && def.essential ? (
        <View style={styles.warn}>
          <Text style={styles.warnText}>{t('docMissingEssential')}</Text>
        </View>
      ) : null}

      {hasIt ? (
        <>
          <Text style={typography.label}>{t('docAttach')}</Text>
          <AttachmentPicker attachments={entry.attachments} onChange={(attachments) => onChange({ ...entry, attachments })} />
          <Field
            label={t('docNotes')}
            value={entry.notes ?? ''}
            onChangeText={(notes) => onChange({ ...entry, notes })}
            optional
            placeholder={t('docNotesPlaceholder')}
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
