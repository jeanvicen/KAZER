"""Catálogo de Skills públicas verificáveis, vindas de repositórios abertos.

A lista vem da busca pública do skills.sh. O KAZER só usa metadados na vitrine;
o arquivo de instruções é baixado do repositório/registro apenas quando a pessoa
abre uma Skill e passa novamente pela guarda antes de ser instalado.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

SEARCH_URL = "https://skills.sh/api/search?q={query}"
DOWNLOAD_URL = "https://skills.sh/api/download/{source}/{slug}"
TOPICS = (
    ("programação", "python"),
    ("interfaces", "design"),
    ("segurança", "security"),
    ("dados", "data"),
    ("GitHub", "github"),
    ("testes", "testing"),
    ("DevOps", "devops"),
    ("escrita", "writing"),
    ("produtividade", "productivity"),
    ("web", "react"),
)
CACHE_SECONDS = 15 * 60
_cache: tuple[float, tuple[ExternalSkill, ...]] = (0.0, ())


@dataclass(frozen=True, slots=True)
class ExternalSkill:
    id: str
    source: str
    skill_id: str
    name: str
    category: str
    installs: int

    @property
    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name.replace("-", " ").title(),
            "slug": self.skill_id,
            "description": f"{self.category} · publicada em {self.source}",
            "origin": "repositorio",
            "category": self.category,
            "source": self.source,
            "installs": self.installs,
        }


def _get_json(url: str) -> dict[str, Any]:
    headers = {"User-Agent": "KAZER Skills Catalog/1.0", "Accept": "application/json"}
    request = Request(url, headers=headers)
    with urlopen(request, timeout=8) as response:  # noqa: S310 -- URL fixa acima
        return json.loads(response.read().decode("utf-8"))


def _catalog_id(source: str, skill_id: str) -> str:
    digest = hashlib.sha256(f"{source}/{skill_id}".encode()).hexdigest()[:32]
    return f"repo_{digest}"


def _search(topic: tuple[str, str]) -> list[ExternalSkill]:
    category, query = topic
    try:
        data = _get_json(SEARCH_URL.format(query=quote(query)))
    except (OSError, ValueError, json.JSONDecodeError):
        return []
    found: list[ExternalSkill] = []
    for raw in data.get("skills", []):
        source = raw.get("source")
        skill_id = raw.get("skillId")
        name = raw.get("name")
        if not all(isinstance(value, str) and value for value in (source, skill_id, name)):
            continue
        if len(source) > 160 or len(skill_id) > 160:
            continue
        installs = raw.get("installs", 0)
        found.append(
            ExternalSkill(
                id=_catalog_id(source, skill_id),
                source=source,
                skill_id=skill_id,
                name=name[:100],
                category=category,
                installs=installs if isinstance(installs, int) and installs >= 0 else 0,
            )
        )
    return found


def catalog() -> tuple[ExternalSkill, ...]:
    """Devolve até 100 Skills reais, sempre com origem e cache curto."""
    global _cache
    saved_at, saved = _cache
    if saved and time.monotonic() - saved_at < CACHE_SECONDS:
        return saved
    with ThreadPoolExecutor(max_workers=len(TOPICS)) as executor:
        batches = executor.map(_search, TOPICS)
        unique: dict[str, ExternalSkill] = {}
        for batch in batches:
            for item in batch:
                unique.setdefault(item.id, item)
                if len(unique) >= 100:
                    break
            if len(unique) >= 100:
                break
    fresh = tuple(sorted(unique.values(), key=lambda item: item.installs, reverse=True)[:100])
    if fresh:
        _cache = (time.monotonic(), fresh)
        return fresh
    return saved


def get(skill_id: str) -> ExternalSkill | None:
    return next((item for item in catalog() if item.id == skill_id), None)


def _sanitize(text: str) -> str:
    """Remove conteúdo remoto/HTML antes da guarda analisar texto de terceiros."""
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"https?://[^\s)>]+", "[link removido]", text)
    return re.sub(r"</?[A-Za-z][^>]{0,200}>", "", text)


def instructions(skill: ExternalSkill) -> str | None:
    """Baixa a instrução original e retorna o arquivo principal, sem arquivos extras."""
    try:
        url = DOWNLOAD_URL.format(
            source=quote(skill.source, safe="/"), slug=quote(skill.skill_id, safe="/")
        )
        data = _get_json(url)
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    files = data.get("files")
    if not isinstance(files, list):
        return None
    preferred = ("SKILL.md", "AGENTS.md", "skill.md", "README.md")
    for filename in preferred:
        for item in files:
            if item.get("path") == filename and isinstance(item.get("contents"), str):
                return _sanitize(item["contents"][:12_000])
    for item in files:
        text = item.get("contents")
        if isinstance(text, str) and item.get("path", "").lower().endswith(".md"):
            return _sanitize(text[:12_000])
    return None
