"""Memória de longo prazo: o que pode ser guardado sozinho, sem duplicar e sem vazar.

Tudo aqui é determinístico (sem chamada de modelo): não gasta cota, não atrasa a
resposta e dá para testar frase por frase. O preço é a cobertura — só frases em
que a pessoa fala de si de forma direta viram memória. É de propósito: na
dúvida, o KAZER não guarda.

Quatro peças:

- `is_sensitive`: o que nunca entra sozinho (credenciais, documentos, saúde…).
- `extract`: frases da pessoa → candidatos (`Candidate`).
- `merge`: decide entre criar, atualizar a antiga ou ignorar (duplicata).
- `relevant`: escolhe as memórias que importam para a pergunta atual.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

MAX_AUTO_PER_MESSAGE = 2
MAX_SOURCE_CHARS = 1200
MAX_MEMORY_CHARS = 240
RELEVANT_LIMIT = 12


class MemoryLike(Protocol):
    id: str
    content: str
    created_at: int


@dataclass(frozen=True, slots=True)
class Candidate:
    """Algo que vale lembrar, já em frase curta na terceira pessoa."""

    content: str
    # Assunto único por conta ("nome", "trabalho", "cidade"): o novo troca o antigo.
    subject: str = ""
    confidence: float = 0.7


# ---------------------------------------------------------------------------
# Normalização
# ---------------------------------------------------------------------------

_STOP = frozenset(
    "a o as os um uma uns umas de da do das dos em no na nos nas para pra por com sem e ou que"
    " se eu me meu minha meus minhas voce você seu sua the of to and is in on for my i you it"
    " como mais muito ja já nao não sim ser estar ter isso essa esse este esta ao aos à às".split()
)


def normalize(text: str) -> str:
    """Minúsculas, sem acento e sem pontuação: base para comparar frases."""
    plain = unicodedata.normalize("NFKD", text.lower())
    plain = "".join(ch for ch in plain if not unicodedata.combining(ch))
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", plain).split())


def tokens(text: str) -> frozenset[str]:
    return frozenset(
        word for word in normalize(text).split() if word not in _STOP and len(word) > 1
    )


def similarity(a: str, b: str) -> float:
    """Jaccard das palavras que importam (0 a 1)."""
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


# ---------------------------------------------------------------------------
# Filtro de dado sensível
# ---------------------------------------------------------------------------

_SENSITIVE_PATTERNS = (
    r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b",  # CPF
    r"\b(?:\d[ -]?){13,19}\b",  # cartão
    r"\b\d{5,}\b",  # sequências longas (conta, RG, telefone, CEP)
    r"[\w.+-]+@[\w-]+\.[\w.-]+",  # e-mail
    r"\b(?:sk|pk|rk|ghp|gho|xox[abp]|AKIA|eyJ)[-_A-Za-z0-9]{8,}",  # chaves e tokens
    r"\b[A-Za-z0-9+/_-]{32,}\b",  # segredo com cara de token
    r"https?://",  # links não são fato sobre a pessoa
)
_SENSITIVE_WORDS = (
    "senha|password|passcode|token|api key|apikey|chave secreta|chave de api|secret|credencial"
    "|cartao|cvv|cpf|rg|cnh|passaporte|passport|conta bancaria|agencia bancaria|pix|iban"
    "|salario|divida"
    "|doenca|diagnostico|depressao|ansiedade|remedio|medicamento|hiv|cancer|gravida|terapia"
    "|psiquiatra|saude"
    "|religiao|evangelico|evangelica|catolico|catolica|ateu|umbanda|candomble"
    "|partido|politica|votei|voto em|lula|bolsonaro"
    "|gay|lesbica|bissexual|transgenero|sexualidade|orientacao sexual"
    "|endereco|rua|avenida|cep|apartamento"
    "|preso|processo judicial|antecedentes"
).split("|")
_INJECTION = re.compile(
    r"ignor[ea]|desconsider|instru[cç][oõ]es|system prompt|prompt do sistema"
    r"|regras? (?:do|de) sistema"
    r"|sempre obede|jailbreak|finja|aja como|act as|pretend|developer mode|modo desenvolvedor",
    re.I,
)
_SENSITIVE_RE = re.compile("|".join(_SENSITIVE_PATTERNS))
_SENSITIVE_WORD_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(word) for word in _SENSITIVE_WORDS) + r")\b"
)


def is_sensitive(text: str) -> bool:
    """True para o que não deve ser guardado sem a pessoa pedir de forma explícita."""
    if _SENSITIVE_RE.search(text) or _INJECTION.search(text):
        return True
    return bool(_SENSITIVE_WORD_RE.search(normalize(text)))


# ---------------------------------------------------------------------------
# Extração
# ---------------------------------------------------------------------------

# Pedido de transformar um texto: o conteúdo não é sobre a pessoa.
_TRANSFORM = re.compile(
    r"^\s*(?:por favor,?\s*)?(?:traduz|tradu[cz]a|translate|reescrev|rewrite|corrij|corrige"
    r"|revis[ea]"
    r"|resum[aeo]|summar|parafrase|melhor[ae] (?:esse|este|o) texto|transcrev)",
    re.I,
)
_SENT = re.compile(r"(?<=[.!?\n])\s+")
_END = r"(?=[.!?\n;]|$)"
_NAME = r"([A-ZÀ-Ý][\wÀ-ÿ'-]{1,24}(?: [A-ZÀ-Ý][\wÀ-ÿ'-]{1,24}){0,2})"

_RULES: tuple[tuple[re.Pattern[str], str, str, float], ...] = (
    # (padrão, molde, assunto, confiança) — `{0}` é o trecho capturado.
    (
        re.compile(
            r"\b(?:lembr[ea](?:-se)?|guard[ea]|anot[ea]|memoriz[ea]|n[aã]o (?:se )?esque[cç]a"
            r"|remember)"
            r"(?: a[ií])?(?: de)?(?: que| that)?[:,]?\s+(.{4,200}?)" + _END,
            re.I,
        ),
        "{0}",
        "",
        0.95,
    ),
    (
        re.compile(
            r"\b(?i:meu nome [eé]|me chamo|pode(?:m)? me chamar de|my name is)\s+" + _NAME + r"\b"
        ),
        "Nome: {0}",
        "nome",
        0.9,
    ),
    (
        re.compile(
            r"\b(?:eu )?trabalho (?:como|de) (.{3,60}?)" + _END + r"|\bsou (?:um |uma )?"
            r"((?:desenvolvedor|programador|designer|professor|estudante|engenheir|advogad|m[eé]dic"
            r"|enfermeir|criador|youtuber|streamer|empres[aá]ri|vendedor|analista|gerente|artista"
            r"|escritor|jornalista|contador|arquitet)[\wÀ-ÿ ]{0,40}?)" + _END,
            re.I,
        ),
        "Trabalha como {0}",
        "trabalho",
        0.75,
    ),
    (
        re.compile(r"\b(?:eu )?trabalho com (.{3,60}?)" + _END, re.I),
        "Trabalha com {0}",
        "",
        0.7,
    ),
    (
        re.compile(r"\b(?i:(?:eu )?(?:moro|vivo) (?:em|no|na)) ([A-ZÀ-Ý][\wÀ-ÿ' -]{2,40}?)" + _END),
        "Mora em {0}",
        "cidade",
        0.7,
    ),
    (
        re.compile(
            r"\b(?:eu )?(prefiro|n[aã]o gosto de|gosto (?:mais |muito )?de|adoro|odeio|I prefer)\s+"
            r"(.{3,120}?)" + _END,
            re.I,
        ),
        "{0} {1}",
        "",
        0.7,
    ),
    (
        re.compile(
            r"\b(sempre|nunca) (?:me )?(respond[ae]|us[ea]|escrev[ae]|fale|mostre"
            r"|expli(?:que|ca))\s+"
            r"(.{3,120}?)" + _END,
            re.I,
        ),
        "Pediu: {0} {1} {2}",
        "",
        0.8,
    ),
    (
        re.compile(
            r"\b(?:eu )?(?:estou|t[oô]) (criando|desenvolvendo|construindo|montando|escrevendo"
            r"|estudando|aprendendo)\s+(.{4,120}?)" + _END,
            re.I,
        ),
        "Está {0} {1}",
        "",
        0.6,
    ),
    (
        re.compile(r"\bmeu projeto (?:[eé]|se chama)\s+(.{3,100}?)" + _END, re.I),
        "Projeto: {0}",
        "projeto",
        0.7,
    ),
)

_PREF_VERBS = {
    "prefiro": "Prefere",
    "i prefer": "Prefere",
    "adoro": "Adora",
    "odeio": "Não gosta de",
    "nao gosto de": "Não gosta de",
}


def _clean(text: str) -> str:
    return " ".join(text.split()).strip(" \"'`.,;:-—")


def extract(message: str) -> list[Candidate]:
    """Frases da pessoa que valem lembrar. Lista vazia é o resultado normal."""
    if not message or len(message) > MAX_SOURCE_CHARS or _TRANSFORM.search(message):
        return []
    found: list[Candidate] = []
    for sentence in _SENT.split(message):
        sentence = sentence.strip()
        if len(sentence) < 8 or sentence.endswith("?"):
            continue
        for pattern, template, subject, confidence in _RULES:
            match = pattern.search(sentence)
            if not match:
                continue
            groups = [_clean(group) for group in match.groups() if group]
            if not groups or any(len(group) < 2 for group in groups):
                continue
            if template == "{0} {1}":
                verb = normalize(groups[0])
                head = _PREF_VERBS.get(verb, "Gosta de" if verb.startswith("gosto") else groups[0])
                content = f"{head} {groups[1]}"
            else:
                content = template.format(*groups)
            content = _clean(content)[:MAX_MEMORY_CHARS]
            # O filtro olha a frase inteira: "minha senha é X, lembre disso" não passa.
            if is_sensitive(sentence) or is_sensitive(content):
                break
            item = Candidate(content[0].upper() + content[1:], subject, confidence)
            if all(similarity(item.content, other.content) < 0.8 for other in found):
                found.append(item)
            if len(found) >= MAX_AUTO_PER_MESSAGE:
                return found
            if pattern is _RULES[0][0]:
                # Pedido explícito ("lembre que…") já resume a frase inteira.
                break
    return found


# ---------------------------------------------------------------------------
# Duplicatas e atualização
# ---------------------------------------------------------------------------

_SUBJECT_PREFIX = {
    "nome": "nome",
    "trabalho": "trabalha como",
    "cidade": "mora em",
    "projeto": "projeto",
}


@dataclass(frozen=True, slots=True)
class Decision:
    """`action`: "create", "update" (troca `target_id`) ou "skip"."""

    action: str
    target_id: str = ""


def merge(candidate: Candidate, existing: Sequence[MemoryLike]) -> Decision:
    """Evita cópia e troca a memória antiga quando o assunto é o mesmo."""
    wanted = normalize(candidate.content)
    for memory in existing:
        if (
            normalize(memory.content) == wanted
            or similarity(memory.content, candidate.content) >= 0.8
        ):
            return Decision("skip")
    prefix = _SUBJECT_PREFIX.get(candidate.subject)
    if prefix:
        for memory in existing:
            if normalize(memory.content).startswith(prefix):
                return Decision("update", memory.id)
    return Decision("create")


# ---------------------------------------------------------------------------
# Recuperação por relevância
# ---------------------------------------------------------------------------


def relevant(
    memories: Sequence[MemoryLike], question: str, limit: int = RELEVANT_LIMIT
) -> list[MemoryLike]:
    """As memórias que importam para esta pergunta, na ordem em que foram criadas.

    Poucas memórias: vão todas (é o comportamento antigo e o mais previsível).
    Muitas: ficam as que compartilham palavras com a pergunta e, para completar,
    as mais recentes.
    """
    items = list(memories)
    if len(items) <= limit:
        return items
    asked = tokens(question)
    newest = max(memory.created_at for memory in items) or 1

    def score(memory: MemoryLike) -> float:
        overlap = len(tokens(memory.content) & asked)
        return overlap * 10 + memory.created_at / newest

    chosen = sorted(items, key=score, reverse=True)[:limit]
    return sorted(chosen, key=lambda memory: (memory.created_at, memory.id))
