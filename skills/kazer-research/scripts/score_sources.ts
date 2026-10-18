#!/usr/bin/env node
/**
 * kazer-research — score and deduplicate search results.
 *
 * Usage: node score_sources.ts <results.json>
 *
 * Input:  [{ url, title, domain, snippet, publishedAt, clicks }]
 * Output: ranked + deduplicated array with `relevance`, `tier` and `reason`.
 *
 * Tiering reflects source credibility:
 *   primary   documentation, official records, standards bodies
 *   secondary reputable reporting, analysis, peer-reviewed work
 *   tertiary  blogs, forums, vendor marketing
 *   excluded  no date, aggregator, duplicated content
 */

export type Tier = 'primary' | 'secondary' | 'tertiary' | 'excluded';

export interface RawResult {
  url: string;
  title: string;
  domain: string;
  snippet: string;
  publishedAt?: string | null;
  clicks?: number;
}

export interface ScoredResult extends RawResult {
  relevance: number;
  tier: Tier;
  reason: string;
}

const PRIMARY_DOMAINS = [
  'docs.', 'developer.', 'api.', 'github.com', 'arxiv.org', 'doi.org',
  'gov.br', '.gov', '.edu', 'wikipedia.org', 'nist.gov', 'ietf.org',
  'w3.org', 'readthedocs.io', 'mozilla.org', 'owasp.org', 'cwe.mitre.org',
];

const EXCLUDED_HINTS = [
  'medium.com', 'quora.com', 'reddit.com', 'pinterest.', 'facebook.com',
  'linkedin.com', 'tiktok.', 'youtube.com',
];

const AGGREGATOR_HINTS = [
  'best-', 'top-10', 'top-20', 'lista-de', 'ranking-', 'melhores-',
];

/** Normalises a URL so duplicates collapse to a single key. */
function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'fbclid' || key === 'gclid') {
        parsed.searchParams.delete(key);
      }
    }
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function classify(domain: string, title: string, snippet: string): { tier: Tier; reason: string } {
  const lower = `${domain} ${title} ${snippet}`.toLowerCase();

  if (EXCLUDED_HINTS.some((hint) => lower.includes(hint))) {
    return { tier: 'excluded', reason: 'plataforma social sem curadoria editorial' };
  }
  if (AGGREGATOR_HINTS.some((hint) => title.toLowerCase().includes(hint))) {
    return { tier: 'excluded', reason: 'formato de lista agregada' };
  }
  if (PRIMARY_DOMAINS.some((hint) => lower.includes(hint))) {
    return { tier: 'primary', reason: 'fonte primária' };
  }
  if (/\.(com|io|net|dev|br)\b/.test(domain) && title.length > 25) {
    return { tier: 'secondary', reason: 'publicação com autoria identificável' };
  }
  return { tier: 'tertiary', reason: 'conteúdo sem sinal claro de autoridade' };
}

/** Recency: 1.0 for fresh, decaying to 0 for content older than 24 months. */
function recency(publishedAt?: string | null, now = new Date()): number {
  if (!publishedAt) return 0.35;
  const published = new Date(publishedAt).getTime();
  if (Number.isNaN(published)) return 0.35;

  const months = (now.getTime() - published) / (1000 * 60 * 60 * 24 * 30);
  if (months < 0) return 1;
  if (months < 6) return 0.95;
  if (months < 12) return 0.85;
  if (months < 24) return 0.65;
  return 0.4;
}

export function scoreSources(results: RawResult[], now = new Date()): ScoredResult[] {
  const seen = new Map<string, ScoredResult>();

  for (const result of results) {
    const key = canonicalUrl(result.url);
    const { tier, reason } = classify(result.domain, result.title, result.snippet);
    const relevance = Number(
      (recency(result.publishedAt, now) * 0.4 + (tier === 'primary' ? 0.45 : tier === 'secondary' ? 0.3 : 0.15) * 0.6).toFixed(3),
    );

    const scored: ScoredResult = { ...result, relevance, tier, reason };
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, scored);
    } else if (relevance > existing.relevance) {
      seen.set(key, { ...scored, url: existing.url });
    }
  }

  return [...seen.values()]
    .filter((s) => s.tier !== 'excluded')
    .sort((a, b) => b.relevance - a.relevance);
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node score_sources.ts <results.json>');
    process.exit(1);
  }
  const raw = JSON.parse(require('fs').readFileSync(file, 'utf8')) as RawResult[];
  console.log(JSON.stringify(scoreSources(raw), null, 2));
}
