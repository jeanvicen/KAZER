#!/usr/bin/env node
/**
 * kazer-security — cross-reference an audit report with the import graph.
 *
 * Usage: node dependency_triage.ts <audit.json> <imports.json>
 *
 * audit.json:   { "vulnerabilities": [ { name, severity, via, effects } ] }
 * imports.json: { "direct": ["lodash"], "transitive": { "lodash": ["build-utils"] } }
 *
 * Output marks each advisory as REACHABLE (appears in the import graph) or
 * UNREACHABLE (no path from application code). Only reachable advisories
 * justify a patch; the rest should be reported but not chased.
 */

export interface Advisory {
  name: string;
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'info';
  via: string[];
  effects?: string[];
}

export interface AuditReport {
  vulnerabilities: Advisory[];
}

export interface ImportGraph {
  direct: string[];
  transitive: Record<string, string[]>;
}

export type Reachability = 'REACHABLE' | 'UNREACHABLE';

export interface TriagedAdvisory extends Advisory {
  reachability: Reachability;
  path: string[];
  action: 'patch' | 'monitor' | 'ignore';
  rationale: string;
}

const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'info'];

export function triage(
  audit: AuditReport,
  graph: ImportGraph,
): TriagedAdvisory[] {
  const direct = new Set(graph.direct);

  /** Walks the transitive graph breadth-first, returning the path if found. */
  const findPath = (target: string): string[] | null => {
    if (direct.has(target)) return [target];

    const queue: { node: string; path: string[] }[] = [];
    for (const [parent, children] of Object.entries(graph.transitive)) {
      if (direct.has(parent)) {
        for (const child of children) {
          queue.push({ node: child, path: [parent, child] });
        }
      }
    }

    const seen = new Set<string>(direct);
    while (queue.length) {
      const { node, path } = queue.shift()!;
      if (node === target) return path;
      if (seen.has(node)) continue;
      seen.add(node);

      for (const child of graph.transitive[node] ?? []) {
        queue.push({ node: child, path: [...path, child] });
      }
    }
    return null;
  };

  return audit.vulnerabilities
    .map((advisory) => {
      const path = findPath(advisory.name);
      const reachability: Reachability = path ? 'REACHABLE' : 'UNREACHABLE';

      let action: TriagedAdvisory['action'];
      let rationale: string;

      if (!path) {
        action = 'ignore';
        rationale = 'nenhum caminho de import a partir do código da aplicação';
      } else if (advisory.severity === 'critical' || advisory.severity === 'high') {
        action = 'patch';
        rationale = `severidade ${advisory.severity} com caminho alcançável`;
      } else {
        action = 'monitor';
        rationale = 'alcançável, mas severidade moderada — agendar correção';
      }

      return { ...advisory, reachability, path: path ?? [], action, rationale };
    })
    .sort((a, b) => {
      const bySeverity =
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
      if (bySeverity !== 0) return bySeverity;
      if (a.reachability !== b.reachability) {
        return a.reachability === 'REACHABLE' ? -1 : 1;
      }
      return 0;
    });
}

if (require.main === module) {
  const [auditFile, importsFile] = process.argv.slice(2);
  if (!auditFile || !importsFile) {
    console.error('Usage: node dependency_triage.ts <audit.json> <imports.json>');
    process.exit(1);
  }
  const fs = require('fs');
  const result = triage(
    JSON.parse(fs.readFileSync(auditFile, 'utf8')),
    JSON.parse(fs.readFileSync(importsFile, 'utf8')),
  );
  console.log(JSON.stringify(result, null, 2));
}
