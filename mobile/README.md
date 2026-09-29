# KAZER Mobile (Expo + EAS)

Este diretório é o aplicativo nativo Expo do KAZER. Ele abre a aplicação web publicada em `https://kazer.vercel.app/chat` dentro de uma WebView, mantendo a autenticação e a interface existentes.

## Rodar localmente

```bash
cd mobile
npm install
npx expo start
```

Para usar outro domínio durante o teste, defina `EXPO_PUBLIC_KAZER_URL` antes de iniciar.

## Campos do Build from GitHub / EAS

Use exatamente estes valores ao selecionar este repositório:

| Campo | Valor |
|---|---|
| **Base directory** | `mobile` |
| **Git ref** | `main` |
| **EAS build profile** | `preview` para APK de teste; `production` para publicação |
| **EAS submit profile** | `production` |

Não use `/kazerv1`, `/kazerv1/package.json` ou o diretório raiz como Base directory. O `package.json` do app Expo está em `mobile/package.json`; o `eas.json` está em `mobile/eas.json`.

Para o primeiro build, o EAS pode pedir a criação/vinculação do projeto Expo. Aceite a criação para a conta proprietária do KAZER e mantenha o identificador Android `com.kazer.app`.

## Comandos EAS

```bash
cd mobile
npx eas build --platform android --profile preview
npx eas build --platform android --profile production
npx eas submit --platform android --profile production
```
