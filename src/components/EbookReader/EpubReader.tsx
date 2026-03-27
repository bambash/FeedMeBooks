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
  /** When set to a 0-1 percentage, EpubReader will navigate to that position */
  targetPercentage?: number | null;
}

export default function EpubReader({
  uri,
  savedPosition,
  onPositionChange,
  darkMode = true,
  fontSize = 18,
  targetPercentage,
}: Props) {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [base64, setBase64] = useState<string | null>(null);

  // Three-ref pattern to fix race condition between WebView load and base64 read
  const webViewReadyRef = useRef(false);  // onLoad has fired
  const bookSentRef = useRef(false);       // 'load' message sent to WebView
  const base64Ref = useRef<string | null>(null);
  // Track last sent targetPercentage to avoid re-sending the same value
  const sentPercentageRef = useRef<number | null>(null);
  // Always-current ref so onWebViewLoad can read the latest targetPercentage
  const targetPercentageRef = useRef(targetPercentage ?? null);
  targetPercentageRef.current = targetPercentage ?? null;

  const theme = {
    background: darkMode ? colors.bg : '#FAFAFA',
    color: darkMode ? colors.text : '#1A1A2E',
    fontSize,
  };

  // Keep theme accessible in callbacks without causing re-sends
  const themeRef = useRef(theme);
  themeRef.current = theme;

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

  // When base64 arrives: save it and try to send load if WebView is already ready
  useEffect(() => {
    if (!base64) return;
    base64Ref.current = base64;
    if (webViewReadyRef.current && !bookSentRef.current) {
      bookSentRef.current = true;
      sendToWebView({ type: 'load', base64, cfi: savedPosition.cfi, theme: themeRef.current });
    }
  }, [base64]); // eslint-disable-line react-hooks/exhaustive-deps

  const onWebViewLoad = useCallback(() => {
    webViewReadyRef.current = true;
    if (base64Ref.current && !bookSentRef.current) {
      bookSentRef.current = true;
      sendToWebView({ type: 'load', base64: base64Ref.current, cfi: savedPosition.cfi, theme: themeRef.current });
    }
    // Deliver any percentage jump that arrived before the WebView was ready
    const pct = targetPercentageRef.current;
    if (pct != null && pct !== sentPercentageRef.current) {
      sentPercentageRef.current = pct;
      sendToWebView({ type: 'goToPercentage', percentage: pct });
    }
  }, [savedPosition.cfi, sendToWebView]);

  // Send theme updates after book is loaded
  useEffect(() => {
    if (bookSentRef.current) {
      sendToWebView({ type: 'setTheme', theme });
    }
  }, [darkMode, fontSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate to a percentage position when targetPercentage changes
  useEffect(() => {
    if (
      targetPercentage != null &&
      webViewReadyRef.current &&
      targetPercentage !== sentPercentageRef.current
    ) {
      sentPercentageRef.current = targetPercentage;
      sendToWebView({ type: 'goToPercentage', percentage: targetPercentage });
    }
  }, [targetPercentage, sendToWebView]);

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
