import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Choice } from '../components/Choice';
import { DateField } from '../components/DateField';
import { Field } from '../components/Field';
import { Screen } from '../components/Screen';
import { Select } from '../components/Select';
import { StepHeader } from '../components/StepHeader';
import { COMMON_COUNTRIES, TRAVEL_MODE_OPTIONS, TRAVEL_TYPE_OPTIONS, US_STATES, YES_NO_UNSURE, localize } from '../data/options';
import { useLanguage, type StringKey } from '../i18n';
import { colors, fonts, radius, spacing, typography } from '../theme';
import type { Intake } from '../types';
import { daysUntil, isPastDate, isValidDate } from '../utils';

interface Props {
  intake: Intake;
  onChange: (patch: Partial<Intake>) => void;
  onNext: () => void;
  onBack: () => void;
  showErrors: boolean;
}

export function validateTravel(i: Intake): Partial<Record<keyof Intake, StringKey>> {
  const e: Partial<Record<keyof Intake, StringKey>> = {};
  if (!i.travelType) e.travelType = 'errChoose';
  if (!i.destination.trim()) e.destination = 'errDestination';
  if (!isValidDate(i.travelDate)) e.travelDate = 'errTravelDate';
  else if (isPastDate(i.travelDate)) e.travelDate = 'errTravelDatePast';
  if (!i.travelMode) e.travelMode = 'errChoose';
  if (!i.hasMicrochip) e.hasMicrochip = 'errChoose';
  if (!i.rabiesVaccinated) e.rabiesVaccinated = 'errChoose';
  if (i.travelType === 'international' && !i.returningToUS) e.returningToUS = 'errChoose';
  return e;
}

export function TravelScreen({ intake, onChange, onNext, onBack, showErrors }: Props) {
  const { t, lang } = useLanguage();
  const keys = showErrors ? validateTravel(intake) : {};
  const err = (k: keyof Intake) => (keys[k] ? t(keys[k] as StringKey) : undefined);
  const isIntl = intake.travelType === 'international';
  const days = daysUntil(intake.travelDate);
  const tight = days !== null && days >= 0 && days <= 10;
  const flying = intake.travelMode === 'air_cabin' || intake.travelMode === 'air_cargo';

  const countryItems = COMMON_COUNTRIES.map((c) => ({ value: c.en, label: c[lang] }));

  return (
    <Screen
      footer={
        <>
          <Button title={t('travelNext')} onPress={onNext} />
          <Button title={t('back')} variant="ghost" onPress={onBack} />
        </>
      }
    >
      <StepHeader step={2} total={4} title={t('travelTitle')} subtitle={t('travelSubtitle')} />

      <Card>
        <Choice
          label={t('travelWhere')}
          options={localize(TRAVEL_TYPE_OPTIONS, lang)}
          value={intake.travelType}
          onChange={(travelType) => onChange({ travelType, destination: '' })}
          error={err('travelType')}
        />
        {intake.travelType ? (
          <Select
            label={isIntl ? t('travelCountry') : t('travelState')}
            value={intake.destination}
            options={isIntl ? countryItems : US_STATES}
            onChange={(destination) => onChange({ destination })}
            allowCustom={isIntl}
            error={err('destination')}
            hint={isIntl ? t('travelCountryHint') : undefined}
          />
        ) : null}
      </Card>

      <Card>
        <DateField label={t('travelDate')} value={intake.travelDate} onChange={(travelDate) => onChange({ travelDate })} error={err('travelDate')} hint={t('travelDateHint')} />
        {tight ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{t('travelTight', { days: days ?? 0 })}</Text>
          </View>
        ) : null}
      </Card>

      <Card>
        <Choice
          label={t('travelHow')}
          options={localize(TRAVEL_MODE_OPTIONS, lang)}
          value={intake.travelMode}
          onChange={(travelMode) => onChange({ travelMode })}
          error={err('travelMode')}
        />
        {flying ? (
          <Field
            label={t('travelAirline')}
            value={intake.airline}
            onChangeText={(airline) => onChange({ airline })}
            optional
            placeholder={t('travelAirlinePlaceholder')}
            hint={t('travelAirlineHint')}
          />
        ) : null}
      </Card>

      <Card>
        <Choice
          label={t('travelChip')}
          options={localize(YES_NO_UNSURE, lang)}
          value={intake.hasMicrochip}
          onChange={(hasMicrochip) => onChange({ hasMicrochip })}
          error={err('hasMicrochip')}
          hint={t('travelChipHint')}
        />
        {intake.hasMicrochip === 'yes' ? (
          <Field
            label={t('travelChipNumber')}
            value={intake.microchipNumber}
            onChangeText={(microchipNumber) => onChange({ microchipNumber: microchipNumber.replace(/\s/g, '') })}
            keyboardType="number-pad"
            optional
            placeholder={t('travelChipPlaceholder')}
            maxLength={15}
          />
        ) : null}
      </Card>

      <Card>
        <Choice
          label={t('travelRabies')}
          options={localize(YES_NO_UNSURE, lang)}
          value={intake.rabiesVaccinated}
          onChange={(rabiesVaccinated) => onChange({ rabiesVaccinated })}
          error={err('rabiesVaccinated')}
        />
        {intake.rabiesVaccinated === 'yes' ? (
          <DateField label={t('travelRabiesDate')} value={intake.rabiesDate} onChange={(rabiesDate) => onChange({ rabiesDate })} optional />
        ) : null}
      </Card>

      {isIntl ? (
        <Card>
          <Choice
            label={t('travelReturn')}
            options={localize(YES_NO_UNSURE, lang)}
            value={intake.returningToUS}
            onChange={(returningToUS) => onChange({ returningToUS })}
            error={err('returningToUS')}
            hint={t('travelReturnHint')}
          />
          <Choice
            label={t('travelAbroad')}
            options={localize(YES_NO_UNSURE, lang)}
            value={intake.outsideUSLast6Months}
            onChange={(outsideUSLast6Months) => onChange({ outsideUSLast6Months })}
            hint={t('travelAbroadHint')}
          />
        </Card>
      ) : null}

      <Card>
        <Field
          label={t('travelHealth', { n: isIntl ? 8 : 6 })}
          value={intake.healthConcerns}
          onChangeText={(healthConcerns) => onChange({ healthConcerns })}
          optional
          multiline
          numberOfLines={3}
          style={styles.multiline}
          placeholder={t('travelHealthPlaceholder')}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.warningLight, padding: spacing.md, borderRadius: radius.md },
  bannerText: { ...typography.body, color: colors.warning, fontFamily: fonts.sansSemiBold },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
});
