# Kazer — preparação para Google Play

## Identidade configurada

| Campo | Valor atual |
|---|---|
| Nome do app | Kazer |
| Nome curto | Kazer |
| Categoria sugerida | Produtividade |
| Cor principal | `#070707` |
| Ícone utilizado no empacotamento | `download/assets/kazer-login-symbol.png` |
| Application ID | `com.kazer.app` |
| Rota inicial | `/chat` |

## Pacotes gerados

O projeto em `download/android/twa/` já foi compilado com sucesso usando uma chave local de desenvolvimento fora do repositório:

- `app-release-signed.apk`: pacote para instalação direta e testes em aparelho Android.
- `app-release-bundle.aab`: pacote de publicação para a Google Play.

Os binários são artefatos locais e estão excluídos do Git. Eles não devem ser enviados como arquivos de código para o repositório.

## Antes do primeiro envio

O proprietário ainda precisa confirmar o `com.kazer.app`, criar ou selecionar a conta de desenvolvedor da Google Play, usar uma chave de assinatura de produção protegida, atualizar a impressão digital no `/.well-known/assetlinks.json`, preparar screenshots reais do aplicativo e preencher no Play Console as informações de privacidade, segurança de dados, classificação etária, público-alvo e contato exigidas pela loja.

O APK de desenvolvimento não deve ser tratado como versão final de produção. A chave usada para ele é somente local, e a chave privada não está no repositório.

## Regra de preservação

O Android não copia nem modifica a interface do Kazer. O pacote abre a versão web publicada em `https://kazer.vercel.app/chat` usando o símbolo já existente. Não foram adicionadas fotos, imagens de loja, textos de interface ou funcionalidades que não existiam.

## Referências oficiais

- [Android App Bundles](https://developer.android.com/guide/app-bundle)
- [Trusted Web Activities Quick Start](https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2)
- [Google Play Console](https://play.google.com/console/about/)
