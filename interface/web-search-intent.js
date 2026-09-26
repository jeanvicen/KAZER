(function attachKazerSearchIntent(root, factory) {
  const api = factory();
  if (root) root.KazerSearchIntent = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createKazerSearchIntent() {
  const normalize = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const isSearchOptOut = (value) => {
    const text = normalize(value);
    return /\b(?:nao|nunca|sem)\s+(?:(?:(?:quero|preciso|precisa|posso|devo|deve|tem que|e necessario|e preciso)\s+(?:que\s+)?(?:voce\s+)?)?)(?:pesquise|pesquisar|pesquisa|busque|buscar|busca|procure|procurar|investigue|investigar)\b/.test(text)
      || /\bnao\s+(?:e|seria)\s+(?:necessario|preciso)\s+(?:que\s+)?(?:voce\s+)?(?:pesquise|pesquisar|busque|buscar|procure|procurar|investigue)\b/.test(text)
      || /\b(?:nao|nunca|sem)\s+(?:(?:quero|preciso|devo|posso)\s+)?(?:consulte|consultar|acesse|acessar|use|usar|abra|abrir|recorra|recorrer)\s+(?:(?:a|na|no|pela|pelo)\s+)?(?:web|internet|google)\b/.test(text)
      || /\b(?:nao|nunca|sem)\s+(?:(?:quero|preciso|devo|posso)\s+)?(?:faca|realize|conduza)\s+(?:uma\s+)?(?:pesquisa|busca)\b/.test(text);
  };

  const isWebResearchRequest = (value) => {
    const text = normalize(value);
    if (!text || isSearchOptOut(text)) return false;

    const searchAction = "(?:pesquise|pesquisar|busque|buscar|busca|procure|procurar|procura|investigue|investigar|investiga|encontre|encontrar|ache|achar|acha|localize|localizar)";
    const explicitSearch = new RegExp(`^(?:por favor[,;:]?\\s*)?(?:(?:voce|vc|eu)\\s+)?(?:(?:pode|poderia|consegue|quero|preciso|gostaria|tente|tenta)\\s+)?(?:(?:me\\s+)?${searchAction})\\b`).test(text)
      || /^(?:por favor[,;:]?\s*)?(?:me ajuda(?:r)?\s+(?:a\s+)?|ajude(?:-me)?\s+a\s+)(?:pesquisar|buscar|procurar|investigar|encontrar|achar)\b/.test(text)
      || /\b(?:faca|realize|conduza)\s+(?:uma\s+)?(?:pesquisa|busca)\b/.test(text)
      || /\b(?:pesquisa|busca)\s+(?:sobre|na|no|por)\s+(?:web|internet|google|fontes|informacoes|dados|artigos|noticias|estudos)\b/.test(text);
    if (explicitSearch) return true;

    const explanatory = /^(?:como\s+(?:funciona|fazer|se faz)|o que\s+(?:significa|e)|defina|explique|me ensine|por que)\b/.test(text);
    if (explanatory) return false;

    const freshnessCue = /\b(?:hoje|agora|atualmente|atual|atualizado|atualizada|recente|recentes|ultimo|ultima|ultimos|ultimas|amanha|ontem|deste ano|este ano|ano atual|nesse momento|neste momento|essa semana|esta semana|este mes|em 20\d{2}|latest|today|tomorrow|right now|currently|current|recent|this week|this year)\b/.test(text);
    const dynamicTopic = /\b(?:tempo|clima|previsao|temperatura|cotacao|dolar|euro|cambio|bitcoin|cripto|bolsa|acoes|preco|valor|custa|noticia|noticias|novidade|lancamento|versao|atualizacao|placar|resultado|jogo|partida|campeonato|classificacao|evento|show|oscar|premio|campeao|ganhador|lanca|estreia|comeca|agenda|horario|aberto|aberta|funcionamento|abre|abertura|fecha|fechado|estoque|disponibilidade|passagem|passagens|voo|voos|hotel|restaurante|cafeteria|bar|vaga|vagas|emprego|salario|presidente|prefeito|governador|ministro|ceo|eleicao|lei|imposto|fora do ar|indisponivel|celular|iphone|notebook|laptop|tablet|console|placa de video|melhor|mais barato|vale a pena|versus|\bvs\b|weather|forecast|temperature|dollar|exchange|price|news|release|version|score|game|opening hours|availability|job|president|mayor)\b/.test(text);
    const asksForLookup = /\?|^\s*(?:quem|qual|quais|quanto|quantos|quantas|quando|onde|tem|existe|esta|estao|sai|lancou|ganhou|vale|custa|custam|me diz|me diga|me fala|me fale|me mostra|me mostre|me recomenda|compare|compara|lista|quero saber|que horas)\b/.test(text);
    const currentWeatherQuestion = /^(?:como|qual)\b/.test(text) && /\b(?:tempo|clima|previsao|temperatura)\b/.test(text);
    const implicitCurrentSubject = freshnessCue && dynamicTopic && text.length <= 180;
    const implicitLookup = /^\s*(?:preco|cotacao|noticias|horario|clima|previsao|placar|resultado|versao atual|lancamento|melhores?|mais barato|vagas|passagens|voos)\b/.test(text);

    return (asksForLookup && (freshnessCue || dynamicTopic)) || implicitCurrentSubject || implicitLookup || currentWeatherQuestion;
  };

  const isResearchFollowUp = (value, previousUserMessage) => {
    const current = normalize(value);
    const previous = String(previousUserMessage || "").trim();
    if (!current || !previous || isSearchOptOut(current) || current.length > 150) return false;
    if (!isWebResearchRequest(previous)) return false;
    return /^(?:e\s+|mas\s+|entao\s+|no\s+|na\s+|em\s+|para\s+|com\s+|sobre\s+|quanto\s+a\s+|qual\s+|quais\s+|e\s+se\s+|e\s+quanto\s+)/.test(current)
      || /^(?:e\s+)?(?:no|na|em|para)\s+[a-z0-9]/.test(current);
  };

  const buildResearchQuery = (value, previousUserMessage = "") => {
    const current = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    const previous = String(previousUserMessage || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!previous || !isResearchFollowUp(current, previous)) return current.slice(0, 240);
    const continuation = current.replace(/^(?:e\s+quanto\s+a|quanto\s+a|e\s+se|e|mas|entao)\s+/i, "").trim();
    return `${previous.slice(0, 165)} ${continuation.slice(0, 70)}`.replace(/\s+/g, " ").trim().slice(0, 240);
  };

  return Object.freeze({ isSearchOptOut, isWebResearchRequest, isResearchFollowUp, buildResearchQuery });
});
