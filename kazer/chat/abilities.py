# ruff: noqa: E501 - catálogo de texto: uma habilidade por entrada, linhas longas de propósito
"""Habilidades embutidas do KAZER: mais de 100 modos de trabalho que ligam sozinhos.

Cada habilidade tem palavras que a ativam e um roteiro curto de como responder
bem naquele tipo de pedido. Para cada mensagem, o KAZER escolhe as duas que mais
combinam e as coloca nas instruções — sem a pessoa precisar instalar nada.

As categorias seguem as de catálogos públicos de prompts e skills para agentes
(f/prompts.chat, ComposioHQ/awesome-claude-skills,
gamedev-skills/awesome-gamedev-agent-skills, bergside/awesome-design-skills,
sickn33/agentic-awesome-skills); o texto de cada uma foi escrito para o KAZER.
São instruções da equipe (confiáveis) e não mudam as regras do sistema.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Ability:
    slug: str
    name: str
    triggers: tuple[str, ...]
    how: str


def _a(slug: str, name: str, triggers: str, how: str) -> Ability:
    return Ability(slug, name, tuple(t.strip() for t in triggers.split("|") if t.strip()), how)


ABILITIES: tuple[Ability, ...] = (
    # ---------- Programação ----------
    _a("revisao-codigo", "Revisão de código", "revis|review|pull request|diff|code review",
       "Leia tudo antes. Liste problemas por gravidade (bug, segurança, erro não tratado,"
       " desempenho, legibilidade) citando a função/linha, com a correção em código. Diga o"
       " que está bom no fim."),
    _a("depuracao", "Depuração", "erro|error|bug|exception|traceback|nao funciona|quebrou|crash|stack",
       "Leia a mensagem de erro com atenção, diga a causa mais provável e por quê, depois a"
       " correção exata. Se houver mais de uma hipótese, ordene da mais provável e diga como"
       " confirmar cada uma (o que imprimir/rodar)."),
    _a("refatoracao", "Refatoração", "refator|limpar o codigo|clean code|melhorar o codigo|duplica",
       "Mantenha o comportamento idêntico. Mostre o arquivo inteiro refatorado, explique cada"
       " mudança em uma linha e aponte riscos. Não troque bibliotecas sem pedir."),
    _a("testes", "Testes automatizados", "teste|test|pytest|jest|vitest|unittest|cobertura|tdd",
       "Cubra caminho feliz, bordas e erros. Use o framework do projeto, nomes que descrevem"
       " o comportamento e arrange/act/assert. Diga como rodar."),
    _a("documentacao", "Documentação e README", "readme|documenta|docstring|jsdoc|wiki",
       "README com: o que é, por que existe, instalação, uso com exemplo real, configuração,"
       " e como contribuir. Exemplos copiáveis e testados mentalmente."),
    _a("explicar-codigo", "Explicar código", "explica esse codigo|o que esse codigo faz|entender o codigo",
       "Explique de cima para baixo: propósito em uma frase, fluxo principal, depois os"
       " trechos difíceis. Use comentários no próprio código quando ajudar."),
    _a("regex", "Expressões regulares", "regex|expressao regular|regular expression",
       "Entregue a regex, explique cada parte numa tabela, dê exemplos que casam e que não"
       " casam, e avise sobre diferenças entre linguagens."),
    _a("sql", "SQL e bancos", "sql|query|consulta no banco|postgres|mysql|sqlite|join|indice",
       "Escreva SQL legível (uma cláusula por linha), explique o plano, sugira índices e"
       " cuidado com N+1 e injeção (use parâmetros)."),
    _a("performance", "Desempenho", "lento|performance|otimiz|demora|memoria|gargalo|benchmark",
       "Meça antes de otimizar: diga como medir. Ataque o maior gargalo primeiro, mostre o"
       " antes/depois e a complexidade."),
    _a("seguranca-web", "Segurança de aplicações", "seguranca|xss|csrf|sql injection|owasp|vulnerab|autentica",
       "Use o OWASP Top 10 como guia. Para cada risco: como explora, impacto, correção em"
       " código. Nunca ensine a atacar sistemas de terceiros sem autorização."),
    _a("api-rest", "Design de API", "api|endpoint|rest|graphql|openapi|swagger",
       "Recursos no plural, verbos HTTP certos, códigos de status corretos, paginação,"
       " versionamento e erros com formato consistente. Mostre exemplos de request/response."),
    _a("git", "Git e commits", "git|commit|merge|rebase|branch|conflito",
       "Dê os comandos exatos na ordem, explique o que cada um faz e como desfazer se der"
       " errado. Mensagens de commit no imperativo e curtas."),
    _a("docker", "Docker e containers", "docker|dockerfile|compose|container|kubernetes|k8s",
       "Imagens pequenas (multi-stage, slim), usuário não-root, cache de camadas, .dockerignore"
       " e healthcheck. Mostre como subir e testar."),
    _a("ci-cd", "CI/CD", "github actions|ci|cd|pipeline|deploy|workflow",
       "Pipeline com lint, testes e build em etapas, cache de dependências e segredos nas"
       " variáveis do provedor. YAML completo e comentado."),
    _a("typescript", "TypeScript", "typescript|tipagem|tipos|generics|tsconfig",
       "Tipos precisos (sem any), generics quando reduzem repetição, unions discriminadas e"
       " tsconfig estrito."),
    _a("react", "React e front-end", "react|next|componente|hook|useeffect|jsx|tsx|vite",
       "Componentes pequenos, estado no lugar certo, efeitos só quando preciso, acessível e"
       " responsivo. Entregue componentes completos."),
    _a("python", "Python", "python|pip|django|flask|fastapi|pandas|script em python",
       "Código idiomático (PEP 8), type hints, tratamento de erro claro e if __name__ =="
       " '__main__'. Liste dependências e como rodar."),
    _a("node", "Node.js", "node|express|npm|nestjs|bun|deno",
       "Async/await, validação de entrada, tratamento de erro central e variáveis de"
       " ambiente para segredos. package.json com scripts."),
    _a("modelagem-dados", "Modelagem de dados", "modelagem|tabelas|schema|diagrama er|normaliza",
       "Entidades, relacionamentos e chaves com um diagrama erDiagram em mermaid, depois o"
       " SQL de criação com restrições."),
    _a("algoritmos", "Algoritmos", "algoritmo|estrutura de dados|ordenacao|grafo|arvore|recursao|dinamica",
       "Explique a ideia com um exemplo pequeno, depois o código, a complexidade (tempo e"
       " espaço) e casos de borda."),
    _a("entrevista-tecnica", "Entrevista técnica", "entrevista tecnica|leetcode|system design interview|vaga de dev",
       "Simule como entrevistador: pergunte, espere a resposta e dê feedback honesto. Em"
       " soluções, mostre a ingênua e a ótima."),
    _a("shell", "Terminal e scripts", "bash|shell|terminal|linux|powershell|comando",
       "Comandos testáveis, com explicação de cada flag, e aviso antes de qualquer coisa"
       " destrutiva (rm -rf, sudo)."),
    _a("migracao", "Migração de versão", "migrar|atualizar versao|upgrade|deprecated|breaking change",
       "Pesquise o guia oficial de migração, liste as mudanças que quebram, a ordem segura"
       " de passos e como testar cada um."),
    _a("css-layout", "CSS e layout", "css|layout|flexbox|grid|responsiv|tailwind|centralizar",
       "Mobile-first, grid/flex conforme o caso, variáveis de cor e espaçamento, e foco"
       " visível. Mostre o resultado com prévia em HTML."),
    _a("mobile", "Apps mobile", "flutter|react native|android|ios|kotlin|swift|app mobile",
       "Arquitetura simples, estados de carregando/erro/vazio, toque com área mínima de 44px"
       " e como testar no aparelho."),
    _a("arquitetura", "Arquitetura de software", "arquitetura|microservi|monolito|escalar|clean architecture|ddd",
       "Comece pelo problema e pelas restrições. Compare 2 ou 3 opções numa tabela"
       " (custo, complexidade, escala) e recomende uma com diagrama mermaid."),
    _a("observabilidade", "Logs e monitoramento", "log|monitor|observabil|metricas|tracing|sentry",
       "Logs estruturados sem dados sensíveis, métricas que respondem perguntas reais e"
       " alertas acionáveis."),
    _a("automacao", "Automação", "automatiz|cron|agendar|bot|rotina automatica|zapier",
       "Desenhe o fluxo (gatilho → passos → saída), trate falhas e repetição, e entregue o"
       " script pronto com instruções de agendamento."),
    _a("scraping", "Coleta de dados da web", "scraping|raspar|crawler|extrair dados de site",
       "Prefira APIs oficiais. Respeite robots.txt e termos de uso, limite a taxa e trate"
       " mudanças de HTML."),
    _a("prompt-engineering", "Engenharia de prompt", "prompt|llm|chatgpt|gpt|ia generativa|agente de ia",
       "Papel claro, contexto, formato de saída, exemplos e critérios de qualidade. Mostre o"
       " prompt final num bloco de código."),
    _a("rust-go", "Rust, Go e sistemas", "rust|cargo|golang|go mod|ponteiro|concorrencia|thread",
       "Siga o idioma da linguagem (ownership em Rust, goroutines e erros explícitos em Go),"
       " explique as decisões de concorrência."),
    _a("java-csharp", "Java e C#", "java|spring|kotlin|c#|dotnet|\\.net",
       "Estrutura por camadas, injeção de dependência, testes e build (maven/gradle/dotnet)"
       " com os comandos exatos."),

    # ---------- Jogos ----------
    _a("game-design", "Design de jogos", "game design|gdd|ideia de jogo|mecanica|jogo viral|gameplay",
       "Defina o loop principal em uma frase, o que torna o jogo único, progressão e"
       " recompensa. Proponha um protótipo jogável em HTML para testar a ideia."),
    _a("jogo-html", "Jogo no navegador", "jogo|game|canvas|phaser|joguinho",
       "Um único HTML completo: menu inicial, pontuação, recorde salvo no localStorage,"
       " reinício, teclado e toque, som opcional e visual caprichado. Teste mentalmente o"
       " loop e as colisões."),
    _a("godot", "Godot 4", "godot|gdscript|tscn",
       "GDScript 2 de Godot 4 (sinais com .connect, @export, CharacterBody2D com"
       " move_and_slide). Projeto completo em pastas, com cenas .tscn válidas e README."),
    _a("threejs", "3D no navegador", "three\\.js|threejs|3d no navegador|webgl",
       "three.js por CDN com import map, cena + câmera + luz + controles, animação com"
       " requestAnimationFrame e redimensionamento."),
    _a("balanceamento", "Balanceamento", "balancear|balanceamento|dificuldade|economia do jogo|xp",
       "Use tabelas e curvas (linear, exponencial) com números, explique a sensação que cada"
       " curva cria e como ajustar testando."),
    _a("level-design", "Level design", "fase|nivel|level design|mapa do jogo",
       "Ensine uma mecânica por vez, ritmo de tensão e alívio, recompensas visíveis e"
       " caminhos opcionais."),
    _a("pixel-art", "Arte de jogo", "pixel art|sprite|paleta do jogo|arte do jogo|tileset",
       "Paleta limitada com hex, tamanhos de sprite coerentes e dicas de animação. Se der,"
       " desenhe com canvas no HTML."),
    _a("ia-inimigos", "IA de inimigos", "inimigo|ia do jogo|pathfinding|a\\*|maquina de estados",
       "Máquina de estados (patrulha, persegue, ataca, foge) com código e diagrama"
       " stateDiagram em mermaid."),
    _a("narrativa-jogo", "Narrativa de jogo", "historia do jogo|lore|personagem do jogo|roteiro do jogo",
       "Premissa forte, conflito, personagens com desejo e medo, e como a história aparece"
       " pela jogabilidade."),
    _a("fisica-jogo", "Física de jogo", "fisica do jogo|gravidade|pulo|colisao|velocidade",
       "Integre com delta time, separe física e render, e ajuste pulo com coyote time e"
       " buffer de input."),

    # ---------- Design ----------
    _a("critica-ui", "Crítica de interface", "interface|tela|ui|ux|layout do app|usabilidade",
       "Avalie objetivo, hierarquia, texto, contraste, espaçamento, estados e celular. Para"
       " cada problema, a mudança concreta."),
    _a("paleta", "Cores", "paleta|cores|cor da marca|esquema de cores",
       "Paleta com hex, papel de cada cor (fundo, texto, destaque, erro) e contraste AA"
       " verificado. Mostre uma prévia em HTML."),
    _a("tipografia", "Tipografia", "fonte|tipografia|typography",
       "Par de fontes com motivo, escala de tamanhos, altura de linha e uso de peso."),
    _a("landing-page", "Landing page", "landing page|pagina de vendas|site institucional|pagina inicial",
       "Hero com promessa clara, prova, benefícios, objeções, chamada para ação. Um HTML"
       " completo, responsivo e com prévia."),
    _a("ux-writing", "Textos de interface", "microcopy|ux writing|texto do botao|mensagem de erro",
       "Verbos de ação, frases curtas, erro diz o que houve e como resolver, sem jargão."),
    _a("design-system", "Design system", "design system|componentes|tokens|guia de estilo",
       "Tokens (cor, espaço, raio, tipo), componentes base com estados e regras de uso."),
    _a("wireframe", "Wireframe", "wireframe|prototipo|rascunho de tela|mockup",
       "Estrutura antes do visual: blocos, hierarquia e fluxo; entregue em HTML simples com"
       " prévia."),
    _a("logo", "Marca e logo", "logo|marca|branding|identidade visual",
       "Briefing (público, valores, concorrentes), 3 direções conceituais e um SVG simples"
       " de cada quando possível."),

    # ---------- Escrita ----------
    _a("email", "E-mail", "e-mail|email|responder cliente|escrever para",
       "Assunto claro, primeira linha com o ponto, contexto curto, pedido explícito e"
       " assinatura. Ofereça versão formal e direta."),
    _a("resumo", "Resumo", "resum|sintetiz|tl;dr|principais pontos",
       "Comece pela conclusão, depois 3 a 7 pontos e o que fazer com isso. Fiel ao original."),
    _a("revisao-texto", "Revisão de texto", "revisar texto|corrigir|gramatica|ortografia|portugues correto",
       "Corrija mantendo a voz do autor. Mostre o texto corrigido e uma lista curta do que"
       " mudou e por quê."),
    _a("tom", "Reescrever no tom certo", "reescrev|mais formal|mais informal|tom|parafrase",
       "Reescreva no tom pedido sem perder o conteúdo; ofereça 2 versões quando o tom for"
       " ambíguo."),
    _a("linkedin", "Posts para redes", "linkedin|post|instagram|legenda|twitter|thread|tiktok",
       "Gancho na primeira linha, uma ideia por post, frases curtas, prova concreta e um"
       " fechamento que convida a comentar. Sem hashtags em excesso."),
    _a("roteiro", "Roteiro de vídeo", "roteiro|script de video|youtube|reels|podcast",
       "Gancho nos 3 primeiros segundos, estrutura em blocos com tempo estimado, falas e"
       " indicação de imagem."),
    _a("artigo-seo", "Artigo e SEO", "artigo|blog|seo|palavra-chave|post de blog",
       "Intenção de busca, título com a palavra-chave, intertítulos, respostas diretas,"
       " exemplos e meta description."),
    _a("copy", "Copy de vendas", "copy|vender|anuncio|chamada|headline|persuas",
       "Público e dor, promessa específica, prova, oferta e chamada clara. Sem promessas"
       " falsas."),
    _a("storytelling", "Histórias", "historia|conto|narrativa|storytelling|ficcao|cronica",
       "Personagem com desejo, obstáculo, virada e fim que muda algo. Mostre, não explique."),
    _a("traducao", "Tradução", "tradu|translate|em ingles|em espanhol|para o ingles",
       "Traduza o sentido, não palavra por palavra; mantenha termos técnicos e explique"
       " escolhas difíceis."),
    _a("ata", "Atas e reuniões", "ata|reuniao|pauta|meeting notes",
       "Decisões, responsáveis, prazos e pendências numa tabela, em cima de tudo."),
    _a("curriculo", "Currículo e carta", "curriculo|cv|carta de apresentacao|linkedin perfil|vaga",
       "Resultados com números, verbos de ação, adaptado à vaga. Ofereça gerar em PDF."),
    _a("discurso", "Discurso e apresentação oral", "discurso|apresentacao oral|falar em publico|pitch oral",
       "Abertura que prende, 3 ideias, histórias curtas e fechamento memorável, com tempo"
       " estimado."),

    # ---------- Estudo ----------
    _a("professor", "Explicar como professor", "explica|o que e|como funciona|me ensina|nao entendi|entender",
       "Intuição com analogia, depois o detalhe, um exemplo concreto e uma pergunta para"
       " checar o entendimento. Use imagens (buscar_imagens) e diagramas quando ajudar."),
    _a("plano-estudos", "Plano de estudos", "plano de estudo|cronograma de estudo|estudar para|vestibular|concurso",
       "Plano semanal realista com metas, revisão espaçada e simulados; tabela com dias."),
    _a("flashcards", "Flashcards e quiz", "flashcard|quiz|perguntas e respostas|questoes|simulado",
       "Perguntas que testam entendimento (não decoreba), com gabarito comentado no fim."),
    _a("mapa-mental", "Mapa mental", "mapa mental|mindmap|esquema",
       "Mapa em mermaid mindmap com a ideia central e ramos de no máximo 5 palavras."),
    _a("matematica", "Matemática passo a passo", "matematica|equacao|calcul|derivada|integral|porcentagem|juros",
       "Resolva passo a passo, um passo por linha, e confira o resultado com a ferramenta"
       " calcular."),
    _a("ciencias", "Física, química e biologia", "fisica|quimica|biologia|celula|atomo|reacao|energia",
       "Conceito, fórmula com unidades, exemplo resolvido e uma imagem ou diagrama."),
    _a("historia", "História e linha do tempo", "historia do|guerra|imperio|seculo|revolucao|linha do tempo",
       "Contexto, causas, acontecimentos e consequências; linha do tempo em mermaid timeline."),
    _a("redacao", "Redação ENEM", "redacao|enem|dissertativ|argumentativ",
       "Estrutura: introdução com tese, dois argumentos com repertório, conclusão com"
       " proposta de intervenção completa (agente, ação, meio, finalidade, detalhamento)."),
    _a("idiomas", "Aprender idiomas", "aprender ingles|praticar ingles|idioma|conversacao|vocabulario",
       "Converse no idioma, corrija com gentileza mostrando a forma certa e explique uma"
       " regra por vez."),
    _a("livro", "Resumo de livros", "livro|resumo do livro|obra|autor",
       "Ideia central, principais argumentos, citações marcantes (só se tiver certeza) e"
       " como aplicar."),

    # ---------- Dados e negócios ----------
    _a("planilha", "Planilhas e Excel", "planilha|excel|google sheets|formula|procv|xlookup|tabela dinamica",
       "Fórmula exata (com ; para Excel em português), explicação de cada parte e exemplo"
       " com dados."),
    _a("analise-dados", "Análise de dados", "analise de dados|dados|dataset|csv|estatistica|grafico",
       "Pergunta, limpeza, análise, gráfico e conclusão. Código em pandas quando houver"
       " dados; tabelas para resultados."),
    _a("plano-negocios", "Plano de negócios", "plano de negocio|empreender|startup|abrir empresa|modelo de negocio",
       "Problema, cliente, solução, concorrência, modelo de receita, custos e metas em"
       " tabela; riscos honestos."),
    _a("pitch", "Pitch para investidor", "pitch|investidor|captar|deck de investimento",
       "Problema, solução, mercado, tração, modelo, time, pedido. Ofereça gerar os slides."),
    _a("swot", "Análise estratégica", "swot|fofa|estrategia|concorrente|posicionamento",
       "Matriz em tabela e 3 ações priorizadas a partir dela."),
    _a("precificacao", "Preço", "preco|precificar|quanto cobrar|margem|markup",
       "Custos, valor percebido, concorrência e margem; mostre o cálculo e 3 faixas de"
       " preço."),
    _a("okr", "Metas e OKRs", "okr|meta|kpi|indicador",
       "Objetivo inspirador e 3 resultados-chave mensuráveis com prazo."),
    _a("financas", "Finanças pessoais", "financas|dinheiro|investir|orcamento|divida|poupar|salario",
       "Organize em entradas, gastos fixos e variáveis; sugira metas. Informativo, não é"
       " recomendação de investimento."),
    _a("marketing", "Marketing digital", "marketing|trafego|campanha|funil|leads|ads",
       "Público, canal, mensagem, oferta e métrica de sucesso; plano em etapas com"
       " orçamento."),
    _a("juridico", "Documentos simples", "contrato|clausula|termo de uso|politica de privacidade|lgpd",
       "Modelo claro e organizado, com aviso de que não substitui um advogado."),
    _a("produto", "Gestão de produto", "produto|roadmap|user story|backlog|requisito|prd",
       "Problema do usuário, critérios de aceite, prioridade (impacto x esforço) e métricas."),
    _a("atendimento", "Atendimento ao cliente", "cliente reclam|atendimento|suporte|sac",
       "Acolha, assuma o que é seu, resolva com passos claros e confirme o próximo contato."),

    # ---------- Pesquisa ----------
    _a("comparar", "Comparar opções", "comparar|comparacao|qual e melhor|vs|versus|diferenca entre",
       "Tabela com critérios que importam para o caso da pessoa, depois uma recomendação"
       " clara com o porquê. Pesquise dados atuais."),
    _a("checagem", "Checagem de fatos", "e verdade|fake|boato|checar|fonte disso",
       "Pesquise fontes confiáveis, diga o veredito (verdadeiro, falso, enganoso, sem"
       " provas) e mostre as fontes."),
    _a("noticias", "Notícias e atualidades", "noticia|hoje|ultimas|aconteceu|atual|lancamento",
       "Pesquise antes de responder, com datas e fontes; separe fato de opinião."),
    _a("academico", "Pesquisa acadêmica", "artigo cientifico|paper|tcc|monografia|referencia|abnt",
       "Busque artigos (artigos_cientificos), resuma métodos e resultados, e formate"
       " referências no padrão pedido."),
    _a("compras", "Ajuda para comprar", "comprar|qual celular|qual notebook|vale a pena|custo beneficio",
       "Pergunte orçamento e uso se faltar; compare 3 opções atuais com prós e contras."),

    # ---------- Vida e produtividade ----------
    _a("planejamento", "Planejamento", "planejar|organizar|rotina|agenda|produtividade|prioridade",
       "Liste tarefas, priorize (urgente x importante) e monte um plano com horários."),
    _a("receita", "Culinária", "receita|cozinhar|ingrediente|jantar|almoco|bolo",
       "Ingredientes com quantidades, passos numerados, tempo e dicas de substituição."),
    _a("treino", "Exercícios", "treino|academia|exercicio|musculacao|corrida|alongamento",
       "Plano por nível com séries, repetições e descanso; avise para procurar um"
       " profissional em caso de dor ou condição de saúde."),
    _a("viagem", "Roteiro de viagem", "viagem|roteiro|viajar|turismo|ferias|hotel",
       "Roteiro por dia com deslocamentos realistas, custos estimados e dicas locais;"
       " pesquise informações atuais."),
    _a("decisao", "Tomar decisões", "decidir|devo|pros e contras|duvida entre|escolher",
       "Esclareça o objetivo, liste opções com prós, contras e riscos, e recomende."),
    _a("brainstorm", "Ideias", "ideia|brainstorm|sugest|criativ|nomes para",
       "Gere muitas ideias variadas (do óbvio ao ousado), agrupe e destaque as 3 melhores"
       " com o motivo."),
    _a("conversa-dificil", "Conversas difíceis", "conversa dificil|briga|conflito|como falar com|negociar",
       "Ajude a preparar: objetivo, o que dizer (frases prontas), como ouvir e como lidar"
       " com reações."),
    _a("saude-mental", "Acolhimento", "ansiedade|triste|depressao|estresse|sozinho|nao aguento",
       "Acolha com calma e sem julgamento, ofereça passos pequenos e, em risco, indique o"
       " CVV (188) e ajuda profissional."),
    _a("presentes", "Presentes e eventos", "presente|aniversario|festa|evento|casamento",
       "Pergunte o essencial se faltar, sugira opções por faixa de preço e um toque pessoal."),
    # ---------- Mais técnicas ----------
    _a("machine-learning", "Machine learning", "machine learning|aprendizado de maquina|treinar modelo|pytorch|tensorflow|sklearn|rede neural",
       "Defina o problema (classificação, regressão...), dados, baseline simples, métrica certa e validação; código completo e como evitar vazamento de dados."),
    _a("nuvem", "Nuvem e deploy", "aws|gcp|azure|vercel|supabase|firebase|serverless|hospedar|deploy",
       "Passo a passo do deploy com comandos e telas a configurar, variáveis de ambiente, custos estimados e como reverter."),
    _a("servidor", "Servidores e redes", "servidor|vps|nginx|apache|ssl|https|dns|dominio|porta|firewall",
       "Configuração completa comentada, como testar cada parte e cuidados de segurança (portas, usuários, atualizações)."),
    _a("extensao", "Extensões de navegador", "extensao|chrome extension|manifest v3|addon",
       "Manifest V3 completo, permissões mínimas, arquivos separados por papel e como carregar sem empacotar."),
    _a("bots", "Bots de chat", "discord|telegram|bot do whatsapp|chatbot|slash command",
       "Use a biblioteca oficial, guarde o token em variável de ambiente, trate erros e mostre como registrar comandos."),
    _a("unity-unreal", "Unity e Unreal", "unity|unreal|c# unity|blueprint|monobehaviour",
       "Estrutura de cena, scripts com responsabilidades claras e passos no editor descritos clique a clique."),
    _a("acessibilidade", "Acessibilidade", "acessibilidade|a11y|leitor de tela|wcag|aria|daltonismo",
       "Siga o WCAG 2.2 AA: contraste, foco visível, rótulos, ordem de navegação e textos alternativos; mostre o código corrigido."),
    _a("aprender-programar", "Começar a programar", "aprender a programar|comecar a programar|por onde comecar|iniciante em programacao|roadmap",
       "Trilha por etapas com projetos pequenos e reais, recursos gratuitos e metas semanais; incentive sem prometer atalhos."),
    _a("carreira", "Carreira", "carreira|promocao|transicao de carreira|primeiro emprego|freela|freelancer",
       "Diagnóstico honesto, opções com prós e contras, plano de 90 dias e como mostrar resultados."),
    _a("eli5", "Explicar bem simples", "explica como se eu tivesse|bem simples|eli5|para uma crianca|leigo",
       "Explique com palavras do dia a dia e uma analogia concreta; sem jargão, frases curtas."),
    _a("humor", "Humor", "piada|meme|engracado|zoeira|trocadilho|humor",
       "Seja engraçado de verdade: timing, surpresa e referências que a pessoa entende; nunca ofensivo."),
    _a("poesia", "Poemas e letras", "poema|poesia|letra de musica|rima|soneto|rap",
       "Respeite a forma pedida (métrica, rima, refrão), imagens concretas e um final que fica na cabeça."),
)

BY_SLUG = {ability.slug: ability for ability in ABILITIES}


def _fold(text: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(ch) != "Mn"
    )


_PATTERNS = {
    ability.slug: re.compile("|".join(rf"\b{_fold(t)}" for t in ability.triggers))
    for ability in ABILITIES
}


def pick(question: str, limit: int = 2) -> list[Ability]:
    """As habilidades que mais combinam com o pedido (nenhuma se nada combinar)."""
    text = _fold(question[:4000])
    scored = []
    for ability in ABILITIES:
        hits = len(_PATTERNS[ability.slug].findall(text))
        if hits:
            scored.append((hits, ability))
    scored.sort(key=lambda item: -item[0])
    return [ability for _, ability in scored[:limit]]


def instructions(question: str) -> str:
    chosen = pick(question)
    if not chosen:
        return ""
    lines = [f"- {ability.name}: {ability.how}" for ability in chosen]
    return "Habilidades do KAZER para este pedido (use como roteiro):\n" + "\n".join(lines)
