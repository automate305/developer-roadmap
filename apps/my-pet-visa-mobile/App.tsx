import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LanguageProvider, useLanguage, type Lang } from './src/i18n';
import { applyPrefill, getLaunchUrl, parsePrefill } from './src/prefill';
import { DocumentsScreen, unansweredEssentials } from './src/screens/DocumentsScreen';
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

interface Boot {
  intake: Intake;
  prefilledName?: string;
  urlLang?: Lang;
}

/** Load the saved draft, then layer any private-link pre-fill on top of it. */
async function boot(): Promise<Boot> {
  const [saved, url] = await Promise.all([loadIntake(), getLaunchUrl()]);
  const prefill = parsePrefill(url);
  if (!prefill) return { intake: saved };
  const intake = applyPrefill(saved, prefill);
  await saveIntake(intake);
  return { intake, prefilledName: prefill.fields.ownerName, urlLang: prefill.lang };
}

function Flow({ initial }: { initial: Boot }) {
  const { lang } = useLanguage();
  const [intake, setIntake] = useState<Intake>(initial.intake);
  const [step, setStep] = useState<Step>('welcome');
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autosave (debounced) so the client never loses progress.
  const update = useCallback((patch: Partial<Intake>) => {
    setIntake((prev) => {
      const next = { ...prev, ...patch };
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
    setSubmitting(true);
    setSubmitError(undefined);
    const result = await submitIntake(intake, lang);
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

  const hasDraft = Boolean(intake.ownerName || intake.petName || Object.keys(intake.documents).length);

  if (step === 'welcome') {
    return <WelcomeScreen hasDraft={hasDraft} prefilledName={initial.prefilledName} onStart={() => go(1)} onStartOver={startOver} />;
  }
  if (step === 1) {
    return (
      <PetOwnerScreen
        intake={intake}
        onChange={update}
        showErrors={showErrors}
        onBack={() => go('welcome')}
        onNext={() => tryNext(Object.keys(validatePetOwner(intake)).length === 0, 2)}
      />
    );
  }
  if (step === 2) {
    return (
      <TravelScreen
        intake={intake}
        onChange={update}
        showErrors={showErrors}
        onBack={() => go(1)}
        onNext={() => tryNext(Object.keys(validateTravel(intake)).length === 0, 3)}
      />
    );
  }
  if (step === 3) {
    return (
      <DocumentsScreen
        intake={intake}
        onChange={update}
        showErrors={showErrors}
        onBack={() => go(2)}
        onNext={() => tryNext(unansweredEssentials(intake, lang).length === 0, 4)}
      />
    );
  }
  if (step === 4) {
    return (
      <ReviewScreen intake={intake} onEdit={(s) => go(s)} onBack={() => go(3)} onSubmit={submit} submitting={submitting} submitError={submitError} />
    );
  }
  return <DoneScreen intake={intake} sent={sent} onNewRequest={startOver} />;
}

export default function App() {
  const [initial, setInitial] = useState<Boot | null>(null);
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    boot().then(setInitial);
  }, []);

  if (!initial || !fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <LanguageProvider initialLang={initial.urlLang}>
        <StatusBar style="dark" />
        <Flow initial={initial} />
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
