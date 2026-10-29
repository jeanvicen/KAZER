# Arquitetura do KAZER

## Princípios e decisões

1. **Começar simples e evoluir por evidência**: workflows explícitos antes de autonomia; introduzir agentes dinâmicos somente onde flexibilidade traz valor medido.
2. **Contratos antes de implementações**: dependências apontam para abstrações; adaptadores ficam nas bordas.
3. **Permissões independentes do modelo**: saída do modelo é dado não confiável; política determinística decide autorização.
4. **Falha fechada**: falta de identidade, escopo, permissão ou aprovação bloqueia execução.
5. **Contexto seletivo**: recuperar o mínimo de informação relevante; separar conteúdo externo de instruções confiáveis.
6. **UI restrita à entrada**: a única tela é a de autenticação (`interfaces/web`); CLI, API do agente e webhook continuam stubs. A interface principal segue no roadmap.

## Fluxo de tarefa

`entrada → input_guard → orquestrador → planner → memória/context_builder → decisão/router → tool_guard → aprovação (quando exigida) → executor/runtime → validação/output_guard → resposta`

A ordem expressa o contrato pretendido, não uma implementação ativa. Entradas externas e resultados de ferramentas são dados não confiáveis. Toda chamada de ferramenta deve ser autorizada pelo guard no momento da execução; aprovação não pode ser inferida do texto do modelo. Operações de escrita externa, shell, administração ou destrutivas precisam de confirmação humana explícita, escopada e revogável.

## Papel dos módulos

- `core`: coordenação de alto nível e estado, sem lógica específica de provedor.
- `brain`: interface de modelo, templates versionados, decisões e montagem de contexto minimizado.
- `memory`: contratos separados por duração/escopo, sujeitos à política e isolamento.
- `tools`: contratos pequenos e explícitos; registro não concede autorização.
- `runtime`: abstrações para filas e execução isolada; não é sandbox funcional nesta versão.
- `security`: fonte de política, segredos, verificações, auditoria e limites.
- `integrations`: adaptadores de serviços de terceiros sem acoplamento ao core.
- `config`: esquemas e arquivos declarativos versionáveis sem credenciais.
- `observability`: sinais operacionais redigidos e sem conteúdo sensível.
- `interfaces`: entradas CLI/API/webhook (stubs) e `interfaces/web`, que serve a tela de entrada e a API JSON `/api/auth/*` (Starlette/ASGI, CSP sem origens externas, verificação de `Origin`).
- `auth`: contas próprias por e-mail e senha — validação, armazenamento SQLite, sessões opacas, links de uso único e regras anti-enumeração. Depende de `security` (Argon2id, limites de taxa, segredos) e de `integrations/email` apenas por contratos.

## Fronteiras de confiança

1. Usuário, conteúdo importado, páginas, e-mail, arquivos, memória recuperada e saídas do modelo são não confiáveis.
2. O modelo pode propor ações, mas não atribui permissões nem aprova ações.
3. `tool_guard` deve validar identidade, escopo, schema, permissões, política e aprovação antes de delegar.
4. Adaptadores externos recebem credenciais somente por acesso mediado ao módulo de segredos; devem receber escopos mínimos.
5. Workspace, rede e processos são fronteiras de isolamento. Política de egress deve ser explícita e restrita.
6. Auditoria registra metadados seguros, nunca payloads sensíveis ou segredos.

## Ciclo de vida

1. Criar identificadores de usuário, sessão e tarefa e estabelecer limite de duração/recursos.
2. Validar e classificar a entrada; preservar separação entre instruções e material citado/externo.
3. Planejar passos e declarar dependências/permissões solicitadas.
4. Recuperar memória autorizada no escopo correto e montar contexto com limite explícito.
5. Selecionar fluxo/ferramenta a partir de contratos claros.
6. Autorizar novamente cada execução; pedir aprovação para efeitos relevantes.
7. Executar com isolamento e limites de tempo, rede, arquivos e recursos.
8. Validar resultado e sanitizar a resposta; registrar somente auditoria redigida.
9. Persistir apenas dados permitidos pela política; aplicar expiração e exclusão.

## Multiagente futuro

Agentes especializados devem ser adicionados somente após medir benefício. O orquestrador atribui tarefas limitadas, permissões próprias e contexto mínimo; cada worker devolve resultado estruturado e referências/proveniência, não acesso implícito ao estado do outro. Workers não herdam segredos, memória privada ou aprovação. O orquestrador valida resultados e toda chamada externa segue os mesmos guards. Paralelismo, orçamento e limites de delegação devem ser explícitos para evitar loops e custos sem controle.

## Referências

A arquitetura adota princípios públicos de sistemas composáveis, ferramentas bem delimitadas, contexto curado e evolução incremental. Ver fontes no README. Nada aqui descreve detalhes internos proprietários de Claude.
