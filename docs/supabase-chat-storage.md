# Armazenamento do chat no Supabase

O chat do KAZER guarda conversas, mensagens, anexos, preferências e memórias no
Postgres do projeto Supabase `Kazer` (`mqjunopzycdezzjmlhip`). Este documento
descreve o que foi criado, por que, como aplicar e como reverter.

## Por que o banco e não o disco

A aplicação roda na Vercel em modo serverless: o disco é efêmero e cada
requisição pode cair numa instância diferente. O SQLite continua no repositório
e é usado no desenvolvimento local; em produção, quando `SUPABASE_URL` e as
chaves estão configuradas, o chat fala com o Postgres. Sem nenhum dos dois o
chat responde `chat_unavailable` (503) em vez de fingir que gravou.

A escolha de backend fica em `kazer/interfaces/web/app.py::_build_chat`:

| Ambiente | Armazenamento | Anexos |
| --- | --- | --- |
| Supabase configurado | `SupabaseChatStore` | bucket privado `kazer-anexos` |
| Local sem Supabase | `ChatStore` (SQLite) | disco |
| Serverless sem Supabase | chat fechado (`chat_unavailable`) | — |

## Migrações

Aplicar **em ordem**, depois das duas migrações de fundação que já existem:

1. `supabase/migrations/20261029180000_kazer_chat_storage.sql` — colunas,
   tabelas, índices e cota.
2. `supabase/migrations/20261029181000_kazer_chat_operations.sql` — as operações
   do chat como funções, o bucket de anexos e os grants.
3. `supabase/migrations/20261030120000_kazer_library.sql` — a Biblioteca: as
   operações dos artefatos, a listagem que junta enviados e produzidos, e as
   duas funções que ganham um campo novo (`kazer_message_json` passa a dizer o
   que a resposta rendeu; `kazer_export` leva os artefatos junto).
4. `supabase/migrations/20261030160000_kazer_projects_skills.sql` — projetos
   (nome e objetivo, com a conversa apontando para um) e habilidades (formato
   `SKILL.md`: nome, descrição e instruções), incluindo o catálogo do que foi
   publicado e a instalação na própria conta.
   > Os **projetos** criados por essa migração deixaram de ter uso na interface
   > (o recurso foi retirado do produto). As tabelas, funções e políticas
   > continuam como estão, sem apagar nada: dados e migrações são preservados.

5. `supabase/migrations/20261030190000_kazer_connections.sql` — os conectores
   ligados. **A credencial é o ponto sensível**: a tabela não tem política de
   leitura e `revoke all ... from anon, authenticated` fecha o acesso direto,
   então `kazer_connections()` devolve nome, ferramentas e estado, e o único
   caminho até o segredo é `kazer_connection_secret()`, `security definer` e
   presa a `auth.uid()`.

Todas são **aditivas**: só criam colunas (`add column if not exists`), tabelas,
índices e funções novas. Nenhuma tabela, política, dado ou migração anterior é
alterada ou removida.

### Aplicar

Pelo painel do Supabase (SQL Editor), colando o conteúdo de cada arquivo na
ordem acima; ou pelo CLI, com o projeto linkado:

```sh
supabase db push
```

Para validar antes, sem tocar no projeto real, basta um Postgres 16 vazio: as
migrações rodam inteiras em transação e os dois arquivos de
`supabase/tests/` conferem o resultado (veja "Testes" abaixo).

### Reverter

Nada precisa ser apagado para voltar atrás: as colunas novas são todas opcionais
e as funções podem sair sem tocar em dado nenhum.

```sql
-- 1. Funções (a aplicação volta a falar com o SQLite ou a responder 503)
drop function if exists public.kazer_begin_exchange(uuid, text, text, text, uuid[], jsonb, integer, text);
-- ... as demais kazer_* da migração 20261029181000
-- 2. Tabelas novas (apaga os dados que elas guardam)
drop table if exists public.kazer_artifacts, public.kazer_memories,
                     public.kazer_preferences, public.kazer_plans;
-- 3. Colunas novas (opcional: deixá-las não quebra nada)
alter table public.messages drop column if exists seq, drop column if exists thinking;
```

As tabelas `conversations`, `messages`, `attachments`, `usage_events` e
`usage_windows` são anteriores a estas migrações e **não** devem ser removidas.

## O que foi criado

### Colunas acrescentadas

`public.messages` ganhou `seq` (ordem dentro da conversa), `thinking` (resumo de
raciocínio, limitado a 20.000 caracteres), `status`, `error_code`, `stop_reason`,
`client_id` (idempotência) e `finished_at`. `public.attachments` ganhou `kind` e
`name`.

Dois índices únicos garantem as invariantes: `messages_conversation_seq_key`
(uma mensagem por posição) e `messages_conversation_client_key` (o mesmo envio
reenviado pelo navegador não vira mensagem duplicada).

### Tabelas novas

| Tabela | Para quê |
| --- | --- |
| `kazer_plans` | plano da conta (`free`, `pro`, `ultra`) |
| `kazer_preferences` | preferências da interface por conta |
| `kazer_memories` | memória por usuário, escrita e apagável por ele |
| `kazer_artifacts` | artefatos gerados, para a Biblioteca |

