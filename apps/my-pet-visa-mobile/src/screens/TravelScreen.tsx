import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Choice } from '../components/Choice';
import { DateField } from '../components/DateField';
import { Field } from '../components/Field';
import { Screen } from '../components/Screen';
import { Select } from '../components/Select';
import { StepHeader } from '../components/StepHeader';
import { COMMON_COUNTRIES, TRAVEL_MODE_OPTIONS, TRAVEL_TYPE_OPTIONS, US_STATES, YES_NO_UNSURE } from '../data/options';
import { colors, radius, spacing, typography } from '../theme';
import type { Intake } from '../types';
import { daysUntil, isPastDate, isValidDate } from '../utils';

interface Props {
  intake: Intake;
  onChange: (patch: Partial<Intake>) => void;
  onNext: () => void;
  onBack: () => void;
  showErrors: boolean;
}

export function validateTravel(i: Intake): Partial<Record<keyof Intake, string>> {
  const e: Partial<Record<keyof Intake, string>> = {};
  if (!i.travelType) e.travelType = 'Please choose one';
  if (!i.destination.trim()) e.destination = 'Please choose your destination';
  if (!isValidDate(i.travelDate)) e.travelDate = 'Please enter your travel date';
  else if (isPastDate(i.travelDate)) e.travelDate = 'That date has already passed';
  if (!i.travelMode) e.travelMode = 'Please choose one';
  if (!i.hasMicrochip) e.hasMicrochip = 'Please choose one';
  if (!i.rabiesVaccinated) e.rabiesVaccinated = 'Please choose one';
  if (i.travelType === 'international' && !i.returningToUS) e.returningToUS = 'Please choose one';
  return e;
}

export function TravelScreen({ intake, onChange, onNext, onBack, showErrors }: Props) {
  const errors = showErrors ? validateTravel(intake) : {};
  const isIntl = intake.travelType === 'international';
  const days = daysUntil(intake.travelDate);
  const tight = days !== null && days >= 0 && days <= 10;
  const flying = intake.travelMode === 'air_cabin' || intake.travelMode === 'air_cargo';

  return (
    <Screen
      footer={
        <>
          <Button title="Next: Documents" onPress={onNext} />
          <Button title="Back" variant="ghost" onPress={onBack} />
        </>
      }
    >
      <StepHeader step={2} total={4} title="Your trip" subtitle="These answers decide which certificate and timeline apply." />

      <Card>
        <Choice
          label="1. Where is your pet going?"
          options={TRAVEL_TYPE_OPTIONS}
          value={intake.travelType}
          onChange={(travelType) => onChange({ travelType, destination: '' })}
          error={errors.travelType}
        />
        {intake.travelType ? (
          <Select
            label={isIntl ? 'Destination country' : 'Destination state'}
            value={intake.destination}
            options={isIntl ? COMMON_COUNTRIES : US_STATES}
            onChange={(destination) => onChange({ destination })}
            allowCustom={isIntl}
            error={errors.destination}
            hint={isIntl ? 'Not in the list? Type it in the search box.' : undefined}
          />
        ) : null}
      </Card>

      <Card>
        <DateField
          label="2. Travel date"
          value={intake.travelDate}
          onChange={(travelDate) => onChange({ travelDate })}
          error={errors.travelDate}
          hint="Most health certificates must be issued within 10 days of departure."
        />
        {tight ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Your trip is in {days} day{days === 1 ? '' : 's'}. Please book your exam as soon as possible so USDA
              endorsement can be done in time.
            </Text>
          </View>
        ) : null}
      </Card>

      <Card>
        <Choice
          label="3. How is your pet traveling?"
          options={TRAVEL_MODE_OPTIONS}
          value={intake.travelMode}
          onChange={(travelMode) => onChange({ travelMode })}
          error={errors.travelMode}
        />
        {flying ? (
          <Field
            label="Airline"
            value={intake.airline}
            onChangeText={(airline) => onChange({ airline })}
            optional
            placeholder="e.g. American, Avianca, LATAM"
            hint="Airlines often have their own forms and vaccine rules."
          />
        ) : null}
      </Card>

      <Card>
        <Choice
          label="4. Does your pet have a microchip?"
          options={YES_NO_UNSURE}
          value={intake.hasMicrochip}
          onChange={(hasMicrochip) => onChange({ hasMicrochip })}
          error={errors.hasMicrochip}
          hint="Most countries require a 15-digit ISO microchip placed before the rabies shot."
        />
        {intake.hasMicrochip === 'yes' ? (
          <Field
            label="Microchip number"
            value={intake.microchipNumber}
            onChangeText={(microchipNumber) => onChange({ microchipNumber: microchipNumber.replace(/\s/g, '') })}
            keyboardType="number-pad"
            optional
            placeholder="15 digits"
            maxLength={15}
          />
        ) : null}
      </Card>

      <Card>
        <Choice
          label="5. Is your pet's rabies vaccine current?"
          options={YES_NO_UNSURE}
          value={intake.rabiesVaccinated}
          onChange={(rabiesVaccinated) => onChange({ rabiesVaccinated })}
          error={errors.rabiesVaccinated}
        />
        {intake.rabiesVaccinated === 'yes' ? (
          <DateField
            label="Date of last rabies shot"
            value={intake.rabiesDate}
            onChange={(rabiesDate) => onChange({ rabiesDate })}
            optional
          />
        ) : null}
      </Card>

      {isIntl ? (
        <Card>
          <Choice
            label="6. Will your pet come back to the US?"
            options={YES_NO_UNSURE}
            value={intake.returningToUS}
            onChange={(returningToUS) => onChange({ returningToUS })}
            error={errors.returningToUS}
            hint="Dogs re-entering the US need a CDC Dog Import Form receipt and must be at least 6 months old."
          />
          <Choice
            label="7. Has your pet been outside the US in the last 6 months?"
            options={YES_NO_UNSURE}
            value={intake.outsideUSLast6Months}
            onChange={(outsideUSLast6Months) => onChange({ outsideUSLast6Months })}
            hint="Time spent in a high-risk rabies country can change what is required."
          />
        </Card>
      ) : null}

      <Card>
        <Field
          label={`${isIntl ? '8' : '6'}. Anything we should know about your pet's health?`}
          value={intake.healthConcerns}
          onChangeText={(healthConcerns) => onChange({ healthConcerns })}
          optional
          multiline
          numberOfLines={3}
          style={styles.multiline}
          placeholder="Medications, allergies, pregnancy, recent illness, anxiety when traveling..."
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.warningLight, padding: spacing.md, borderRadius: radius.md },
  bannerText: { ...typography.body, color: colors.warning, fontWeight: '600' },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
});
