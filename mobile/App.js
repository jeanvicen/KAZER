import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';

const KAZER_URL = process.env.EXPO_PUBLIC_KAZER_URL || 'https://kazer.vercel.app/chat';
const KAZER_ORIGIN = new URL(KAZER_URL).origin;

export default function App() {
  const webViewRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.errorBox}>
          <View style={styles.errorCard}>
            <View style={styles.mark}>
              <Image source={require('./assets/icon.png')} style={styles.markImage} accessible={false} />
            </View>
            <Text style={styles.title}>KAZER</Text>
            <Text style={styles.message}>Não foi possível carregar o KAZER agora.</Text>
            <TouchableOpacity style={styles.button} onPress={() => setFailed(false)}>
              <Text style={styles.buttonText}>Tentar novamente</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.browserButton} onPress={() => Linking.openURL(KAZER_URL)}>
              <Text style={styles.link}>Abrir no navegador</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      {loading && (
        <View pointerEvents="none" style={styles.loadingBadge} accessibilityLiveRegion="polite">
          <ActivityIndicator color="#f07a80" size="small" />
          <Text style={styles.loadingText}>Abrindo seu espaço…</Text>
        </View>
      )}
      <WebView
        ref={webViewRef}
        source={{ uri: KAZER_URL }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => { setLoading(false); setFailed(true); }}
        onHttpError={() => { setLoading(false); setFailed(true); }}
        onShouldStartLoadWithRequest={(request) => request.url.startsWith(KAZER_ORIGIN)}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        startInLoadingState
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07070a' },
  loadingBadge: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
    minHeight: 48,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    backgroundColor: 'rgba(17,17,21,0.94)',
  },
  loadingText: { color: '#f3f0ea', fontSize: 14, fontWeight: '600', letterSpacing: 0.1 },
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorCard: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 34,
    paddingBottom: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 24,
    backgroundColor: '#111115',
  },
  mark: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(197,58,63,0.38)',
    borderRadius: 18,
    backgroundColor: 'rgba(197,58,63,0.10)',
  },
  markImage: { width: 36, height: 36, resizeMode: 'contain' },
  title: { color: '#f3f0ea', fontSize: 13, fontWeight: '700', letterSpacing: 4, marginBottom: 12 },
  message: { maxWidth: 300, color: '#c7c2c9', fontSize: 16, lineHeight: 24, textAlign: 'center', marginBottom: 24 },
  button: {
    width: '100%',
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    borderRadius: 14,
    backgroundColor: '#c53a3f',
    marginBottom: 10,
  },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  browserButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  link: { color: '#f07a80', fontSize: 14, fontWeight: '600' }
});
