import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { DocumentCard } from '../components/DocumentCard';
import { Screen } from '../components/Screen';
import { Select } from '../components/Select';
import { StepHeader } from '../components/StepHeader';
import { CATEGORY_LABELS, documentsForSpecies, type DocDefinition } from '../data/documents';
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

/** Essentials must have an answer; anything else is optional. */
export function validateDocuments(i: Intake, species = i.species): string | null {
  const essentials = documentsForSpecies(species).filter((d) => d.essential);
  const unanswered = essentials.filter((d) => !i.documents[d.id]);
  if (unanswered.length) return `Please answer for: ${unanswered.map((d) => d.label).join(', ')}`;
  return null;
}

export function DocumentsScreen({ intake, onChange, onNext, onBack, showErrors }: Props) {
  const available = useMemo(() => documentsForSpecies(intake.species), [intake.species]);
  const essentials = available.filter((d) => d.essential);
  const extras = available.filter((d) => !d.essential);

  const addedExtras = extras.filter((d) => intake.documents[d.id]);
  const notAdded = extras.filter((d) => !intake.documents[d.id]);

  const optionLabelToDef = useMemo(() => {
    const map = new Map<string, DocDefinition>();
    notAdded.forEach((d) => map.set(`${d.label}  ·  ${CATEGORY_LABELS[d.category]}`, d));
    return map;
  }, [notAdded]);

  const setEntry = (docId: string, entry: DocumentEntry | null) => {
    const documents = { ...intake.documents };
    if (entry) documents[docId] = entry;
    else delete documents[docId];
    onChange({ documents });
  };

  const error = showErrors ? validateDocuments(intake) : null;

  return (
    <Screen
      footer={
        <>
          <Button title="Next: Review" onPress={onNext} />
          <Button title="Back" variant="ghost" onPress={onBack} />
        </>
      }
    >
      <StepHeader
        step={3}
        total={4}
        title="Vaccines & documents"
        subtitle="Tell us what you already have. A phone photo of each paper is perfect."
      />

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Text style={typography.heading}>Required for every trip</Text>
      {essentials.map((def) => (
        <DocumentCard
          key={def.id}
          def={def}
          entry={intake.documents[def.id] ?? null}
          onChange={(entry) => setEntry(def.id, entry)}
          travelDate={intake.travelDate}
        />
      ))}

      <Text style={typography.heading}>Other vaccines & paperwork</Text>
      <Card>
        <Text style={typography.body}>
          Only add what you have or what your destination or airline asked for. Not sure? Skip it and we will go over it
          with you.
        </Text>
        <Select
          label="Add a document or vaccine"
          value=""
          placeholder="Choose from the list"
          options={[...optionLabelToDef.keys()]}
          onChange={(label) => {
            const def = optionLabelToDef.get(label);
            if (def) setEntry(def.id, { ...emptyEntry(def.id), status: 'current' });
          }}
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
