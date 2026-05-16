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
  goNextRequest?: number;
  goPrevRequest?: number;
  autoScroll?: boolean;
  scrollSpeed?: number;
  onAutoScrollEnd?: () => void;
  onLog?: (message: string) => void;
  onScrollSpeedChanged?: (speed: number) => void;
  onChapterProgress?: (spineIndex: number, chapterFraction: number) => void;
  onChapterTransition?: (spineIndex: number) => void;
  onTapPause?: () => void;
  onTapResume?: () => void;
  onPeekBack?: () => void;
  swipeSpeedAdjust?: boolean;
  onSwipeSpeedAdjust?: (delta: number) => void;
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
  goNextRequest,
  goPrevRequest,
  autoScroll,
  scrollSpeed,
  onAutoScrollEnd,
  onLog,
  onScrollSpeedChanged,
  onChapterProgress,
  onChapterTransition,
  onTapPause,
  onTapResume,
  onPeekBack,
  swipeSpeedAdjust,
  onSwipeSpeedAdjust,
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
          goNextRequest={goNextRequest}
          goPrevRequest={goPrevRequest}
          autoScroll={autoScroll}
          scrollSpeed={scrollSpeed}
          onAutoScrollEnd={onAutoScrollEnd}
          onLog={onLog}
          onScrollSpeedChanged={onScrollSpeedChanged}
          onChapterProgress={onChapterProgress}
          onChapterTransition={onChapterTransition}
          onTapPause={onTapPause}
          onTapResume={onTapResume}
          onPeekBack={onPeekBack}
          swipeSpeedAdjust={swipeSpeedAdjust}
          onSwipeSpeedAdjust={onSwipeSpeedAdjust}
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
