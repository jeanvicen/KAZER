# Kazer — distribuição

Este diretório reúne os arquivos necessários para instalar o Kazer como PWA e preparar futuras distribuições móveis.

## PWA

- `manifest.webmanifest`: identidade, cores, ícones e rota inicial.
- `sw.js`: cache básico do app shell e suporte offline.
- `assets/kazer-logo.jpg`: logo principal enviada pelo criador.
- `icons/kazer-192.png` e `icons/kazer-512.png`: ícones para instalação.

## Integração web

A página `interface/chat.html` exibe o aviso **Instalar Kazer?** e usa o prompt de instalação do navegador quando ele estiver disponível. O `vercel.json` expõe `/manifest.webmanifest` e `/sw.js` no domínio principal.

## Distribuição móvel

As pastas `android/`, `ios/` e `play-store/` ficam reservadas para empacotamentos, certificados, imagens de loja e instruções específicas de cada plataforma. A publicação final exige contas de desenvolvedor, certificados, builds assinadas e aprovação das respectivas lojas.
