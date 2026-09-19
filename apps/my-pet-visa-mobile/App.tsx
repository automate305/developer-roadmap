import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DocumentsScreen, validateDocuments } from './src/screens/DocumentsScreen';
import { DoneScreen } from './src/screens/DoneScreen';
import { PetOwnerScreen, validatePetOwner } from './src/screens/PetOwnerScreen';
import { ReviewScreen } from './src/screens/ReviewScreen';
import { TravelScreen, validateTravel } from './src/screens/TravelScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { clearIntake, loadIntake, saveIntake } from './src/storage';
import { submitIntake } from './src/submit';
import { colors } from './src/theme';
import { EMPTY_INTAKE, type Intake } from './src/types';

type Step = 'welcome' | 1 | 2 | 3 | 4 | 'done';

export default function App() {
  const [intake, setIntake] = useState<Intake | null>(null);
  const [step, setStep] = useState<Step>('welcome');
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadIntake().then(setIntake);
  }, []);

  // Autosave (debounced) so the client never loses progress.
  const update = useCallback((patch: Partial<Intake>) => {
    setIntake((prev) => {
      const next = { ...(prev ?? EMPTY_INTAKE), ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveIntake(next), 400);
      return next;
    });
  }, []);

  const go = (next: Step) => {
    setShowErrors(false);
    setStep(next);
  };

  const tryNext = (valid: boolean, next: Step) => {
    if (valid) go(next);
    else setShowErrors(true);
  };

  const startOver = async () => {
    await clearIntake();
    setIntake({ ...EMPTY_INTAKE, updatedAt: new Date().toISOString() });
    setSent(false);
    setSubmitError(undefined);
    go(1);
  };

  const submit = async () => {
    if (!intake) return;
    setSubmitting(true);
    setSubmitError(undefined);
    const result = await submitIntake(intake);
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    const finished = { ...intake, submittedAt: new Date().toISOString() };
    setIntake(finished);
    await saveIntake(finished);
    setSent(result.sent);
    go('done');
  };

  if (!intake) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const hasDraft = Boolean(intake.ownerName || intake.petName || Object.keys(intake.documents).length);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {step === 'welcome' ? (
        <WelcomeScreen hasDraft={hasDraft} onStart={() => go(1)} onStartOver={startOver} />
      ) : step === 1 ? (
        <PetOwnerScreen
          intake={intake}
          onChange={update}
          showErrors={showErrors}
          onBack={() => go('welcome')}
          onNext={() => tryNext(Object.keys(validatePetOwner(intake)).length === 0, 2)}
        />
      ) : step === 2 ? (
        <TravelScreen
          intake={intake}
          onChange={update}
          showErrors={showErrors}
          onBack={() => go(1)}
          onNext={() => tryNext(Object.keys(validateTravel(intake)).length === 0, 3)}
        />
      ) : step === 3 ? (
        <DocumentsScreen
          intake={intake}
          onChange={update}
          showErrors={showErrors}
          onBack={() => go(2)}
          onNext={() => tryNext(validateDocuments(intake) === null, 4)}
        />
      ) : step === 4 ? (
        <ReviewScreen
          intake={intake}
          onEdit={(s) => go(s)}
          onBack={() => go(3)}
          onSubmit={submit}
          submitting={submitting}
          submitError={submitError}
        />
      ) : (
        <DoneScreen intake={intake} sent={sent} onNewRequest={startOver} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
