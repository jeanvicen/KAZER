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
| **Platform** | `Android` para o primeiro APK; não selecione `All` |
| **Git ref** | `main` |
| **EAS build profile** | `preview` para APK de teste; `production` para publicação |
| **EAS submit profile** | `production` |

Não use `/kazerv1`, `/KazerV1`, `/kazerv1/package.json` ou o diretório raiz como Base directory. O valor deve ser somente `mobile`, sem barra inicial. O `package.json` do app Expo está em `mobile/package.json`; o `eas.json` está em `mobile/eas.json`.

Para o primeiro build, selecione somente **Android**. A opção **All** também tenta criar o aplicativo iOS e exige credenciais Apple, mesmo que o objetivo seja apenas gerar um APK Android.

O aviso **You don't have any build credentials stored in EAS for this app** não é erro de JSON. Ele significa que a conta Expo/EAS ainda não tem uma chave de assinatura cadastrada para `com.kazer.app`. No primeiro build Android, o EAS deve criar uma keystore remota quando a conta estiver autenticada; se a tela não oferecer essa criação, abra o projeto no EAS e use **Credentials → Android → Generate new keystore**. Credenciais não devem ser colocadas no GitHub.

## Comandos EAS

```bash
cd mobile
npx eas build --platform android --profile preview
npx eas build --platform android --profile production
npx eas submit --platform android --profile production
```
