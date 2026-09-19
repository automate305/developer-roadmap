import type { Species } from '../types';

export type DocCategory = 'vaccination' | 'identification' | 'certificate' | 'travel';

export interface DocDefinition {
  id: string;
  label: string;
  category: DocCategory;
  /** One line the client can understand. */
  help: string;
  /** Which species this applies to. Empty = all. */
  species?: Species[];
  /** Ask for an expiration date (vaccines, permits). */
  tracksExpiry: boolean;
  /** Shown first and flagged if missing. */
  essential: boolean;
}

/**
 * The most common documents and vaccinations a USDA-accredited vet needs to
 * see for an interstate or international pet health certificate.
 *
 * Ordering matters: essentials first, then common extras, then destination-
 * specific items. Keep the list short - the client picks from a dropdown.
 */
export const DOCUMENTS: DocDefinition[] = [
  {
    id: 'rabies_certificate',
    label: 'Rabies vaccination certificate',
    category: 'vaccination',
    help: 'Signed by the vet who gave the shot. Shows vaccine date, expiration (1-yr or 3-yr), product and lot number.',
    tracksExpiry: true,
    essential: true,
  },
  {
    id: 'microchip_record',
    label: 'Microchip record',
    category: 'identification',
    help: '15-digit ISO chip number and the date it was implanted. Most countries require the chip to be placed before the rabies shot.',
    tracksExpiry: false,
    essential: true,
  },
  {
    id: 'vaccine_history',
    label: 'Full vaccination history',
    category: 'vaccination',
    help: 'Printout from your regular vet listing all vaccines and dates.',
    tracksExpiry: false,
    essential: true,
  },
  {
    id: 'dhpp',
    label: 'DHPP / DA2PP (distemper, parvo) vaccine',
    category: 'vaccination',
    help: 'Core dog combo vaccine. Many airlines and countries ask for it to be current.',
    species: ['dog'],
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'leptospirosis',
    label: 'Leptospirosis vaccine',
    category: 'vaccination',
    help: 'Often included in the DHLPP combo. Required by some destinations.',
    species: ['dog'],
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'bordetella',
    label: 'Bordetella (kennel cough) vaccine',
    category: 'vaccination',
    help: 'Commonly required by airlines, boarding and some countries.',
    species: ['dog'],
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'fvrcp',
    label: 'FVRCP (feline distemper) vaccine',
    category: 'vaccination',
    help: 'Core cat combo vaccine.',
    species: ['cat'],
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'feline_leukemia',
    label: 'Feline leukemia (FeLV) vaccine',
    category: 'vaccination',
    help: 'Requested by some destinations and airlines for cats.',
    species: ['cat'],
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'rabies_titer',
    label: 'Rabies titer (FAVN) lab result',
    category: 'certificate',
    help: 'Blood test result from an approved lab. Needed for the EU from some countries, Japan, Australia, Hawaii and for dogs returning to the US from high-risk countries.',
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'parasite_treatment',
    label: 'Parasite / tapeworm treatment record',
    category: 'certificate',
    help: 'Vet-administered dewormer or flea/tick treatment with date and product. Required by the UK, Ireland, Finland, Norway, Malta and others.',
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'previous_health_certificate',
    label: 'Previous health certificate',
    category: 'certificate',
    help: 'Any past APHIS 7001, EU health certificate or pet passport, if your pet has traveled before.',
    tracksExpiry: false,
    essential: false,
  },
  {
    id: 'pet_passport',
    label: 'Pet passport (EU or other)',
    category: 'identification',
    help: 'If your pet already has a passport from another country.',
    tracksExpiry: false,
    essential: false,
  },
  {
    id: 'import_permit',
    label: 'Import permit from destination country',
    category: 'travel',
    help: 'Some countries (e.g. Australia, Japan, South Africa, UAE) require a permit issued before travel.',
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'cdc_dog_import_receipt',
    label: 'CDC Dog Import Form receipt',
    category: 'travel',
    help: 'Required for every dog entering or returning to the US. Filed online before the trip.',
    species: ['dog'],
    tracksExpiry: false,
    essential: false,
  },
  {
    id: 'airline_confirmation',
    label: 'Airline booking / pet reservation',
    category: 'travel',
    help: 'Your flight confirmation showing the pet is booked, plus any airline forms.',
    tracksExpiry: false,
    essential: false,
  },
  {
    id: 'owner_id',
    label: 'Owner photo ID or passport',
    category: 'travel',
    help: 'Name must match the health certificate exactly.',
    tracksExpiry: false,
    essential: false,
  },
];

export const CATEGORY_LABELS: Record<DocCategory, string> = {
  vaccination: 'Vaccinations',
  identification: 'Identification',
  certificate: 'Tests & certificates',
  travel: 'Travel paperwork',
};

export function documentsForSpecies(species: Species | ''): DocDefinition[] {
  return DOCUMENTS.filter((d) => !d.species || !species || d.species.includes(species));
}

export function getDocument(id: string): DocDefinition | undefined {
  return DOCUMENTS.find((d) => d.id === id);
}
