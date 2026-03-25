import * as FileSystem from 'expo-file-system';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing, typography } from '../../theme';
import type { EbookPosition } from '../../types';

interface Props {
  uri: string;
  savedPosition: EbookPosition;
  onPositionChange: (position: Partial<EbookPosition>) => void;
  darkMode?: boolean;
  fontSize?: number;
}

export default function TxtReader({
  uri,
  savedPosition,
  onPositionChange,
  darkMode = true,
  fontSize = 18,
}: Props) {
  const [text, setText] = useState<string | null>(null);
  const [contentHeight, setContentHeight] = useState(1);
  const scrollViewRef = useRef<ScrollView>(null);
  const hasScrolled = useRef(false);

  useEffect(() => {
    FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 })
      .then(setText)
      .catch(() => setText('Unable to read file.'));
  }, [uri]);

  const onContentSizeChange = useCallback(
    (_w: number, h: number) => {
      setContentHeight(h);
      if (!hasScrolled.current && savedPosition.scrollY) {
        scrollViewRef.current?.scrollTo({ y: savedPosition.scrollY, animated: false });
        hasScrolled.current = true;
      }
    },
    [savedPosition.scrollY],
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      const percentage = contentHeight > 0 ? y / contentHeight : 0;
      onPositionChange({ scrollY: y, percentage });
    },
    [contentHeight, onPositionChange],
  );

  if (text === null) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollViewRef}
      style={[styles.container, { backgroundColor: darkMode ? colors.bg : '#FAFAFA' }]}
      contentContainerStyle={styles.content}
      onContentSizeChange={onContentSizeChange}
      onScroll={onScroll}
      scrollEventThrottle={300}
    >
      <Text
        style={[
          styles.text,
          {
            fontSize,
            color: darkMode ? colors.text : '#1A1A2E',
          },
        ]}
        selectable
      >
        {text}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  text: {
    ...typography.body,
    lineHeight: 28,
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
