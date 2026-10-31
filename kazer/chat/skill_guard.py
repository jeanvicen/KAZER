"""Guarda das Skills: o que uma Skill pode conter para circular entre contas.

Uma Skill é texto que entra no contexto do modelo. Publicada para a comunidade,
vira um canal de ataque: quem escreve fala com o modelo de *outra pessoa*, e
quem instala raramente lê o que instalou. A pesquisa de segurança sobre
arquivos `SKILL.md` aponta os mesmos caminhos, e a guarda fecha cada um:

* **Texto invisível.** Caracteres de largura zero, controles bidirecionais e o
  bloco "Tags" do Unicode (U+E0000–U+E007F) escondem instruções que a revisão
  visual não vê. Não têm uso legítimo numa Skill: são recusados sempre, até nas
  Skills privadas.
* **Instruções que tentam mandar no sistema.** "Ignore as regras anteriores",
  "revele o prompt do sistema", falsos delimitadores (`<<<`, `<system>`).
* **Fuga de dados.** Links, imagens remotas e blocos de base64 são o jeito de
  levar conteúdo para fora pela própria resposta.
* **Ação escondida ou destrutiva.** "Sem avisar a pessoa", apagar, enviar,
  empurrar código.
* **Pedir segredos.** Senha, token e chave de API nunca são pedidos por Skill.

A guarda **não prova** que uma Skill é segura — nenhuma regra de texto prova. Ela
barra o que é inequívoco e o resto fica contido pelo resto do sistema: Skills da
comunidade entram como texto de terceiros, sem autoridade, sem ferramenta de
escrita, e a instalada é uma cópia congelada, que o autor não altera depois.

Só o motivo volta para a pessoa; o trecho que disparou a regra nunca é repetido
(ele pode ser justamente a instrução maliciosa).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

MAX_SHARED_INSTRUCTIONS = 12_000
MAX_SLUG = 40


@dataclass(frozen=True, slots=True)
class Finding:
    """Um motivo de recusa: código estável para teste e frase para a pessoa."""

    code: str
    reason: str


def normalize(text: str) -> str:
    """NFC e quebras de linha padronizadas: o que se escaneia é o que se grava."""
    return unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")


def has_hidden_characters(text: str) -> bool:
    """Há caractere invisível ou de controle (fora quebra de linha e tabulação)?

    Pega a categoria Unicode inteira, não uma lista: `Cf` (formato: largura zero,
    bidi, Tags), `Co` (uso privado), `Cn` (não atribuído) e `Cc` (controle).
    """
    for char in text:
        if char in "\n\t":
            continue
        if unicodedata.category(char) in {"Cf", "Co", "Cn", "Cc", "Cs"}:
            return True
    return False


def slugify(name: str) -> str:
    """`Revisor de Código` vira `revisor-de-codigo`: o nome do comando `/`."""
    folded = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    pieces = re.findall(r"[a-z0-9]+", folded.lower())
    return "-".join(pieces)[:MAX_SLUG].strip("-")


_RULES: tuple[tuple[str, str, re.Pattern[str]], ...] = tuple(
    (code, reason, re.compile(pattern, re.IGNORECASE | re.UNICODE))
    for code, reason, pattern in (
        (
            "override",
            "tenta mandar o modelo ignorar as regras ou trocar de papel",
            r"(ignor\w*|desconsider\w*|esque[cç]\w*|disregard|forget|override|sobrescrev\w*)"
            r"\W+(\w+\W+){0,4}?(previous|prior|above|earlier|all|anteriores?|acima|tudo|todas?|"
            r"regras|rules|instruc\w*|instru[cç][õo]es)"
            r"|\b(you are now|agora voc[eê] [eé]|a partir de agora voc[eê])\b"
            r"|\b(jailbreak|modo dan|do anything now|developer mode|modo desenvolvedor)\b",
        ),
        (
            "reveal",
            "pede para revelar o prompt do sistema ou instruções internas",
            r"(reveal|show|print|repeat|display|leak|reve[le]\w*|mostr\w*|imprim\w*|repit\w*|"
            r"exib\w*|vaz\w*)\W+(\w+\W+){0,4}?(system|hidden|internal|sistema|ocult\w*|intern\w*|"
            r"secret\w*)\W+(\w+\W+){0,2}?(prompt|instruc\w*|instru[cç][õo]es|message|mensagem)"
            # Ordem do português: "o prompt do sistema".
            r"|(reve[le]\w*|mostr\w*|imprim\w*|repit\w*|exib\w*|vaz\w*|copi\w*)\W+"
            r"(\w+\W+){0,3}?(prompt|instruc\w*|instru[cç][õo]es)\W+(\w+\W+){0,2}?(do\s+)?"
            r"(system|sistema|ocult\w*|intern\w*)\b",
        ),
        (
            "spoof",
            "imita delimitadores ou mensagens do sistema",
            r"<<<|>>>|<\||\|>|\[/?inst\]|</?(system|assistant|user|tool|im_start|im_end)\b"
            r"|^\s*(system|assistant|sistema|assistente)\s*:",
        ),
        (
            "markup",
            "traz marcação HTML ou script",
            r"</?[a-z][a-z0-9-]*(\s[^>]*)?>|<!--|<script|javascript:|data:text/",
        ),
        (
            "link",
            "traz link ou imagem remota (caminho de fuga de dados)",
            r"https?://|\bwww\.\w|!\[[^\]]*\]\(|\bftp://",
        ),
        (
            "blob",
            "traz um bloco codificado (base64 ou hexadecimal longo)",
            r"[A-Za-z0-9+/=]{80,}|\b[0-9a-fA-F]{64,}\b",
        ),
        (
            "stealth",
            "manda agir sem avisar ou esconder algo da pessoa",
            r"\b(without|sem)\W+(\w+\W+){0,3}?\b(telling|tell|informing|notifying|avis\w*|inform\w*|"
            r"contar|conte|notific\w*|perguntar|asking)\b"
            r"|\b(don'?t|do not|never|n[ãa]o|nunca)\W+(\w+\W+){0,3}?"
            r"\b(tell|mention|reveal|show|conte|"
            r"mencion\w*|revel\w*|mostr\w*|avis\w*)\b\W+(\w+\W+){0,3}?"
            r"(user|person|pessoa|usu[aá]rio)"
            r"|\b(secretly|silently|em segredo|secretamente|silenciosamente|discretamente)\b",
        ),
        (
            "destructive",
            "manda apagar, enviar ou publicar coisas por conta própria",
            r"\b(rm\s+-rf|drop\s+table|git\s+push|git\s+reset\s+--hard|force[- ]push|"
            r"delete\s+(all|every)|apag\w*\s+(tudo|todos|todas)|exclu\w*\s+(tudo|todos|todas))\b"
            r"|\b(exfiltrat\w*|exfiltr\w*)\b",
        ),
        (
            "secrets",
            "pede senha, token ou chave de API",
            r"(ask|request|collect|obtain|get|pe[cç]a|pedir|solicit\w*|colet\w*|obt[eé]m|"
            r"capture)\W+(\w+\W+){0,5}?(passwords?|senhas?|tokens?|api[- ]?keys?|"
            r"chaves?\W+(de\W+)?api|"
            r"credentials?|credenciais|secrets?|segredos?)"
            r"|\b(send|enviar|envie|post|postar|upload)\W+(\w+\W+){0,6}?(passwords?|senhas?|"
            r"tokens?|api[- ]?keys?|credentials?|credenciais|conversation|conversa|memories|"
            r"mem[oó]rias)\W+(\w+\W+){0,4}?(to|para|a)\b",
        ),
    )
)


def scan(name: str, description: str, instructions: str, *, shared: bool) -> list[Finding]:
    """Motivos para recusar esta Skill, em ordem; lista vazia quando passa.

    `shared`: vai para a comunidade, onde o texto chega a outras contas. As
    regras de conteúdo só valem aí; o texto invisível é recusado sempre.
    """
    text = "\n".join(normalize(part) for part in (name, description, instructions))
    found: list[Finding] = []
    if has_hidden_characters(text):
        found.append(
            Finding("hidden", "tem caracteres invisíveis ou de controle escondidos no texto")
        )
    if not shared:
        return found
    if len(instructions) > MAX_SHARED_INSTRUCTIONS:
        found.append(
            Finding(
                "long",
                f"as instruções passam de {MAX_SHARED_INSTRUCTIONS:,} caracteres".replace(",", "."),
            )
        )
    for code, reason, pattern in _RULES:
        if pattern.search(text):
            found.append(Finding(code, reason))
    return found
