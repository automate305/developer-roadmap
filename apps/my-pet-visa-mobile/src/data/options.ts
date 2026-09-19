import type { PetSex, Species, TravelMode, TravelType, YesNoUnsure, DocStatus } from '../types';

export interface Option<T extends string> {
  value: T;
  label: string;
}

export const SPECIES_OPTIONS: Option<Species>[] = [
  { value: 'dog', label: 'Dog' },
  { value: 'cat', label: 'Cat' },
  { value: 'other', label: 'Other' },
];

export const SEX_OPTIONS: Option<PetSex>[] = [
  { value: 'male', label: 'Male' },
  { value: 'male_neutered', label: 'Male (neutered)' },
  { value: 'female', label: 'Female' },
  { value: 'female_spayed', label: 'Female (spayed)' },
];

export const TRAVEL_TYPE_OPTIONS: Option<TravelType>[] = [
  { value: 'international', label: 'Another country' },
  { value: 'domestic', label: 'Another US state' },
];

export const TRAVEL_MODE_OPTIONS: Option<TravelMode>[] = [
  { value: 'air_cabin', label: 'Plane - in cabin' },
  { value: 'air_cargo', label: 'Plane - cargo / checked' },
  { value: 'car', label: 'Car / driving' },
  { value: 'other', label: 'Other' },
];

export const YES_NO_UNSURE: Option<YesNoUnsure>[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Not sure' },
];

export const DOC_STATUS_OPTIONS: Option<DocStatus>[] = [
  { value: 'current', label: 'Have it - current' },
  { value: 'expired', label: 'Have it - expired / not sure' },
  { value: 'missing', label: "Don't have it" },
  { value: 'not_applicable', label: 'Not needed' },
];

/**
 * Most common destinations for a Miami clinic. The client can still type any
 * country - this just makes the dropdown fast for the usual ones.
 */
export const COMMON_COUNTRIES: string[] = [
  'Colombia',
  'Mexico',
  'Dominican Republic',
  'Spain',
  'Venezuela',
  'Brazil',
  'Argentina',
  'Peru',
  'Ecuador',
  'Chile',
  'Costa Rica',
  'Panama',
  'Canada',
  'United Kingdom',
  'France',
  'Italy',
  'Germany',
  'Portugal',
  'Israel',
  'United Arab Emirates',
  'Japan',
  'Australia',
  'Puerto Rico (US territory)',
  'Hawaii (US state, special rules)',
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
