import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { DocumentCard } from '../components/DocumentCard';
import { Screen } from '../components/Screen';
import { Select } from '../components/Select';
import { StepHeader } from '../components/StepHeader';
import { CATEGORY_LABELS, documentsForSpecies } from '../data/documents';
import { useLanguage, type Lang } from '../i18n';
import { colors, fonts, radius, spacing, typography } from '../theme';
import type { DocumentEntry, Intake } from '../types';

interface Props {
  intake: Intake;
  onChange: (patch: Partial<Intake>) => void;
  onNext: () => void;
  onBack: () => void;
  showErrors: boolean;
}

function emptyEntry(docId: string): DocumentEntry {
  return { docId, status: 'missing', attachments: [] };
}

/** Essentials must have an answer; anything else is optional. Returns the unanswered labels. */
export function unansweredEssentials(i: Intake, lang: Lang): string[] {
  return documentsForSpecies(i.species)
    .filter((d) => d.essential && !i.documents[d.id])
    .map((d) => d.label[lang]);
}

export function DocumentsScreen({ intake, onChange, onNext, onBack, showErrors }: Props) {
  const { t, lang } = useLanguage();
  const available = useMemo(() => documentsForSpecies(intake.species), [intake.species]);
  const essentials = available.filter((d) => d.essential);
  const extras = available.filter((d) => !d.essential);

  const addedExtras = extras.filter((d) => intake.documents[d.id]);
  const notAdded = extras.filter((d) => !intake.documents[d.id]);

  const setEntry = (docId: string, entry: DocumentEntry | null) => {
    const documents = { ...intake.documents };
    if (entry) documents[docId] = entry;
    else delete documents[docId];
    onChange({ documents });
  };

  const missing = showErrors ? unansweredEssentials(intake, lang) : [];

  return (
    <Screen
      footer={
        <>
          <Button title={t('docsNext')} onPress={onNext} />
          <Button title={t('back')} variant="ghost" onPress={onBack} />
        </>
      }
    >
      <StepHeader step={3} total={4} title={t('docsTitle')} subtitle={t('docsSubtitle')} />

      {missing.length ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{t('docsAnswerFor', { list: missing.join(', ') })}</Text>
        </View>
      ) : null}

      <Text style={typography.heading}>{t('docsRequiredHeading')}</Text>
      {essentials.map((def) => (
        <DocumentCard key={def.id} def={def} entry={intake.documents[def.id] ?? null} onChange={(entry) => setEntry(def.id, entry)} travelDate={intake.travelDate} />
      ))}

      <Text style={typography.heading}>{t('docsOtherHeading')}</Text>
      <Card>
        <Text style={typography.body}>{t('docsOtherBody')}</Text>
        <Select
          label={t('docsAdd')}
          value=""
          placeholder={t('docsAddPlaceholder')}
          options={notAdded.map((d) => ({ value: d.id, label: `${d.label[lang]}  ·  ${CATEGORY_LABELS[d.category][lang]}` }))}
          onChange={(id) => setEntry(id, { ...emptyEntry(id), status: 'current' })}
        />
      </Card>

      {addedExtras.map((def) => (
        <DocumentCard
          key={def.id}
          def={def}
          entry={intake.documents[def.id]}
          onChange={(entry) => setEntry(def.id, entry)}
          onRemove={() => setEntry(def.id, null)}
          travelDate={intake.travelDate}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  errorBox: { backgroundColor: colors.dangerLight, padding: spacing.md, borderRadius: radius.md },
  errorText: { ...typography.body, color: colors.danger, fontFamily: fonts.sansSemiBold },
});
