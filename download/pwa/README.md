# Kazer PWA

A instalação web é iniciada pelo aviso **Instalar Kazer?** exibido no `chat.html`. Quando o navegador dispara `beforeinstallprompt`, o botão **Instalar agora** chama o prompt nativo. Em navegadores sem esse recurso, o aviso orienta o usuário a usar o menu do navegador e escolher **Adicionar à tela inicial**.

O app abre em `/chat.html`, usa o tema escuro do Kazer e registra `/sw.js` para o app shell. O service worker é servido pelo Vercel a partir de `download/sw.js` por meio do rewrite definido em `vercel.json`.
