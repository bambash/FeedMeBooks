import * as FileSystem from 'expo-file-system';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import { colors } from '../../theme';
import type { EbookPosition } from '../../types';
import { buildEpubHtml } from './epubHtml';

interface Props {
  uri: string;
  savedPosition: EbookPosition;
  onPositionChange: (position: Partial<EbookPosition>) => void;
  darkMode?: boolean;
  fontSize?: number;
}

export default function EpubReader({
  uri,
  savedPosition,
  onPositionChange,
  darkMode = true,
  fontSize = 18,
}: Props) {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [base64, setBase64] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const theme = {
    background: darkMode ? colors.bg : '#FAFAFA',
    color: darkMode ? colors.text : '#1A1A2E',
    fontSize,
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (!cancelled) setBase64(data);
      } catch (e) {
        console.error('Failed to read epub file:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [uri]);

  const sendToWebView = useCallback((data: object) => {
    webViewRef.current?.injectJavaScript(
      `(function(){ window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(JSON.stringify(data))} })); })(); true;`
    );
  }, []);

  const onWebViewLoad = useCallback(() => {
    if (!base64 || loadedRef.current) return;
    loadedRef.current = true;
    sendToWebView({
      type: 'load',
      base64,
      cfi: savedPosition.cfi,
      theme,
    });
  }, [base64, savedPosition.cfi, sendToWebView, theme]);

  useEffect(() => {
    if (base64 && loadedRef.current) {
      sendToWebView({ type: 'setTheme', theme });
    }
  }, [darkMode, fontSize]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'ready') {
          setLoading(false);
        } else if (data.type === 'locationChanged') {
          onPositionChange({ cfi: data.cfi, percentage: data.percentage });
        }
      } catch {}
    },
    [onPositionChange],
  );

  const htmlContent = buildEpubHtml(theme);

  const goNext = useCallback(() => sendToWebView({ type: 'next' }), [sendToWebView]);
  const goPrev = useCallback(() => sendToWebView({ type: 'prev' }), [sendToWebView]);

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: htmlContent }}
        style={styles.webview}
        onLoad={onWebViewLoad}
        onMessage={onMessage}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowUniversalAccessFromFileURLs
        mixedContentMode="always"
      />
      {/* React Native overlay nav buttons — more reliable than WebView touch events */}
      {!loading && (
        <>
          <Pressable
            style={({ pressed }) => [styles.navBtn, styles.navPrev, pressed && styles.navBtnActive]}
            onPress={goPrev}
            hitSlop={8}
          >
            <Text style={styles.navArrow}>‹</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.navBtn, styles.navNext, pressed && styles.navBtnActive]}
            onPress={goNext}
            hitSlop={8}
          >
            <Text style={styles.navArrow}>›</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    zIndex: 10,
  },
  navBtn: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    opacity: 0.35,
  },
  navBtnActive: {
    opacity: 0.85,
    backgroundColor: 'rgba(124,58,237,0.12)',
  },
  navPrev: { left: 0 },
  navNext: { right: 0 },
  navArrow: {
    fontSize: 36,
    color: colors.text,
    fontWeight: '300',
    lineHeight: 40,
  },
});
