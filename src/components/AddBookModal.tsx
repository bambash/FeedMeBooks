import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '../theme';
import { useLibraryStore } from '../store/libraryStore';
import {
  copyFileToAppStorage,
  generateId,
  getExtension,
  isAudioExtension,
  isEbookExtension,
  pickAudioFiles,
  pickAudioFolder,
  pickCoverImage,
  pickEbookFile,
  sanitizeFilename,
} from '../utils/fileUtils';
import type { AudioFormat, EbookFormat } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface FileState {
  uri: string;
  name: string;
}

export default function AddBookModal({ visible, onClose }: Props) {
  const { addBook } = useLibraryStore();
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [ebookFile, setEbookFile] = useState<FileState | null>(null);
  const [audioFiles, setAudioFiles] = useState<FileState[]>([]);
  const [coverFile, setCoverFile] = useState<FileState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setTitle('');
    setAuthor('');
    setEbookFile(null);
    setAudioFiles([]);
    setCoverFile(null);
    setError('');
    setSaving(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handlePickEbook = useCallback(async () => {
    const result = await pickEbookFile();
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setEbookFile({ uri: asset.uri, name: asset.name });
      if (!title) {
        const nameWithoutExt = asset.name.replace(/\.[^.]+$/, '');
        setTitle(nameWithoutExt);
      }
    }
  }, [title]);

  const mergeAudioFiles = useCallback((incoming: { uri: string; name: string }[]) => {
    setAudioFiles((prev) => {
      const merged = [...prev, ...incoming];
      const unique = merged.filter((f, i, arr) => arr.findIndex((x) => x.name === f.name) === i);
      return unique.sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  const handlePickAudioFolder = useCallback(async () => {
    const files = await pickAudioFolder();
    if (files.length > 0) mergeAudioFiles(files);
  }, [mergeAudioFiles]);

  const handlePickAudio = useCallback(async () => {
    const result = await pickAudioFiles();
    if (!result.canceled && result.assets?.length) {
      mergeAudioFiles(result.assets.map((a) => ({ uri: a.uri, name: a.name })));
    }
  }, [mergeAudioFiles]);

  const removeAudioFile = useCallback((name: string) => {
    setAudioFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  const handlePickCover = useCallback(async () => {
    const result = await pickCoverImage();
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setCoverFile({ uri: asset.uri, name: asset.name });
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      setError('Please enter a book title.');
      return;
    }
    if (!ebookFile && audioFiles.length === 0) {
      setError('Please add at least one file (ebook or audio).');
      return;
    }

    setError('');
    setSaving(true);

    try {
      const bookId = generateId();
      let ebookUri: string | undefined;
      let ebookFormat: EbookFormat | undefined;
      let audioUris: string[] | undefined;
      let audioFormat: AudioFormat | undefined;
      let coverUri: string | undefined;

      if (ebookFile) {
        const ext = getExtension(ebookFile.name);
        if (!isEbookExtension(ext)) throw new Error(`Unsupported ebook format: .${ext}`);
        ebookFormat = ext as EbookFormat;
        ebookUri = await copyFileToAppStorage(
          ebookFile.uri,
          bookId,
          sanitizeFilename(ebookFile.name),
        );
      }

      if (audioFiles.length > 0) {
        const copied: string[] = [];
        for (const af of audioFiles) {
          const ext = getExtension(af.name);
          if (!isAudioExtension(ext)) throw new Error(`Unsupported audio format: .${ext}`);
          if (!audioFormat) audioFormat = ext as AudioFormat;
          const uri = await copyFileToAppStorage(af.uri, bookId, sanitizeFilename(af.name));
          copied.push(uri);
        }
        audioUris = copied;
      }

      if (coverFile) {
        coverUri = await copyFileToAppStorage(
          coverFile.uri,
          bookId,
          sanitizeFilename(coverFile.name),
        );
      }

      addBook({
        id: bookId,
        title: title.trim(),
        author: author.trim(),
        ebookUri,
        ebookFormat,
        audioUris,
        audioFormat,
        coverUri,
      });

      reset();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save book.');
    } finally {
      setSaving(false);
    }
  }, [title, author, ebookFile, audioFiles, coverFile, addBook, reset, onClose]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.md) }]}>
          <Pressable onPress={handleClose} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Add Book</Text>
          <Pressable onPress={handleSave} style={styles.headerBtn} disabled={saving}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[styles.headerBtnText, styles.saveText]}>Save</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
        >
          {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

          <Field label="Title *">
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Book title"
              placeholderTextColor={colors.textFaint}
              returnKeyType="next"
            />
          </Field>

          <Field label="Author">
            <TextInput
              style={styles.input}
              value={author}
              onChangeText={setAuthor}
              placeholder="Author name"
              placeholderTextColor={colors.textFaint}
              returnKeyType="done"
            />
          </Field>

          <Field label="Ebook File" hint="epub, pdf, txt">
            <FilePicker
              file={ebookFile}
              placeholder="Choose ebook file…"
              onPick={handlePickEbook}
              onClear={() => setEbookFile(null)}
            />
          </Field>

          <Field label="Audiobook Files" hint="mp3, m4b, m4a, wav, aac, ogg, flac, opus">
            {audioFiles.map((f) => (
              <View key={f.name} style={styles.fileSelected}>
                <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                <Pressable onPress={() => removeAudioFile(f.name)} style={styles.clearBtn}>
                  <Text style={styles.clearBtnText}>✕</Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.audioPickerRow}>
              <Pressable style={[styles.filePicker, styles.audioPickerBtn]} onPress={handlePickAudioFolder}>
                <Text style={styles.filePickerText}>Pick folder…</Text>
              </Pressable>
              <Pressable style={[styles.filePicker, styles.audioPickerBtn]} onPress={handlePickAudio}>
                <Text style={styles.filePickerText}>Pick files…</Text>
              </Pressable>
            </View>
          </Field>

          <Field label="Cover Image" hint="optional">
            <FilePicker
              file={coverFile}
              placeholder="Choose cover image…"
              onPick={handlePickCover}
              onClear={() => setCoverFile(null)}
            />
          </Field>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabel}>
        <Text style={styles.labelText}>{label}</Text>
        {hint ? <Text style={styles.hintText}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function FilePicker({
  file,
  placeholder,
  onPick,
  onClear,
}: {
  file: FileState | null;
  placeholder: string;
  onPick: () => void;
  onClear: () => void;
}) {
  if (file) {
    return (
      <View style={styles.fileSelected}>
        <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
        <Pressable onPress={onClear} style={styles.clearBtn}>
          <Text style={styles.clearBtnText}>✕</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable style={styles.filePicker} onPress={onPick}>
      <Text style={styles.filePickerText}>{placeholder}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBtn: {
    minWidth: 64,
    alignItems: 'center',
    padding: spacing.xs,
  },
  headerBtnText: {
    ...typography.body,
    color: colors.textMuted,
  },
  saveText: {
    color: colors.primary,
    fontWeight: '700',
  },
  headerTitle: {
    ...typography.h3,
    color: colors.text,
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.error,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  errorText: {
    ...typography.small,
    color: colors.error,
  },
  field: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  fieldLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  labelText: {
    ...typography.small,
    color: colors.text,
    fontWeight: '600',
  },
  hintText: {
    ...typography.tiny,
    color: colors.textMuted,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.text,
    ...typography.body,
  },
  filePicker: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    padding: spacing.md,
    alignItems: 'center',
  },
  filePickerText: {
    ...typography.small,
    color: colors.textMuted,
  },
  fileSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.md,
    gap: spacing.sm,
  },
  fileName: {
    flex: 1,
    ...typography.small,
    color: colors.text,
  },
  clearBtn: {
    padding: spacing.xs,
  },
  clearBtnText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  audioPickerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  audioPickerBtn: {
    flex: 1,
  },
});
