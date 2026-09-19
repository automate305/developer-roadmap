import AsyncStorage from '@react-native-async-storage/async-storage';

import { EMPTY_INTAKE, type Intake } from './types';

const KEY = 'mypetvisa.intake.v1';

export async function loadIntake(): Promise<Intake> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_INTAKE };
    const parsed = JSON.parse(raw) as Partial<Intake>;
    return { ...EMPTY_INTAKE, ...parsed, documents: parsed.documents ?? {} };
  } catch {
    return { ...EMPTY_INTAKE };
  }
}

export async function saveIntake(intake: Intake): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...intake, updatedAt: new Date().toISOString() }));
  } catch {
    // Storage is a convenience; never block the client on it.
  }
}

export async function clearIntake(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
