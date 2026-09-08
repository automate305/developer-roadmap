/**
 * Platform-wide policy, held in a single row.
 *
 * Reads never write. The send path calls this on every dispatch, and an upsert
 * there would turn a read into a write on the hot path; an install with no row
 * yet simply gets the defaults until someone saves the settings page.
 */
import { prisma } from './prisma';

export const SETTINGS_ID = 'singleton';

export type PlatformSettings = {
  /** Most emails one person may receive across all campaigns inside the window. */
  maxEmailsPerContact: number;
  /** Length of that window, in days. */
  contactWindowDays: number;
};

export const DEFAULT_SETTINGS: PlatformSettings = {
  maxEmailsPerContact: 2,
  contactWindowDays: 30,
};

export async function getSettings(): Promise<PlatformSettings> {
  const row = await prisma.setting.findUnique({ where: { id: SETTINGS_ID } });
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    maxEmailsPerContact: row.maxEmailsPerContact,
    contactWindowDays: row.contactWindowDays,
  };
}

export async function saveSettings(next: PlatformSettings): Promise<PlatformSettings> {
  if (!Number.isInteger(next.maxEmailsPerContact) || next.maxEmailsPerContact < 0) {
    throw new Error('The contact cap must be zero or a whole number. Zero switches it off.');
  }
  if (next.maxEmailsPerContact > 100) {
    throw new Error('A cap above 100 emails per person is not a cap.');
  }
  if (!Number.isInteger(next.contactWindowDays) || next.contactWindowDays < 1) {
    throw new Error('The window must be at least one day.');
  }
  if (next.contactWindowDays > 365) {
    throw new Error('The window cannot be longer than a year.');
  }

  const row = await prisma.setting.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...next },
    update: next,
  });

  return {
    maxEmailsPerContact: row.maxEmailsPerContact,
    contactWindowDays: row.contactWindowDays,
  };
}
