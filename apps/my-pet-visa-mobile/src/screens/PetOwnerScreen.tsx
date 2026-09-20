import { Text } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Choice } from '../components/Choice';
import { DateField } from '../components/DateField';
import { Field } from '../components/Field';
import { Screen } from '../components/Screen';
import { StepHeader } from '../components/StepHeader';
import { SEX_OPTIONS, SPECIES_OPTIONS, localize } from '../data/options';
import { useLanguage, type StringKey } from '../i18n';
import { typography } from '../theme';
import type { Intake } from '../types';
import { isValidEmail, isValidPhone, maskPhone } from '../utils';

interface Props {
  intake: Intake;
  onChange: (patch: Partial<Intake>) => void;
  onNext: () => void;
  onBack: () => void;
  showErrors: boolean;
}

/** Returns string keys so the caller renders them in the active language. */
export function validatePetOwner(i: Intake): Partial<Record<keyof Intake, StringKey>> {
  const e: Partial<Record<keyof Intake, StringKey>> = {};
  if (!i.ownerName.trim()) e.ownerName = 'errOwnerName';
  if (!isValidPhone(i.ownerPhone)) e.ownerPhone = 'errPhone';
  if (!isValidEmail(i.ownerEmail)) e.ownerEmail = 'errEmail';
  if (!i.petName.trim()) e.petName = 'errPetName';
  if (!i.species) e.species = 'errChoose';
  return e;
}

export function PetOwnerScreen({ intake, onChange, onNext, onBack, showErrors }: Props) {
  const { t, lang } = useLanguage();
  const keys = showErrors ? validatePetOwner(intake) : {};
  const err = (k: keyof Intake) => (keys[k] ? t(keys[k] as StringKey) : undefined);

  return (
    <Screen
      footer={
        <>
          <Button title={t('ownerNext')} onPress={onNext} />
          <Button title={t('back')} variant="ghost" onPress={onBack} />
        </>
      }
    >
      <StepHeader step={1} total={4} title={t('ownerTitle')} subtitle={t('ownerSubtitle')} />

      <Card>
        <Text style={typography.subheading}>{t('ownerSection')}</Text>
        <Field
          label={t('ownerFullName')}
          value={intake.ownerName}
          onChangeText={(v) => onChange({ ownerName: v })}
          autoCapitalize="words"
          textContentType="name"
          error={err('ownerName')}
        />
        <Field
          label={t('ownerPhone')}
          value={intake.ownerPhone}
          onChangeText={(v) => onChange({ ownerPhone: maskPhone(v) })}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          placeholder={t('ownerPhonePlaceholder')}
          error={err('ownerPhone')}
        />
        <Field
          label={t('ownerEmail')}
          value={intake.ownerEmail}
          onChangeText={(v) => onChange({ ownerEmail: v })}
          keyboardType="email-address"
          autoCapitalize="none"
          textContentType="emailAddress"
          placeholder={t('ownerEmailPlaceholder')}
          error={err('ownerEmail')}
        />
      </Card>

      <Card>
        <Text style={typography.subheading}>{t('petSection')}</Text>
        <Field label={t('petName')} value={intake.petName} onChangeText={(v) => onChange({ petName: v })} autoCapitalize="words" error={err('petName')} />
        <Choice
          label={t('petSpecies')}
          options={localize(SPECIES_OPTIONS, lang)}
          value={intake.species}
          onChange={(species) => onChange({ species })}
          error={err('species')}
        />
        <Field label={t('petBreed')} value={intake.breed} onChangeText={(v) => onChange({ breed: v })} optional placeholder={t('petBreedPlaceholder')} />
        <Choice label={t('petSex')} options={localize(SEX_OPTIONS, lang)} value={intake.sex} onChange={(sex) => onChange({ sex })} />
        <DateField label={t('petBirthDate')} value={intake.birthDate} onChange={(birthDate) => onChange({ birthDate })} optional hint={t('petBirthHint')} />
        <Field
          label={t('petMarkings')}
          value={intake.colorMarkings}
          onChangeText={(v) => onChange({ colorMarkings: v })}
          optional
          placeholder={t('petMarkingsPlaceholder')}
        />
      </Card>
    </Screen>
  );
}
