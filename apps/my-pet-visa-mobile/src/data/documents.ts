import type { Lang } from '../i18n/strings';
import type { Species } from '../types';

export type DocCategory = 'vaccination' | 'identification' | 'certificate' | 'travel';

interface Bilingual {
  en: string;
  es: string;
}

export interface DocDefinition {
  id: string;
  label: Bilingual;
  category: DocCategory;
  /** One line the client can understand. */
  help: Bilingual;
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
    label: { en: 'Rabies vaccination certificate', es: 'Certificado de vacuna antirrábica' },
    category: 'vaccination',
    help: {
      en: 'Signed by the vet who gave the shot. Shows vaccine date, expiration (1-yr or 3-yr), product and lot number.',
      es: 'Firmado por el veterinario que la aplicó. Muestra fecha, vencimiento (1 o 3 años), producto y lote.',
    },
    tracksExpiry: true,
    essential: true,
  },
  {
    id: 'microchip_record',
    label: { en: 'Microchip record', es: 'Registro del microchip' },
    category: 'identification',
    help: {
      en: '15-digit ISO chip number and the date it was implanted. Most countries require the chip to be placed before the rabies shot.',
      es: 'Número ISO de 15 dígitos y fecha de implantación. La mayoría de los países exigen que el chip vaya antes de la antirrábica.',
    },
    tracksExpiry: false,
    essential: true,
  },
  {
    id: 'vaccine_history',
    label: { en: 'Full vaccination history', es: 'Historial completo de vacunas' },
    category: 'vaccination',
    help: {
      en: 'Printout from your regular vet listing all vaccines and dates.',
      es: 'Impresión de tu veterinario habitual con todas las vacunas y fechas.',
    },
    tracksExpiry: false,
    essential: true,
  },
  {
    id: 'dhpp',
    label: { en: 'DHPP / DA2PP (distemper, parvo) vaccine', es: 'Vacuna DHPP / DA2PP (moquillo, parvo)' },
    category: 'vaccination',
    help: {
      en: 'Core dog combo vaccine. Many airlines and countries ask for it to be current.',
      es: 'Vacuna combinada básica para perros. Muchas aerolíneas y países la piden vigente.',
    },
    species: ['dog'],
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'leptospirosis',
    label: { en: 'Leptospirosis vaccine', es: 'Vacuna contra leptospirosis' },
    category: 'vaccination',
    help: {
      en: 'Often included in the DHLPP combo. Required by some destinations.',
      es: 'Suele venir en la combinada DHLPP. Algunos destinos la exigen.',
    },
    species: ['dog'],
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'bordetella',
    label: { en: 'Bordetella (kennel cough) vaccine', es: 'Vacuna Bordetella (tos de las perreras)' },
    category: 'vaccination',
    help: {
      en: 'Commonly required by airlines, boarding and some countries.',
      es: 'La piden con frecuencia aerolíneas, guarderías y algunos países.',
    },
    species: ['dog'],
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'fvrcp',
    label: { en: 'FVRCP (feline distemper) vaccine', es: 'Vacuna FVRCP (triple felina)' },
    category: 'vaccination',
    help: { en: 'Core cat combo vaccine.', es: 'Vacuna combinada básica para gatos.' },
    species: ['cat'],
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'feline_leukemia',
    label: { en: 'Feline leukemia (FeLV) vaccine', es: 'Vacuna contra leucemia felina (FeLV)' },
    category: 'vaccination',
    help: {
      en: 'Requested by some destinations and airlines for cats.',
      es: 'Algunos destinos y aerolíneas la piden para gatos.',
    },
    species: ['cat'],
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'rabies_titer',
    label: { en: 'Rabies titer (FAVN) lab result', es: 'Resultado de titulación de rabia (FAVN)' },
    category: 'certificate',
    help: {
      en: 'Blood test result from an approved lab. Needed for the EU from some countries, Japan, Australia, Hawaii and for dogs returning to the US from high-risk countries.',
      es: 'Análisis de sangre de un laboratorio aprobado. Lo piden la UE desde ciertos países, Japón, Australia, Hawái y EE. UU. para perros que regresan de países de alto riesgo.',
    },
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'parasite_treatment',
    label: { en: 'Parasite / tapeworm treatment record', es: 'Registro de desparasitación / tenia' },
    category: 'certificate',
    help: {
      en: 'Vet-administered dewormer or flea/tick treatment with date and product. Required by the UK, Ireland, Finland, Norway, Malta and others.',
      es: 'Desparasitante o antipulgas aplicado por el veterinario, con fecha y producto. Lo exigen Reino Unido, Irlanda, Finlandia, Noruega, Malta y otros.',
    },
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'previous_health_certificate',
    label: { en: 'Previous health certificate', es: 'Certificado de salud anterior' },
    category: 'certificate',
    help: {
      en: 'Any past APHIS 7001, EU health certificate or pet passport, if your pet has traveled before.',
      es: 'Cualquier APHIS 7001, certificado de la UE o pasaporte anterior, si tu mascota ya viajó.',
    },
    tracksExpiry: false,
    essential: false,
  },
  {
    id: 'pet_passport',
    label: { en: 'Pet passport (EU or other)', es: 'Pasaporte de mascota (UE u otro)' },
    category: 'identification',
    help: {
      en: 'If your pet already has a passport from another country.',
      es: 'Si tu mascota ya tiene pasaporte de otro país.',
    },
    tracksExpiry: false,
    essential: false,
  },
  {
    id: 'import_permit',
    label: { en: 'Import permit from destination country', es: 'Permiso de importación del país de destino' },
    category: 'travel',
    help: {
      en: 'Some countries (e.g. Australia, Japan, South Africa, UAE) require a permit issued before travel.',
      es: 'Algunos países (p. ej. Australia, Japón, Sudáfrica, EAU) exigen un permiso emitido antes del viaje.',
    },
    tracksExpiry: true,
    essential: false,
  },
  {
    id: 'cdc_dog_import_receipt',
    label: { en: 'CDC Dog Import Form receipt', es: 'Recibo del formulario de importación de perros del CDC' },
    category: 'travel',
    help: {
      en: 'Required for every dog entering or returning to the US. Filed online before the trip.',
      es: 'Obligatorio para todo perro que entra o regresa a EE. UU. Se presenta en línea antes del viaje.',
    },
    species: ['dog'],
    tracksExpiry: false,
    essential: false,
  },
  {
    id: 'airline_confirmation',
    label: { en: 'Airline booking / pet reservation', es: 'Reserva de vuelo / reserva de la mascota' },
    category: 'travel',
    help: {
      en: 'Your flight confirmation showing the pet is booked, plus any airline forms.',
      es: 'Tu confirmación de vuelo con la mascota reservada, más los formularios de la aerolínea.',
    },
    tracksExpiry: false,
    essential: false,
  },
  {
    id: 'owner_id',
    label: { en: 'Owner photo ID or passport', es: 'Identificación con foto o pasaporte del dueño' },
    category: 'travel',
    help: {
      en: 'Name must match the health certificate exactly.',
      es: 'El nombre debe coincidir exactamente con el certificado de salud.',
    },
    tracksExpiry: false,
    essential: false,
  },
];

export const CATEGORY_LABELS: Record<DocCategory, Bilingual> = {
  vaccination: { en: 'Vaccinations', es: 'Vacunas' },
  identification: { en: 'Identification', es: 'Identificación' },
  certificate: { en: 'Tests & certificates', es: 'Pruebas y certificados' },
  travel: { en: 'Travel paperwork', es: 'Trámites de viaje' },
};

export function documentsForSpecies(species: Species | ''): DocDefinition[] {
  return DOCUMENTS.filter((d) => !d.species || !species || d.species.includes(species));
}

export function getDocument(id: string): DocDefinition | undefined {
  return DOCUMENTS.find((d) => d.id === id);
}

export function docLabel(def: DocDefinition, lang: Lang): string {
  return def.label[lang];
}
