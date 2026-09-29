import React, { useRef, useState } from 'react';
import { ActivityIndicator, Linking, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
          <Text style={styles.title}>KAZER</Text>
          <Text style={styles.message}>Não foi possível carregar o KAZER agora.</Text>
          <TouchableOpacity style={styles.button} onPress={() => setFailed(false)}>
            <Text style={styles.buttonText}>Tentar novamente</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(KAZER_URL)}>
            <Text style={styles.link}>Abrir no navegador</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      {loading && <ActivityIndicator color="#ffffff" style={styles.loader} />}
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
  container: { flex: 1, backgroundColor: '#090b10' },
  loader: { position: 'absolute', top: 22, alignSelf: 'center', zIndex: 1 },
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { color: '#ffffff', fontSize: 32, fontWeight: '700', letterSpacing: 4, marginBottom: 18 },
  message: { color: '#c8ccd6', fontSize: 16, textAlign: 'center', marginBottom: 24 },
  button: { backgroundColor: '#ffffff', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, marginBottom: 18 },
  buttonText: { color: '#090b10', fontWeight: '700' },
  link: { color: '#9ca7ff', fontSize: 15 }
});
