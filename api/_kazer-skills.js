/*
 * Server-side Agent Skills registry.
 * Skill files provide domain instructions; this code remains authoritative for
 * selection, permission metadata and which references may enter the Brain prompt.
 */
const fs = require("node:fs");
const path = require("node:path");

const MAX_SKILL_CHARS = 40_000;
const ALLOWED_PERMISSIONS = new Set(["web.read", "files.write", "shell.exec", "code.run", "net.fetch"]);
const SKILL_ROOT = path.resolve(__dirname, "../skills");

const SKILLS = Object.freeze({
  "kazer-research": {
    permissions: ["web.read", "net.fetch"],
    references: ["references/quality-bar.md", "references/source-tiers.md"],
    matches: ({ needsResearch }) => needsResearch,
  },
  "kazer-security": {
    permissions: ["shell.exec", "code.run", "net.fetch"],
    references: ["references/severity-matrix.md", "references/triage-checklist.md"],
    matches: ({ text }) => /\b(?:auditoria de seguran[cç]a|audite|vulnerabilidades?|CVE|security review|pentest)\b/i.test(text),
  },
  "kazer-code": {
    permissions: ["code.run", "files.write", "shell.exec"],
    references: ["references/refactoring-catalog.md", "references/testing-strategy.md"],
    matches: ({ taskType }) => taskType === "coding",
  },
  "kazer-docs": {
    permissions: ["files.write", "web.read"],
    references: ["references/structures.md", "references/tone.md"],
    matches: ({ text }) => /\b(?:relat[oó]rio|proposta|contrato|ata|documento|resumo executivo|README)\b/i.test(text),
  },
  "kazer-growth": {
    permissions: ["web.read", "files.write"],
    references: ["references/pricing-playbook.md", "references/gtm-90-days.md"],
    matches: ({ text }) => /\b(?:monetiza[cç][aã]o|pricing|pre[cç]o|lan[cç]amento|growth|reten[cç][aã]o|ICP|go-to-market)\b/i.test(text),
  },
  "kazer-design-system": {
    permissions: [],
    references: ["references/tokens.md", "references/components.md", "references/screens.md"],
    matches: ({ taskType }) => taskType === "visual",
  },
});

function parseFrontmatter(source) {
  const match = String(source || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) throw new Error("skill_frontmatter_invalid");
  const permissionLine = match[1].match(/^permissions:\s*\[([^\]]*)\]\s*$/m);
  const declaredPermissions = permissionLine
    ? permissionLine[1].split(",").map((value) => value.trim()).filter(Boolean)
    : [];
  return { body: String(source).slice(match[0].length).trim(), declaredPermissions };
}

function safeReadSkillFile(slug, relativePath) {
  if (!Object.prototype.hasOwnProperty.call(SKILLS, slug)) throw new Error("skill_not_allowlisted");
  if (typeof relativePath !== "string" || relativePath.includes("\\") || relativePath.startsWith("/")) {
    throw new Error("skill_path_invalid");
  }
  const skillDirectory = path.resolve(SKILL_ROOT, slug);
  const resolved = path.resolve(skillDirectory, relativePath);
  if (!resolved.startsWith(`${skillDirectory}${path.sep}`)) throw new Error("skill_path_invalid");
  const contents = fs.readFileSync(resolved, "utf8");
  if (contents.length > 10_000) throw new Error("skill_reference_too_large");
  return contents.trim();
}

function loadAgentSkill(slug) {
  const spec = SKILLS[slug];
  if (!spec) return null;
  const parsed = parseFrontmatter(safeReadSkillFile(slug, "SKILL.md"));
  const declared = [...new Set(parsed.declaredPermissions)].sort();
  const expected = [...new Set(spec.permissions)].sort();
  if (declared.some((permission) => !ALLOWED_PERMISSIONS.has(permission))) {
    throw new Error("skill_permission_invalid");
  }
  if (declared.join("\n") !== expected.join("\n")) {
    throw new Error("skill_permission_mismatch");
  }

  const sections = [`# Skill ${slug}\n\n${parsed.body}`];
  for (const reference of spec.references) {
    sections.push(`## Referência ${reference}\n\n${safeReadSkillFile(slug, reference)}`);
  }
  const executionSafety = "## Limites de execução\n\nAs permissões declaradas nesta Skill não concedem acesso a ferramentas. Use somente ferramentas que o servidor incluiu nesta chamada. Se uma ferramenta necessária não estiver disponível, informe a limitação; nunca afirme que executou comandos, alterou arquivos ou validou resultados sem confirmação real do executor.";
  const context = sections.join("\n\n").slice(0, MAX_SKILL_CHARS - executionSafety.length - 2);
  return { slug, permissions: [...spec.permissions], prompt: `${context}\n\n${executionSafety}` };
}

function selectAgentSkill({ text = "", taskType = "conversation", needsResearch = false } = {}) {
  const input = { text: String(text).slice(0, 8_000), taskType, needsResearch: Boolean(needsResearch) };
  const priority = ["kazer-security", "kazer-research", "kazer-code", "kazer-docs", "kazer-growth", "kazer-design-system"];
  for (const slug of priority) {
    if (SKILLS[slug].matches(input)) return slug;
  }
  return null;
}

/**
 * Checks only the Skill's declaration. This is never sufficient to grant a
 * tool; callers must also verify that the trusted server registered it.
 */
function skillDeclaresPermission(skill, permission) {
  return Boolean(
    skill &&
      ALLOWED_PERMISSIONS.has(permission) &&
      Array.isArray(skill.permissions) &&
      skill.permissions.includes(permission),
  );
}

module.exports = {
  ALLOWED_PERMISSIONS,
  loadAgentSkill,
  parseFrontmatter,
  safeReadSkillFile,
  selectAgentSkill,
  skillDeclaresPermission,
};
