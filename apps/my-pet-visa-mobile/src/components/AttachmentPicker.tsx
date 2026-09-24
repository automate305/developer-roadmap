import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { useT } from '../i18n';
import { colors, fonts, radius, spacing, typography } from '../theme';
import type { Attachment } from '../types';
import { uid } from '../utils';

interface Props {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
}

/**
 * On mobile web the native camera picker's web fallback opens a webcam
 * viewfinder, which is awkward on a phone. A plain file input with
 * `capture="environment"` makes iOS Safari and Android Chrome open the
 * real camera sheet instead, which is what a client photographing a
 * paper certificate expects.
 */
function pickFromWebInput(opts: { accept: string; capture?: boolean }): Promise<Attachment | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = opts.accept;
    if (opts.capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      resolve({ id: uid(), uri: URL.createObjectURL(file), name: file.name, mimeType: file.type, size: file.size });
    };
    // Some browsers never fire change on cancel; clean up on focus return.
    window.addEventListener('focus', () => setTimeout(() => input.remove(), 1000), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/** Three big buttons: take a photo, choose a photo, or pick a PDF/file. */
export function AttachmentPicker({ attachments, onChange }: Props) {
  const t = useT();
  const add = (a: Attachment | null) => {
    if (a) onChange([...attachments, a]);
  };
  const remove = (id: string) => onChange(attachments.filter((a) => a.id !== id));

  const takePhoto = async () => {
    if (Platform.OS === 'web') {
      add(await pickFromWebInput({ accept: 'image/*', capture: true }));
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('attachCameraNeededTitle'), t('attachCameraNeeded'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled) return;
    const asset = result.assets[0];
    add({
      id: uid(),
      uri: asset.uri,
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
      size: asset.fileSize,
    });
  };

  const choosePhoto = async () => {
    if (Platform.OS === 'web') {
      add(await pickFromWebInput({ accept: 'image/*' }));
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('attachPhotosNeededTitle'), t('attachPhotosNeeded'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled) return;
    const asset = result.assets[0];
    add({
      id: uid(),
      uri: asset.uri,
      name: asset.fileName ?? `image-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
      size: asset.fileSize,
    });
  };

  const chooseFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    add({ id: uid(), uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.buttons}>
        <Button title={t('attachTakePhoto')} variant="secondary" onPress={takePhoto} style={styles.btn} />
        <Button title={t('attachChoosePhoto')} variant="secondary" onPress={choosePhoto} style={styles.btn} />
        <Button title={t('attachUploadFile')} variant="secondary" onPress={chooseFile} style={styles.btn} />
      </View>

      {attachments.length > 0 ? (
        <View style={styles.list}>
          {attachments.map((a) => {
            const isImage = (a.mimeType ?? '').startsWith('image/');
            return (
              <View key={a.id} style={styles.item}>
                {isImage ? (
                  <Image source={{ uri: a.uri }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.fileIcon]}>
                    <Text style={styles.fileIconText}>PDF</Text>
                  </View>
                )}
                <Text style={styles.name} numberOfLines={1}>
                  {a.name}
                </Text>
                <Pressable onPress={() => remove(a.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${t('remove')} ${a.name}`}>
                  <Text style={styles.remove}>{t('remove')}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={typography.small}>{t('attachNone')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  buttons: { gap: spacing.sm },
  btn: { minHeight: 44, paddingVertical: spacing.sm },
  list: { gap: spacing.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.successLight,
  },
  thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.border },
  fileIcon: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  fileIconText: { fontSize: 12, fontFamily: fonts.sansBold, color: colors.primary },
  name: { flex: 1, fontSize: 15, fontFamily: fonts.sans, color: colors.text },
  remove: { color: colors.danger, fontFamily: fonts.sansSemiBold },
});
