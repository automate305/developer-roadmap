export type Species = 'dog' | 'cat' | 'other';

export type PetSex = 'male' | 'female' | 'male_neutered' | 'female_spayed';

export type TravelType = 'international' | 'domestic';

export type TravelMode = 'air_cabin' | 'air_cargo' | 'car' | 'other';

export type YesNoUnsure = 'yes' | 'no' | 'unsure';

/** How the owner describes a document or vaccination in the checklist. */
export type DocStatus =
  | 'current' // have it and it is current / not expired
  | 'expired' // have it but it is expired or may be expired
  | 'missing' // do not have it
  | 'not_applicable';

export interface Attachment {
  id: string;
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
}

export interface DocumentEntry {
  docId: string;
  status: DocStatus;
  /** Date the vaccine/certificate was issued, MM/DD/YYYY. */
  issuedOn?: string;
  /** Expiration date if known, MM/DD/YYYY. */
  expiresOn?: string;
  attachments: Attachment[];
  notes?: string;
}

export interface Intake {
  // Owner
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;

  // Pet
  petName: string;
  species: Species | '';
  breed: string;
  sex: PetSex | '';
  birthDate: string; // MM/DD/YYYY or approximate age text
  colorMarkings: string;

  // Travel questions
  travelType: TravelType | '';
  destination: string; // country (international) or state (domestic)
  travelDate: string; // MM/DD/YYYY
  travelMode: TravelMode | '';
  airline: string;
  returningToUS: YesNoUnsure | '';
  outsideUSLast6Months: YesNoUnsure | '';
  hasMicrochip: YesNoUnsure | '';
  microchipNumber: string;
  rabiesVaccinated: YesNoUnsure | '';
  rabiesDate: string;
  healthConcerns: string;

  // Checklist
  documents: Record<string, DocumentEntry>;

  // Meta
  updatedAt: string;
  submittedAt?: string;
}

export const EMPTY_INTAKE: Intake = {
  ownerName: '',
  ownerPhone: '',
  ownerEmail: '',
  petName: '',
  species: '',
  breed: '',
  sex: '',
  birthDate: '',
  colorMarkings: '',
  travelType: '',
  destination: '',
  travelDate: '',
  travelMode: '',
  airline: '',
  returningToUS: '',
  outsideUSLast6Months: '',
  hasMicrochip: '',
  microchipNumber: '',
  rabiesVaccinated: '',
  rabiesDate: '',
  healthConcerns: '',
  documents: {},
  updatedAt: new Date().toISOString(),
};
