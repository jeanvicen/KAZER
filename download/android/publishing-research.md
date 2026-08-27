# Pesquisa de empacotamento Android do Kazer

## Fontes oficiais consultadas

- Android Developers — Trusted Web Activities Quick Start Guide: https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2
- Android Developers — About Android App Bundles: https://developer.android.com/guide/app-bundle
- web.dev — Add a web app manifest: https://web.dev/articles/add-manifest

## Achados aplicáveis ao Kazer

1. Trusted Web Activity (TWA) permite que um aplicativo Android abra o conteúdo web do PWA em tela cheia, sem a interface comum do navegador, desde que a verificação por Digital Asset Links seja concluída.
2. A verificação exige um arquivo `/.well-known/assetlinks.json` hospedado no domínio e metadados correspondentes no aplicativo Android. Sem essa verificação, o navegador pode recuar para uma Custom Tab.
3. O Android App Bundle (AAB) é o formato de publicação que permite à Google Play gerar APKs otimizados por dispositivo. Apps novos na Google Play precisam ser enviados como AAB, enquanto APK continua útil para instalação direta e testes.
4. A publicação real exige assinatura, identidade de pacote permanente, chave de assinatura protegida, conta de desenvolvedor Google Play e preenchimento das informações exigidas pelo Play Console. Nenhuma chave privada deve ser gravada no repositório.
5. A estratégia de menor impacto para o Kazer é adicionar uma pasta de empacotamento Android separada, apontando para `https://kazer.vercel.app`, sem mover, reescrever ou duplicar a interface estática existente.

## Escopo da implementação

A estrutura deve gerar um projeto Android configurável para TWA, incluir placeholders documentados para a chave de assinatura e o `assetlinks.json`, manter o manifesto e service worker web atuais, e disponibilizar comandos para gerar APK de teste e AAB de release quando o ambiente Android/Java e as credenciais estiverem disponíveis.
