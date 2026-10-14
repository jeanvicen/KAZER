# Memória local do KAZER

## Estado e limites

O módulo `interface/kazer-memory.js` mantém registros separados por ID da conta autenticada em IndexedDB e cifra cada conteúdo com AES-256-GCM via Web Crypto. A chave não exportável é guardada no próprio IndexedDB da conta para que o conteúdo continue disponível depois de fechar e reabrir a página. Os registros e a chave não são sincronizados com Supabase nem enviados a um serviço Mem0/OpenMemory. Isso protege o conteúdo em repouso contra leitura casual dos objetos do IndexedDB, mas não protege contra alguém que controle a sessão do navegador, execute código na origem, tenha acesso ao perfil do dispositivo ou comprometa o próprio browser.

A busca é executada no dispositivo por tokens normalizados, correspondência textual e expansão de um vocabulário pequeno de sinônimos. **Não usa embeddings nem busca vetorial de modelo.** Não leia automaticamente arquivos `memory.md`, `decisions.md` ou `tasks.md`: por restrição do navegador, a pessoa precisa selecionar explicitamente um arquivo em **Configurações → Memória → Importar/restaurar**. São aceitos JSON e Markdown exportados pelo KAZER.

A captura automática de preferências/fatos/tarefas e o resumo de conversas é local e usa regras simples; pode deixar passar itens ou classificar incorretamente textos. O usuário pode revisar, editar e apagar memórias em Configurações. O modo privado pausa recuperação contextual, compartilhamento com a IA e novas gravações, sem apagar registros existentes. Exportações são arquivos em texto legível e precisam ser guardadas com cuidado.

Por padrão, o compartilhamento contextual está desligado. Se a pessoa habilitar **Usar memórias nas respostas**, somente os trechos locais mais relevantes para a mensagem são acrescentados à mensagem enviada ao endpoint de IA remoto. O modo privado e a autorização são conferidos antes do contexto ser anexado. A mensagem pode então ser processada pelo provedor remoto do KAZER; portanto, armazenamento local não significa que o conteúdo permanece sempre no dispositivo quando essa autorização está ativa.

Este código ainda **não está confirmado em produção**. Uma alteração em branch/commit não prova deploy, funcionamento em todos os navegadores, proteção de dados em dispositivo comprometido ou compatibilidade de IndexedDB com todo ambiente. A implementação não integra o servidor Mem0/OpenMemory: na árvore atual de `mem0ai/mem0`, o caminho `openmemory/` não existe. O fork existente de Mem0 (`jeanvicen/mem0`) é independente e não é uma dependência do KAZER.

## Requisitos do navegador

- Navegador com IndexedDB e Web Crypto (`crypto.subtle`). Em publicação, use HTTPS; `localhost` também é considerado origem segura por navegadores comuns.
- Conta autenticada do KAZER. O identificador validado da conta define o namespace local.
- A memória é específica deste navegador/dispositivo. Limpar dados do site, perder o perfil/chave do navegador ou apagar a chave local pode tornar os registros irrecuperáveis. Use exportação para cópia de segurança.
- Sem IndexedDB ou Web Crypto, a memória local fica indisponível; o chat deve continuar funcionando sem contexto de memória.

## Desenvolvimento e testes

Na raiz do repositório, com Node.js 20+ e npm:

```bash
npm ci --ignore-scripts
npm test -- test/kazer-memory.test.mjs
```

Para toda a suíte e verificações já previstas no projeto:

```bash
npm test
npm run check
npm run integration:test
```

O teste específico usa Web Crypto do Node e um adaptador persistente simulado; cobre reinicialização de instância, isolamento entre IDs de conta, chave cifrada, busca local por paráfrase, JSON/Markdown, recusas de importação entre contas, opt-in desligado por padrão, modo privado, exclusão e extração com filtro básico de segredos. **Ele não executa um IndexedDB real, não é teste visual ou ponta a ponta do navegador, não valida Supabase/Vercel e não comprova deploy.** A validação do adapter real depende dos testes em navegador/CI.

Para usar o app completo em desenvolvimento, siga o documento principal [project-guide.md](project-guide.md): são necessários os passos de configuração do KAZER, Node/npm e os serviços já descritos ali. A memória, por si só, não requer tabela, migration, credencial de API nem variável de ambiente.
