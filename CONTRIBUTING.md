# Contribuindo com o KAZER

O KAZER é um projeto proprietário. Este arquivo descreve um processo de solicitação e revisão; **não concede licença para copiar, modificar, publicar fork, redistribuir ou explorar o código**. A licença padrão está em [`LICENSE.md`](LICENSE.md) e as regras de uso estão em [`docs/TERMOS-DE-USO.md`](docs/TERMOS-DE-USO.md).

## Antes de abrir uma contribuição

Não copie arquivos do KAZER para outro projeto, não publique um fork e não envie material de terceiros sem autorização. Para propor uma mudança, abra uma issue ou entre em contato com **klipzastudio@gmail.com** descrevendo o problema, o objetivo, o impacto, os arquivos envolvidos e a autorização existente, se houver.

Não inclua no issue, pull request, commit ou anexo senhas, tokens, chaves, certificados, dados pessoais, dados de produção, arquivos de clientes, prompts confidenciais ou provas de exploração. Vulnerabilidades devem ser comunicadas de forma responsável pelo canal indicado em [`SECURITY.md`](SECURITY.md), sem testes destrutivos.

## Regras de código

Toda alteração deve preservar autenticação server-side, RLS, validação de entradas, limites de payload, escaping de conteúdo, timeout de serviços externos, ausência de segredos e compatibilidade com os documentos públicos. Não adicione dependências sem justificar manutenção, licença, origem, versão, risco e necessidade.

Código novo deve ser pequeno, revisável e acompanhado de teste ou verificação adequada. Mudanças em limites, retenção, créditos, anexos, fornecedores, tratamento de dados, marca ou telas públicas exigem atualização simultânea do README, de `SECURITY.md` e dos documentos afetados.

## Titularidade de contribuições

Uma contribuição só será incorporada quando o titular do repositório aceitar expressamente a alteração e houver clareza suficiente sobre autoria, licença, direitos de uso e origem. O envio de um patch não transfere automaticamente direitos nem cria obrigação de incorporação.

Ao enviar material próprio para avaliação, declare que você possui os direitos necessários e que o material não viola contrato, confidencialidade, licença de terceiro ou direitos de outra pessoa. Se a mudança for aceita, o titular poderá pedir uma autorização escrita específica, cessão ou licença compatível antes do merge. Não assuma que a abertura de um pull request concede direitos sobre o projeto inteiro.

## Fluxo recomendado

| Etapa | Requisito |
|---:|---|
| 1 | Descrever o problema e o resultado esperado sem anexar segredos ou dados reais. |
| 2 | Receber autorização para preparar a alteração quando o solicitante não for o titular. |
| 3 | Criar uma branch privada de trabalho e manter `main` protegida. |
| 4 | Implementar a menor mudança possível, atualizar documentação e declarar dependências. |
| 5 | Executar `npm run security:check` e `npm run security:audit -- --audit-level=high`. |
| 6 | Revisar diffs, permissões, logs, headers, RLS e impacto em dados. |
| 7 | Obter aprovação do titular e registrar a decisão antes do merge. |

## Critérios de rejeição

Uma contribuição pode ser recusada quando contiver segredo, código de origem incerta, material sem licença compatível, dados pessoais desnecessários, bypass de segurança, alteração destrutiva de banco, dependência de alto risco, promessa comercial não implementada ou violação de direitos autorais, marca ou privacidade.

O titular pode editar, recusar, suspender ou remover uma contribuição para proteger o projeto. A aceitação de um patch não representa garantia de que ele é livre de falhas nem autorização para reutilizar os outros componentes do KAZER.

## Licença

As contribuições aceitas ficam sujeitas ao acordo escrito solicitado pelo titular e, na ausência de um acordo específico, não devem ser tratadas como uma licença open source do KAZER. Consulte o titular antes de presumir qualquer direito adicional.
