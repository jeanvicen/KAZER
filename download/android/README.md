# Kazer — empacotamento Android

O Kazer continua sendo o mesmo site estático publicado em `https://kazer.vercel.app`. O projeto Android em `twa/` é apenas uma camada separada de **Trusted Web Activity**: ele abre a rota existente `/chat` no aplicativo, sem copiar a interface, sem criar telas novas e sem substituir arquivos do site.

## Artefatos

O build produz dois formatos:

| Arquivo | Uso |
|---|---|
| `app-release-signed.apk` | Instalação direta e testes em um aparelho Android. |
| `app-release-bundle.aab` | Formato de envio para um app novo na Google Play. |

A Google Play normalmente recebe o `.aab`; o `.apk` fica para teste, instalação manual ou distribuição fora da loja.

## Build local

O ambiente precisa ter Node.js, JDK 17 e o Android SDK. O Bubblewrap pode instalar os componentes do SDK na primeira execução.

1. Coloque uma chave de assinatura fora do Git ou no caminho ignorado pelo projeto:

```bash
mkdir -p .secrets
cp /caminho/da/sua-chave.keystore .secrets/kazer-release.keystore
```

2. Edite `twa-manifest.json` apenas para apontar `signingKey.path` e `signingKey.alias` para a sua chave. A chave de produção nunca deve ser publicada no repositório.

3. Gere os artefatos:

```bash
cd download/android/twa
export BUBBLEWRAP_KEYSTORE_PASSWORD='senha-local-do-keystore'
export BUBBLEWRAP_KEY_PASSWORD='senha-local-da-chave'
./build-android.sh
```

O script não possui senhas fixas e falha se a chave ou as variáveis de ambiente não estiverem disponíveis.

## Verificação do domínio

Para o TWA abrir sem a barra do navegador, o domínio precisa confirmar a relação com o aplicativo em `/.well-known/assetlinks.json`. O arquivo atual contém somente a impressão digital da chave local de desenvolvimento usada no teste. Antes de uma publicação real na Google Play, troque essa impressão pela chave de assinatura de produção ou pela chave de assinatura de app fornecida pelo Play Console.

O identificador inicial configurado para o projeto é `com.kazer.app`. Esse identificador deve ser confirmado antes do primeiro envio à Google Play, pois o ID do aplicativo é parte da identidade permanente do pacote.

## Conteúdo preservado

O empacotamento usa apenas estes elementos já existentes no Kazer: a URL pública, a rota `/chat`, o manifesto PWA, o service worker e o símbolo transparente `download/assets/kazer-login-symbol.png`. Não foram criadas fotos, imagens de loja, logos, textos de interface ou funcionalidades novas.

## Outras plataformas

O projeto Android não gera um aplicativo iOS: iPhone/iPad exigem Xcode, certificados Apple e um pacote próprio para a App Store, e não usam APK. Windows, macOS e outras lojas também exigem empacotadores e requisitos específicos. A pasta `download/ios/` permanece apenas como área reservada, sem inventar um pacote ou assets que não existem.
