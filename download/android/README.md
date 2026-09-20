# Kazer — APK Android via Trusted Web Activity

O Kazer possui agora um pacote Android real, gerado a partir do PWA público por meio de um projeto **Trusted Web Activity (TWA)** criado com Bubblewrap. O APK abre `https://kazer.vercel.app/chat` em uma atividade confiável, sem barra de endereço do Chrome quando a associação de domínio estiver validada.

## Artefatos

| Arquivo | Uso |
|---|---|
| `download/android/kazer.apk` | APK release assinado, pronto para baixar e instalar manualmente no Android. |
| `twa/app/build/outputs/apk/release/app-release-signed.apk` | Cópia local produzida pelo build; ignorada pelo Git. |
| `twa/app/build/outputs/bundle/release/app-release.aab` | Opcional, para um futuro envio à Google Play. |
| `twa/.secrets/kazer-release.keystore` | Chave privada de assinatura; não é publicada no Git. |

O APK é um arquivo Android real. Ao baixá-lo pelo Chrome, ele deve aparecer em **Transferências**; ao tocar nele, o Android abre o instalador. A instalação pode exigir a permissão do sistema para instalar aplicativos dessa fonte.

## Segurança da keystore

A keystore de release está acompanhada do arquivo local `twa/.secrets/kazer-release-credentials.txt`. Guarde ambos em um gerenciador de senhas ou backup criptografado. **Não publique a keystore nem as senhas.** Perder a keystore ou sua senha impede atualizar o mesmo aplicativo `com.kazer.app` no futuro.

A fingerprint SHA-256 da chave de release também está publicada em `/.well-known/assetlinks.json`. A associação mantém o domínio e o APK como a mesma identidade e permite que a TWA funcione sem aparência de navegador. A associação ainda mantém a fingerprint antiga de desenvolvimento para não quebrar instalações de teste anteriores.

## Como gerar uma nova versão

O projeto Android já foi gerado pelo Bubblewrap a partir do manifesto público. Para gerar uma nova versão localmente:

```bash
cd download/android/twa
export ANDROID_HOME="$HOME/android-sdk"
export JAVA_HOME="/usr/lib/jvm/java-21-openjdk-amd64"
export BUBBLEWRAP_KEYSTORE_PASSWORD='senha-da-keystore'
# Como a keystore PKCS12 usa a mesma senha na entrada privada:
export BUBBLEWRAP_KEY_PASSWORD="$BUBBLEWRAP_KEYSTORE_PASSWORD"
./build-android.sh
```

O script executa `assembleRelease`, assina o APK com `apksigner`, valida a assinatura e copia o resultado para `download/android/kazer.apk`. Para uma atualização, aumente `versionCode` e `versionName` em `twa/app/build.gradle`, mantendo o mesmo `applicationId` e a mesma keystore.

Para recriar o projeto TWA do zero em outro ambiente, instale o Bubblewrap CLI e use o manifesto público:

```bash
npx @bubblewrap/cli@latest init --manifest=https://kazer.vercel.app/download/manifest.webmanifest
```

Depois, copie a configuração de assinatura para a nova keystore e gere o build release. O APK continua dependendo de internet para carregar o Kazer, como definido no escopo atual.

## Limitações de validação

O APK foi compilado e verificado estruturalmente com `apksigner`, incluindo assinatura v1, v2 e v3, identidade `com.kazer.app`, versão 3 e URL pública do Kazer. Este ambiente não possui um dispositivo Android ou emulador conectado; portanto, a instalação física em um aparelho precisa ser confirmada ao testar o arquivo baixado.

## Distribuição

O arquivo servido pelo site usa `Content-Type: application/vnd.android.package-archive` e `Content-Disposition: attachment; filename="kazer.apk"`. A distribuição fora da Google Play pode exibir avisos de segurança do Android, que são normais para APKs instalados manualmente.

O `.aab` é o formato apropriado para a Google Play, mas sua publicação ainda exige conta de desenvolvedor, informações de loja, política de privacidade, classificação etária e configuração própria de assinatura no Play Console.

## Conteúdo preservado

O APK não duplica a interface: ele carrega a rota web existente `/chat`, usa o manifesto PWA e mantém o ícone Kazer já existente. iOS não utiliza APK e continua exigindo um projeto próprio com Xcode e certificados Apple.
