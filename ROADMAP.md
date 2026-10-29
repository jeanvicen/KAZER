# Roadmap inicial

Cada fase exige testes, revisão de segurança e critério de saída explícito. Nenhuma fase implica que os recursos já estejam implementados.

1. **Núcleo, configuração, logging e CLI** — contratos, estado, configuração validada, logging redigido, CLI mínima. Critério: fluxo controlado testável sem ferramentas externas.
2. **Memória e ferramentas básicas** — isolamento por escopo, política de retenção, conjunto mínimo de ferramentas somente leitura e avaliações repetíveis.
3. **Sandbox e execução de código** — isolamento descartável, limites de recursos/rede/arquivos, testes adversariais e aprovação humana.
4. **Integrações** — uma integração por vez, escopos mínimos, revogação, limites de taxa e testes com dados sintéticos.
5. **Multiagente** — apenas se avaliações mostrarem ganho; delegação limitada, contexto mínimo, orçamento e auditabilidade.
6. **Autonomia com aprovação humana** — autonomia gradual, autorização por ação, checkpoints, cancelamento e rollback quando viável.
7. **Painéis e interfaces** — somente depois de o núcleo estar maduro. Exceções aprovadas: a tela de entrada com autenticação própria e o chat principal (KAZ 1.1 mapeado para um provedor configurável, histórico por conta, anexos, memória escrita pela pessoa, configurações, exportação e exclusão de conta, tela offline) foram antecipados. Pendentes: banco persistente para a Vercel, escolha e identificação do provedor de modelo, pesquisa em várias etapas, conectores e voz (hoje marcados como indisponíveis na interface); os documentos legais aguardam a identificação do controlador e revisão jurídica.
