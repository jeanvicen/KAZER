# Login com Google pelo Supabase Auth

## Arquitetura

```text
Google OAuth
    ↓
Supabase Auth
    ↓
sessão Supabase já usada pelo KAZER
    ↓
/chat, APIs, RLS e dados existentes
```

O Supabase continua sendo a identidade canônica do KAZER. Assim, `auth.users.id` permanece o UUID usado por `profiles`, `user_settings`, demais tabelas, APIs e policies. Não há Firebase, cópia de usuário, senha artificial, migração de dados nem nova tabela de identidade.

O botão chama `supabase.auth.signInWithOAuth({ provider: 'google' })` e retorna a `/login` para que o cliente Supabase existente processe o callback e grave a sessão já consumida pelo `/chat`. O login por e-mail/senha, criação de conta, recuperação e atualização de senha continuam separados e preservados.

## Configuração necessária antes de liberar o botão em produção

Na auditoria de 7 de outubro de 2026, o Google estava desabilitado no Supabase e não havia Client ID nem Client Secret configurados. A URL padrão registrada era `http://localhost:3000` e a lista adicional de redirecionamentos estava vazia. O código não consegue habilitar o provider sem as credenciais OAuth do Google.

1. No Google Cloud Console, crie ou selecione um projeto e gere um cliente OAuth do tipo Web. Configure a origem web de produção do KAZER.
2. No Supabase Dashboard, abra **Authentication → Providers → Google** e copie o callback URI exibido ali para a lista de URIs de redirecionamento autorizados do cliente Google. Não substitua por uma URL estimada.
3. Insira o Client ID e o Client Secret no provider Google do Supabase e habilite-o. O segredo deve ficar somente no Supabase; não o coloque no GitHub, no frontend ou no `.env.example`.
4. Em **Authentication → URL Configuration**, permita o retorno à página `/login` para cada origem realmente usada (produção, domínio personalizado e ambientes de teste). O botão envia a origem atual; origens fora da allowlist serão rejeitadas pelo Supabase.
5. Teste primeiro com uma conta Google já existente no Supabase, cujo e-mail esteja verificado, e depois com uma conta nova. Verifique também logout, refresh e acesso ao `/chat`.

A configuração de OAuth e a allowlist são requisitos externos ao código. Não foram alteradas durante esta implementação.

## Identidades existentes e conflitos

O KAZER não chama `signUp` como fallback quando o Google falha. O Supabase Auth controla a identidade do provider; se devolver conflito, a tela informa que o acesso existente deve ser usado e não cria uma conta paralela pelo fluxo do botão. O vínculo de contas existentes deve ser validado com e-mails verificados após a configuração do provider. Nenhuma policy, sessão, UID, trigger ou dado foi migrado para outro identificador.

## Validação

O teste `test/google-login.test.mjs` verifica a presença do fluxo OAuth no cliente Supabase, o retorno para `/login`, a preservação dos métodos existentes e a ausência de fallback para criação de conta. Ele não substitui o teste real de OAuth; esse depende do Client ID/Secret e da allowlist no Dashboard.
