import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { colors, fonts, radius, spacing, typography } from '../theme';
import type { Attachment } from '../types';
import { uid } from '../utils';

interface Props {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
}

/** Three big buttons: take a photo, choose a photo, or pick a PDF/file. */
export function AttachmentPicker({ attachments, onChange }: Props) {
  const add = (a: Attachment) => onChange([...attachments, a]);
  const remove = (id: string) => onChange(attachments.filter((a) => a.id !== id));

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera needed', 'Please allow camera access to photograph your document.');
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
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photos needed', 'Please allow photo access to attach your document.');
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
        {Platform.OS !== 'web' ? (
          <Button title="Take photo" variant="secondary" onPress={takePhoto} style={styles.btn} />
        ) : null}
        <Button title="Choose photo" variant="secondary" onPress={choosePhoto} style={styles.btn} />
        <Button title="Upload PDF / file" variant="secondary" onPress={chooseFile} style={styles.btn} />
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
                <Pressable onPress={() => remove(a.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${a.name}`}>
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={typography.small}>No file attached yet. A clear photo of the paper is fine.</Text>
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
