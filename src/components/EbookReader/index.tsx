import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../../theme';
import type { EbookFormat, EbookPosition } from '../../types';
import EpubReader from './EpubReader';
import PdfReader from './PdfReader';
import TxtReader from './TxtReader';

interface Props {
  uri: string;
  format: EbookFormat;
  savedPosition: EbookPosition;
  onPositionChange: (position: Partial<EbookPosition>) => void;
  darkMode?: boolean;
  fontSize?: number;
  targetPercentage?: number | null;
  targetChapter?: number | null;
  textExtractRequest?: number;
  onTextExtracted?: (chapters: { chapterIndex: number; text: string }[]) => void;
  onLog?: (message: string) => void;
}

export default function EbookReader({
  uri,
  format,
  savedPosition,
  onPositionChange,
  darkMode = true,
  fontSize = 18,
  targetPercentage,
  targetChapter,
  textExtractRequest,
  onTextExtracted,
  onLog,
}: Props) {
  switch (format) {
    case 'epub':
      return (
        <EpubReader
          uri={uri}
          savedPosition={savedPosition}
          onPositionChange={onPositionChange}
          darkMode={darkMode}
          fontSize={fontSize}
          targetPercentage={targetPercentage}
          targetChapter={targetChapter}
          textExtractRequest={textExtractRequest}
          onTextExtracted={onTextExtracted}
          onLog={onLog}
        />
      );
    case 'pdf':
      return (
        <PdfReader
          uri={uri}
          savedPosition={savedPosition}
          onPositionChange={onPositionChange}
        />
      );
    case 'txt':
      return (
        <TxtReader
          uri={uri}
          savedPosition={savedPosition}
          onPositionChange={onPositionChange}
          darkMode={darkMode}
          fontSize={fontSize}
        />
      );
    default:
      return (
        <View style={styles.unsupported}>
          <Text style={styles.unsupportedText}>Unsupported format: {format}</Text>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  unsupported: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: 24,
  },
  unsupportedText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
