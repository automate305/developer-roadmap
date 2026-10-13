import Constants from 'expo-constants';

import type { Intake } from './types';

/**
 * Where the finished intake goes.
 *
 * Set EXPO_PUBLIC_INTAKE_URL (or `expo.extra.intakeUrl` in app.json) to a
 * webhook (Make, Zapier, your own API). Attachments are sent as multipart
 * form fields named `file_<docId>_<n>` alongside an `intake` JSON field.
 *
 * With no URL configured the app still works: the intake is kept on the
 * device and the client is told to bring the documents to the appointment.
 */
export function getIntakeUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_INTAKE_URL;
  const fromExtra = (Constants.expoConfig?.extra as { intakeUrl?: string } | undefined)?.intakeUrl;
  return (fromEnv || fromExtra || '').trim();
}

export function getClinicContact(): { phone: string; email: string } {
  const extra = (Constants.expoConfig?.extra ?? {}) as { clinicPhone?: string; clinicEmail?: string };
  return {
    phone: (process.env.EXPO_PUBLIC_CLINIC_PHONE || extra.clinicPhone || '').trim(),
    email: (process.env.EXPO_PUBLIC_CLINIC_EMAIL || extra.clinicEmail || 'petvizatraveling@gmail.com').trim(),
  };
}

export type SubmitResult = { ok: true; sent: boolean } | { ok: false; error: string };

export async function submitIntake(intake: Intake, lang: string): Promise<SubmitResult> {
  const url = getIntakeUrl();
  if (!url) return { ok: true, sent: false };

  const form = new FormData();
  form.append('intake', JSON.stringify({ ...intake, lang, source: 'petviza-intake' }));
  form.append('leadRef', intake.leadRef ?? '');
  form.append('ownerName', intake.ownerName);
  form.append('ownerEmail', intake.ownerEmail);
  form.append('petName', intake.petName);
  form.append('destination', intake.destination);
  form.append('travelDate', intake.travelDate);

  for (const entry of Object.values(intake.documents)) {
    entry.attachments.forEach((file, index) => {
      // React Native's FormData accepts { uri, name, type } for files.
      form.append(`file_${entry.docId}_${index + 1}`, {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? 'application/octet-stream',
      } as unknown as Blob);
    });
  }

  try {
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) return { ok: false, error: `Server responded ${res.status}` };
    return { ok: true, sent: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}
