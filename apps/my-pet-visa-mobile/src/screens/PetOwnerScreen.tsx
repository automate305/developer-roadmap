import { Text } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Choice } from '../components/Choice';
import { DateField } from '../components/DateField';
import { Field } from '../components/Field';
import { Screen } from '../components/Screen';
import { StepHeader } from '../components/StepHeader';
import { SEX_OPTIONS, SPECIES_OPTIONS } from '../data/options';
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

export function validatePetOwner(i: Intake): Partial<Record<keyof Intake, string>> {
  const e: Partial<Record<keyof Intake, string>> = {};
  if (!i.ownerName.trim()) e.ownerName = 'Please enter your name';
  if (!isValidPhone(i.ownerPhone)) e.ownerPhone = 'Please enter a 10-digit phone number';
  if (!isValidEmail(i.ownerEmail)) e.ownerEmail = 'Please enter a valid email';
  if (!i.petName.trim()) e.petName = "Please enter your pet's name";
  if (!i.species) e.species = 'Please choose one';
  return e;
}

export function PetOwnerScreen({ intake, onChange, onNext, onBack, showErrors }: Props) {
  const errors = showErrors ? validatePetOwner(intake) : {};

  return (
    <Screen
      footer={
        <>
          <Button title="Next: Travel details" onPress={onNext} />
          <Button title="Back" variant="ghost" onPress={onBack} />
        </>
      }
    >
      <StepHeader step={1} total={4} title="You and your pet" subtitle="Use the exact name on your passport or ID." />

      <Card>
        <Text style={typography.subheading}>Owner</Text>
        <Field
          label="Full name"
          value={intake.ownerName}
          onChangeText={(v) => onChange({ ownerName: v })}
          autoCapitalize="words"
          textContentType="name"
          error={errors.ownerName}
        />
        <Field
          label="Mobile phone"
          value={intake.ownerPhone}
          onChangeText={(v) => onChange({ ownerPhone: maskPhone(v) })}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          placeholder="(305) 555-0123"
          error={errors.ownerPhone}
        />
        <Field
          label="Email"
          value={intake.ownerEmail}
          onChangeText={(v) => onChange({ ownerEmail: v })}
          keyboardType="email-address"
          autoCapitalize="none"
          textContentType="emailAddress"
          placeholder="you@example.com"
          error={errors.ownerEmail}
        />
      </Card>

      <Card>
        <Text style={typography.subheading}>Pet</Text>
        <Field
          label="Pet's name"
          value={intake.petName}
          onChangeText={(v) => onChange({ petName: v })}
          autoCapitalize="words"
          error={errors.petName}
        />
        <Choice
          label="Dog or cat?"
          options={SPECIES_OPTIONS}
          value={intake.species}
          onChange={(species) => onChange({ species })}
          error={errors.species}
        />
        <Field label="Breed" value={intake.breed} onChangeText={(v) => onChange({ breed: v })} optional placeholder="e.g. Labrador mix" />
        <Choice label="Sex" options={SEX_OPTIONS} value={intake.sex} onChange={(sex) => onChange({ sex })} />
        <DateField
          label="Date of birth"
          value={intake.birthDate}
          onChange={(birthDate) => onChange({ birthDate })}
          optional
          hint="Approximate is fine. Puppies and kittens usually must be at least 12-16 weeks old to travel."
        />
        <Field
          label="Color / markings"
          value={intake.colorMarkings}
          onChangeText={(v) => onChange({ colorMarkings: v })}
          optional
          placeholder="e.g. black with white chest"
        />
      </Card>
    </Screen>
  );
}
