import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Pdf from 'react-native-pdf';
import { colors } from '../../theme';
import type { EbookPosition } from '../../types';

interface Props {
  uri: string;
  savedPosition: EbookPosition;
  onPositionChange: (position: Partial<EbookPosition>) => void;
}

export default function PdfReader({ uri, savedPosition, onPositionChange }: Props) {
  const [loading, setLoading] = useState(true);

  const onLoadComplete = useCallback((numberOfPages: number) => {
    setLoading(false);
  }, []);

  const onPageChanged = useCallback(
    (page: number, numberOfPages: number) => {
      const percentage = numberOfPages > 0 ? (page - 1) / numberOfPages : 0;
      onPositionChange({ page, percentage });
    },
    [onPositionChange],
  );

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
      <Pdf
        source={{ uri, cache: true }}
        page={savedPosition.page ?? 1}
        onLoadComplete={onLoadComplete}
        onPageChanged={onPageChanged}
        style={styles.pdf}
        enablePaging
        horizontal
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  pdf: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
