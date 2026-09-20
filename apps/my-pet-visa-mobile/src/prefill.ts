import { Linking, Platform } from 'react-native';

import { isLang, type Lang } from './i18n';
import type { Intake, Species, TravelType } from './types';
import { maskDate, maskPhone } from './utils';

/**
 * Private-link pre-fill.
 *
 * The consultation form on mypetviza.com already captures name, email, phone,
 * destination, departure date and pet details. The automation that catches
 * that lead builds a link like:
 *
 *   https://mypetviza.com/start?ref=LEAD123&name=Ana%20Ruiz&email=ana@x.com
 *     &phone=3055550123&pet=Luna&species=dog&to=Colombia&date=2026-12-15&lang=es
 *
 * Every parameter is optional. We only fill fields the client has not typed
 * into yet, so reopening a link never overwrites their edits.
 *
 * Accepted keys: ref, name, email, phone, pet, species (dog|cat|other),
 * to (destination), type (intl|us), date (YYYY-MM-DD or MM/DD/YYYY), lang (en|es).
 */
export interface Prefill {
  ref?: string;
  lang?: Lang;
  fields: Partial<Intake>;
}

export function parsePrefill(url: string | null | undefined): Prefill | null {
  if (!url) return null;
  const q = url.indexOf('?');
  if (q === -1) return null;
  const params = new URLSearchParams(url.slice(q + 1).split('#')[0]);
  if ([...params.keys()].length === 0) return null;

  const get = (k: string) => {
    const v = params.get(k);
    return v ? v.trim() : '';
  };

  const fields: Partial<Intake> = {};
  if (get('name')) fields.ownerName = get('name');
  if (get('email')) fields.ownerEmail = get('email');
  if (get('phone')) fields.ownerPhone = maskPhone(get('phone'));
  if (get('pet')) fields.petName = get('pet');

  const species = get('species').toLowerCase();
  if (species === 'dog' || species === 'cat' || species === 'other') fields.species = species as Species;

  const type = get('type').toLowerCase();
  if (type === 'intl' || type === 'international') fields.travelType = 'international' as TravelType;
  if (type === 'us' || type === 'domestic') fields.travelType = 'domestic' as TravelType;

  if (get('to')) {
    fields.destination = get('to');
    if (!fields.travelType) fields.travelType = 'international';
  }

  const date = normalizeDate(get('date'));
  if (date) fields.travelDate = date;

  const lang = get('lang').toLowerCase();
  const ref = get('ref') || get('t') || undefined;
  if (ref) fields.leadRef = ref;

  return { ref, lang: isLang(lang) ? lang : undefined, fields };
}

/** Accepts 2026-12-15 or 12/15/2026 and returns MM/DD/YYYY. */
function normalizeDate(value: string): string {
  if (!value) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  const masked = maskDate(value);
  return masked.length === 10 ? masked : '';
}

/** Only fills fields that are still empty in the saved draft. */
export function applyPrefill(intake: Intake, prefill: Prefill): Intake {
  const next = { ...intake };
  for (const [k, v] of Object.entries(prefill.fields) as [keyof Intake, Intake[keyof Intake]][]) {
    if (v === undefined || v === '') continue;
    const current = next[k];
    if (current === '' || current === undefined || k === 'leadRef') {
      (next as Record<string, unknown>)[k] = v;
    }
  }
  return next;
}

/** The URL the app was opened with, on web or native. */
export async function getLaunchUrl(): Promise<string | null> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.href;
  }
  try {
    return await Linking.getInitialURL();
  } catch {
    return null;
  }
}
