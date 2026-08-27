# Kazer — distribuição

Este diretório reúne os arquivos de distribuição do mesmo Kazer publicado em `https://kazer.vercel.app`. A interface, as imagens, os textos e as funcionalidades do site permanecem na estrutura existente; as camadas móveis apenas empacotam esse conteúdo.

## PWA

- `manifest.webmanifest`: identidade, cores, ícone de abertura e rota inicial.
- `sw.js`: cache básico do app shell e suporte offline.
- `assets/kazer-logo.jpg`: logo principal existente.
- `assets/kazer-login-symbol.png`: símbolo transparente existente, usado no lançamento do PWA e no empacotamento Android.
- `icons/kazer-192.png` e `icons/kazer-512.png`: ícones existentes preservados separadamente.

## Integração web

A página `interface/chat.html` exibe o aviso **Instalar Kazer?** e usa o prompt de instalação do navegador quando ele estiver disponível. O `vercel.json` expõe o manifesto e o service worker no domínio principal.

## Android e Google Play

A pasta `android/twa/` contém um projeto Trusted Web Activity gerado a partir do manifesto público. Ele abre `https://kazer.vercel.app/chat` sem duplicar a interface dentro do APK.

O projeto gera `app-release-signed.apk` para testes e `app-release-bundle.aab` para envio à Google Play. Esses binários e qualquer chave de assinatura são ignorados pelo Git e não são publicados no repositório. As instruções completas ficam em `android/README.md`.

O arquivo `.well-known/assetlinks.json` mantém a associação entre o domínio e a chave local de desenvolvimento. Antes de uma publicação real, a impressão digital deve ser trocada pela chave de produção usada pelo Play Console.

## Outras plataformas

A pasta `ios/` continua reservada para uma futura versão própria de iPhone/iPad, que exige Xcode e assinatura Apple e não utiliza APK. Outras lojas também exigem seus formatos, certificados e processos específicos; nenhum asset ou pacote visual novo foi inventado nesta etapa.