`kazer_plans` é **somente leitura** para o dono: o grant de `UPDATE`/`INSERT` não
existe para `authenticated`. Isso é deliberado — numa versão anterior o plano
morava em `public.profiles`, que já concede `UPDATE` ao dono, e qualquer conta
conseguia se promover para `ultra` com um `PATCH`. O teste de RLS cobre esse
caso.

### Cota e uso

`kazer_plan_quota(plan)` devolve a franquia e a janela de cada plano em um lugar
só; `kazer_reserve_usage` trava a linha da janela (`for update`), rola a janela
vencida, reconcilia a franquia com o plano atual e devolve
`{allowed, plan, reset_at, allowance, consumed}`. `kazer_settle_usage` devolve o
que sobrou quando a resposta termina mais barata que o reservado.

O custo é proporcional à complexidade do pedido, calculado em
`kazer/chat/service.py::_weigh` (pensamento profundo, busca na web, imagens,
PDFs, prompt longo, histórico longo), com teto de 12 unidades por envio. O valor
cobrado fica gravado em `options.units` de cada mensagem, então o consumo é
auditável.

### Histórico leve

Cada conta guarda no máximo **100 conversas**. Quando a 101ª nasce,
`kazer_begin_exchange` apaga a mais antiga na mesma transação e devolve os
caminhos dos anexos dela, que o backend remove do bucket. A conversa que acabou
de ser criada nunca é a podada.

### Anexos

Bucket privado `kazer-anexos`, com política por conta: o caminho de cada arquivo
começa com o `user_id` do dono, e a política compara esse prefixo com
`auth.uid()`. O conteúdo que a pessoa envia é guardado inteiro — a poda do
histórico é por conversa, não por arquivo.

## Identidade nas chamadas

O store fala com o PostgREST como **a própria pessoa**: o access token da sessão
viaja num `ContextVar` (`kazer/chat/identity.py`) e vai no `Authorization` de
cada chamada, então `auth.uid()` é quem decide o que a consulta enxerga.

A geração da resposta roda numa thread, e thread nova não herda contexto — por
isso o token é passado explicitamente com `bind_access_token`. Quando a geração
é longa o bastante para o token vencer, a gravação final usa a service role com
`p_user_id` explícito; as funções fazem `coalesce(auth.uid(), p_user_id)`, de
modo que o JWT sempre ganha quando existe e a service role só entra quando não
há JWT nenhum.

## Testes

```sh
psql -f supabase/migrations/20261029131800_kazer_supabase_foundation.sql
psql -f supabase/migrations/20261029132400_fix_auth_signup_provisioning.sql
psql -f supabase/migrations/20261029180000_kazer_chat_storage.sql
psql -f supabase/migrations/20261029181000_kazer_chat_operations.sql
psql -f supabase/migrations/20261030120000_kazer_library.sql
psql -f supabase/migrations/20261030160000_kazer_projects_skills.sql
psql -f supabase/migrations/20261030190000_kazer_connections.sql
psql -f supabase/tests/chat_storage_test.sql     # cenário completo
psql -f supabase/tests/rls_test.sql              # isolamento entre contas
psql -f supabase/tests/library_test.sql          # Biblioteca e artefatos
psql -f supabase/tests/projects_skills_test.sql  # projetos e habilidades
psql -f supabase/tests/connections_test.sql      # conectores e a credencial
```

`connections_test.sql` prende o que mais importa nos conectores: a credencial
não sai em listagem, outra conta não a lê nem desliga nem apaga o conector,
religar o mesmo serviço atualiza em vez de duplicar, o teto do plano é
respeitado, e desligar mantém a credencial enquanto apagar leva tudo.

`projects_skills_test.sql` cobre projetos e habilidades: criar, renomear,
apagar (a conversa fica, sem projeto), o teto de cada um, publicar e instalar
uma habilidade de outra pessoa, e o isolamento entre contas.

`library_test.sql` cobre a Biblioteca: gravar os artefatos de uma resposta,
substituí-los quando ela é gerada de novo, juntar as duas origens na listagem,
os filtros, o limite da página e o isolamento entre contas (ler, apagar e
gravar na resposta de outra pessoa).

`chat_storage_test.sql` percorre o caminho real: criar conversa, paginar
mensagens, reenviar o mesmo `client_id`, estourar a cota, devolver o que sobrou,
podar o histórico no limite e exportar. `rls_test.sql` cria duas contas e
confere que nenhuma enxerga nem escreve o que é da outra, incluindo a tentativa
de trocar o próprio plano.

Ambos terminam imprimindo que passaram e dão `rollback` no fim, então podem
rodar quantas vezes for preciso no mesmo banco.

## O que ainda depende de configuração

As migrações precisam ser aplicadas ao projeto real; o conector Supabase desta
sessão não tem permissão de escrita no projeto `Kazer`, então elas foram escritas
e validadas contra um Postgres local, mas **não** aplicadas em produção.
