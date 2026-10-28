# Política de segurança inicial

Este documento descreve controles obrigatórios e lacunas desta fundação. **Stubs não são controles implementados. Não use esta base para executar ações reais antes das revisões e implementações correspondentes.**

## Modelo de ameaças

Ativos: credenciais, dados de usuário, memória, workspace, código, serviços conectados e disponibilidade. Adversários/cenários: usuário malicioso, prompt injection em página/arquivo/e-mail, ferramenta comprometida, dependência vulnerável, abuso de credenciais, falha de isolamento, saída acidental de dados, execução de código hostil, negação de serviço e erro de configuração.

## Prompt injection e entradas

Conteúdo externo deve ser identificado como dado não confiável e nunca ganhar prioridade sobre políticas. `input_guard.py` é o ponto obrigatório para entradas e conteúdo recuperado; sua implementação futura precisa cobrir normalização, proveniência e classificação sem alegar que filtros textuais isolados resolvem prompt injection. Instruções em arquivos, páginas e resultados de ferramentas não autorizam ações. A política real deve ser aplicada fora do modelo.

## Segredos e exfiltração

- Apenas `security/secrets.py` pode ler fontes de credenciais. Nenhuma ferramenta lê variáveis diretamente.
- `tool_guard.py` medeia acesso a capacidades secretas; encaminhe credencial efêmera e escopada, nunca o conjunto completo.
- Não versionar `.env`, tokens, senhas, chaves, dumps nem credenciais em fixtures.
- `output_guard.py` e logger devem impedir exfiltração; redigir por padrão e evitar registrar corpo de requisições.
- Usar rotação, revogação, escopos mínimos e armazenamento seguro gerenciado em produção.

## Permissões mínimas e ações

Toda ferramenta declara apenas permissões necessárias entre `read`, `write`, `network`, `shell`, `filesystem` e `admin`. Registro/discovery não é autorização. Negar por padrão, verificar a cada chamada, validar parâmetros e limitar escopo por usuário/sessão/projeto. Escritas externas, exclusões, pagamentos, mensagens e outras ações irreversíveis ou de impacto exigem aprovação humana explícita, informada, limitada à ação e atualizada após qualquer mudança de parâmetros.

## Execução de código e sandbox

Código não confiável nunca executa no processo principal ou no host sem isolamento. A futura sandbox deve limitar filesystem, rede de saída, CPU, memória, processos e tempo; usar ambiente descartável e identidade sem privilégios; bloquear acesso ao socket/metadata/credenciais do host; e verificar resultados antes de devolvê-los. `runtime/sandbox.py` é apenas contrato nesta fase.

## Auditoria e observabilidade

Auditar quem/qual sessão pediu uma ação, ferramenta, permissões, decisão/aprovação, horário e resultado resumido. Não registrar segredos, tokens, conteúdo pessoal, prompt completo ou outputs sensíveis. Proteger integridade, retenção e acesso dos logs; redigir antes da persistência.

## Política de memória

Isolar por usuário, sessão e projeto, com autorização em toda leitura/escrita. Definir finalidade, minimização, proveniência, retenção/expiração, exclusão e tratamento de dados sensíveis. Memória recuperada é dado não confiável; nunca contém concessão de permissão. Não compartilhar entre usuários ou workers por padrão.

## Aprovação humana

A aprovação deve explicar a ação, alvo, dados, efeito e permissões; ser vinculada a uma chamada específica, expirar, permitir recusa e não ser reutilizável para outra ação. Em dúvida, falha de policy ou indisponibilidade do sistema de aprovação, bloquear.

## Resposta a incidentes e checklist antes de produção

Revogar credenciais, isolar execução afetada, preservar logs redigidos, investigar impacto e notificar conforme obrigações aplicáveis. Antes de habilitar ferramentas reais: revisão de threat model, testes adversariais, avaliação de prompt injection, sandbox validada, testes de isolamento multiusuário, política de rede/egress, redaction verificada, dependências auditadas e plano de rollback.
