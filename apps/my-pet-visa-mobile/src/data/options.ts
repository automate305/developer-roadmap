import type { Lang } from '../i18n/strings';
import type { DocStatus, PetSex, Species, TravelMode, TravelType, YesNoUnsure } from '../types';

/** A bilingual option; `localize()` turns it into what the UI shows. */
export interface RawOption<T extends string> {
  value: T;
  en: string;
  es: string;
}

export interface Option<T extends string> {
  value: T;
  label: string;
}

export function localize<T extends string>(options: readonly RawOption<T>[], lang: Lang): Option<T>[] {
  return options.map((o) => ({ value: o.value, label: o[lang] }));
}

export function labelOf<T extends string>(options: readonly RawOption<T>[], value: T | '', lang: Lang): string {
  return options.find((o) => o.value === value)?.[lang] ?? '—';
}

export const SPECIES_OPTIONS: RawOption<Species>[] = [
  { value: 'dog', en: 'Dog', es: 'Perro' },
  { value: 'cat', en: 'Cat', es: 'Gato' },
  { value: 'other', en: 'Other', es: 'Otro' },
];

export const SEX_OPTIONS: RawOption<PetSex>[] = [
  { value: 'male', en: 'Male', es: 'Macho' },
  { value: 'male_neutered', en: 'Male (neutered)', es: 'Macho (castrado)' },
  { value: 'female', en: 'Female', es: 'Hembra' },
  { value: 'female_spayed', en: 'Female (spayed)', es: 'Hembra (esterilizada)' },
];

export const TRAVEL_TYPE_OPTIONS: RawOption<TravelType>[] = [
  { value: 'international', en: 'Another country', es: 'Otro país' },
  { value: 'domestic', en: 'Another US state', es: 'Otro estado de EE. UU.' },
];

export const TRAVEL_MODE_OPTIONS: RawOption<TravelMode>[] = [
  { value: 'air_cabin', en: 'Plane - in cabin', es: 'Avión - en cabina' },
  { value: 'air_cargo', en: 'Plane - cargo / checked', es: 'Avión - bodega / carga' },
  { value: 'car', en: 'Car / driving', es: 'Auto / por carretera' },
  { value: 'other', en: 'Other', es: 'Otro' },
];

export const YES_NO_UNSURE: RawOption<YesNoUnsure>[] = [
  { value: 'yes', en: 'Yes', es: 'Sí' },
  { value: 'no', en: 'No', es: 'No' },
  { value: 'unsure', en: 'Not sure', es: 'No estoy seguro' },
];

export const DOC_STATUS_OPTIONS: RawOption<DocStatus>[] = [
  { value: 'current', en: 'Have it - current', es: 'Lo tengo - vigente' },
  { value: 'expired', en: 'Have it - expired / not sure', es: 'Lo tengo - vencido / no sé' },
  { value: 'missing', en: "Don't have it", es: 'No lo tengo' },
  { value: 'not_applicable', en: 'Not needed', es: 'No aplica' },
];

/**
 * Most common destinations for a Miami-based service. The client can still
 * type any country - this just makes the dropdown fast for the usual ones.
 * The stored value is always the English name so the coordinator sees one
 * spelling regardless of the client's language.
 */
export const COMMON_COUNTRIES: { en: string; es: string }[] = [
  { en: 'Colombia', es: 'Colombia' },
  { en: 'Mexico', es: 'México' },
  { en: 'Dominican Republic', es: 'República Dominicana' },
  { en: 'Spain', es: 'España' },
  { en: 'Venezuela', es: 'Venezuela' },
  { en: 'Brazil', es: 'Brasil' },
  { en: 'Argentina', es: 'Argentina' },
  { en: 'Peru', es: 'Perú' },
  { en: 'Ecuador', es: 'Ecuador' },
  { en: 'Chile', es: 'Chile' },
  { en: 'Costa Rica', es: 'Costa Rica' },
  { en: 'Panama', es: 'Panamá' },
  { en: 'Canada', es: 'Canadá' },
  { en: 'United Kingdom', es: 'Reino Unido' },
  { en: 'France', es: 'Francia' },
  { en: 'Italy', es: 'Italia' },
  { en: 'Germany', es: 'Alemania' },
  { en: 'Portugal', es: 'Portugal' },
  { en: 'Israel', es: 'Israel' },
  { en: 'United Arab Emirates', es: 'Emiratos Árabes Unidos' },
  { en: 'Japan', es: 'Japón' },
  { en: 'Australia', es: 'Australia' },
  { en: 'Puerto Rico (US territory)', es: 'Puerto Rico (territorio de EE. UU.)' },
  { en: 'Hawaii (US state, special rules)', es: 'Hawái (estado de EE. UU., reglas especiales)' },
];

export const US_STATES: string[] = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
  'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'Puerto Rico',
];
