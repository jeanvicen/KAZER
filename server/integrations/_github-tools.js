/*
 * KAZER — ferramentas de GitHub expostas ao Brain.
 * Chat normal: somente leitura do repositório selecionado.
 * Modo Computer: leitura + escrita em branches que não sejam a padrão
 * (criar branch, gravar arquivo, abrir pull request, issue e comentário).
 * O escopo é sempre o repositório que a pessoa selecionou e o servidor validou.
 */
const { decodeToken, getConnection, githubFetch } = require("./_github");

const MAX_FILE_CHARS = 24_000;
const MAX_WRITE_BYTES = 200_000;
const MAX_LIST_ITEMS = 200;

const BRANCH_PATTERN = /^(?!\/|.*(?:\.\.|\/\/|@\{|\\))[A-Za-z0-9._\/-]{1,120}(?<![./])$/;

function safePath(value) {
  const text = String(value ?? "").trim().replace(/^\/+/, "");
  if (text.length > 400 || /[\u0000-\u001f\u007f\\]/.test(text)) return null;
  if (text.split("/").some((part) => part === ".." || part === ".")) return null;
  return text;
}

function safeBranch(value) {
  const text = String(value ?? "").trim();
  return BRANCH_PATTERN.test(text) ? text : null;
}

function cleanText(value, maximum) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maximum);
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", additionalProperties: false, properties, required } },
});

const READ_TOOLS = [
  fn("github_list_files", "Lista arquivos e pastas de um caminho do repositório selecionado.", {
    path: { type: "string", description: "Caminho relativo; vazio para a raiz." },
    ref: { type: "string", description: "Branch, tag ou commit. Padrão: branch padrão." },
  }),
  fn("github_read_file", "Lê o conteúdo de texto de um arquivo do repositório selecionado.", {
    path: { type: "string" },
    ref: { type: "string" },
  }, ["path"]),
  fn("github_search_code", "Busca código dentro do repositório selecionado.", { query: { type: "string" } }, ["query"]),
  fn("github_list_commits", "Lista commits recentes.", { ref: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 30 } }),
  fn("github_list_branches", "Lista branches do repositório."),
  fn("github_list_issues", "Lista issues do repositório.", { state: { type: "string", enum: ["open", "closed", "all"] } }),
  fn("github_list_pull_requests", "Lista pull requests do repositório.", { state: { type: "string", enum: ["open", "closed", "all"] } }),
];

const WRITE_TOOLS = [
  fn("github_create_branch", "MODO COMPUTER. Cria uma branch nova a partir de outra (padrão: branch padrão).", {
    branch: { type: "string" },
    from: { type: "string" },
  }, ["branch"]),
  fn("github_write_file", "MODO COMPUTER. Cria ou substitui um arquivo inteiro numa branch que não seja a padrão e faz o commit.", {
    path: { type: "string" },
    content: { type: "string", description: "Conteúdo completo do arquivo." },
    message: { type: "string", description: "Mensagem de commit." },
    branch: { type: "string" },
  }, ["path", "content", "message", "branch"]),
  fn("github_open_pull_request", "MODO COMPUTER. Abre um pull request da branch de trabalho para a base.", {
    title: { type: "string" },
    body: { type: "string" },
    head: { type: "string" },
    base: { type: "string" },
  }, ["title", "head"]),
  fn("github_create_issue", "MODO COMPUTER. Cria uma issue.", { title: { type: "string" }, body: { type: "string" } }, ["title"]),
  fn("github_comment", "MODO COMPUTER. Comenta numa issue ou pull request.", { number: { type: "integer", minimum: 1 }, body: { type: "string" } }, ["number", "body"]),
];

const READ_NAMES = new Set(READ_TOOLS.map((tool) => tool.function.name));
const WRITE_NAMES = new Set(WRITE_TOOLS.map((tool) => tool.function.name));

function githubToolDefinitions({ computer = false } = {}) {
  return computer ? [...READ_TOOLS, ...WRITE_TOOLS] : [...READ_TOOLS];
}

function isGitHubTool(name) {
  return READ_NAMES.has(name) || WRITE_NAMES.has(name);
}

function isGitHubWriteTool(name) {
  return WRITE_NAMES.has(name);
}

const ACTION_LABELS = {
  github_list_files: "Listou arquivos",
  github_read_file: "Leu arquivo",
  github_search_code: "Buscou no código",
  github_list_commits: "Leu commits",
  github_list_branches: "Leu branches",
  github_list_issues: "Leu issues",
  github_list_pull_requests: "Leu pull requests",
  github_create_branch: "Criou branch",
  github_write_file: "Gravou arquivo",
  github_open_pull_request: "Abriu pull request",
  github_create_issue: "Criou issue",
  github_comment: "Comentou",
};

async function createGitHubSession(userId, repository) {
  if (!userId || !repository?.fullName) return null;
  const connection = await getConnection(userId).catch(() => null);
  const token = decodeToken(connection);
  if (!token) return null;
  const [owner, name] = repository.fullName.split("/");
  return {
    token,
    owner,
    name,
    base: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    defaultBranch: repository.defaultBranch || "main",
  };
}

async function readFile(session, path, ref) {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const data = await githubFetch(`${session.base}/contents/${encodePath(path)}${query}`, session.token);
  if (Array.isArray(data) || data?.type !== "file") throw new Error("O caminho não é um arquivo.");
  const text = Buffer.from(String(data.content || ""), "base64").toString("utf8");
  if (/\u0000/.test(text)) return { path, sha: data.sha, binary: true, size: data.size };
  return { path, sha: data.sha, size: data.size, truncated: text.length > MAX_FILE_CHARS, content: text.slice(0, MAX_FILE_CHARS) };
}

async function fileSha(session, path, branch) {
  try {
    const data = await githubFetch(`${session.base}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`, session.token);
    return Array.isArray(data) ? null : data?.sha || null;
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

function requireWorkBranch(session, value) {
  const branch = safeBranch(value);
  if (!branch) throw new Error("Nome de branch inválido.");
  if (branch === session.defaultBranch) throw new Error(`Escrita direta na branch padrão (${session.defaultBranch}) é bloqueada. Crie uma branch de trabalho e abra um pull request.`);
  return branch;
}

async function executeGitHubTool(session, name, args = {}, { computer = false } = {}) {
  if (!session) throw new Error("Conecte o GitHub e selecione um repositório.");
  if (WRITE_NAMES.has(name) && !computer) throw new Error("Alterações no repositório só são permitidas no modo Computer.");
  const ref = args.ref ? safeBranch(args.ref) || undefined : undefined;

  switch (name) {
    case "github_list_files": {
      const path = safePath(args.path || "");
      if (path === null) throw new Error("Caminho inválido.");
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const data = await githubFetch(`${session.base}/contents/${encodePath(path)}${query}`, session.token);
      const items = Array.isArray(data) ? data : [data];
      return { path: path || "/", items: items.slice(0, MAX_LIST_ITEMS).map((item) => ({ name: item.name, path: item.path, type: item.type, size: item.size })) };
    }
    case "github_read_file": {
      const path = safePath(args.path);
      if (!path) throw new Error("Caminho inválido.");
      return readFile(session, path, ref);
    }
    case "github_search_code": {
      const query = cleanText(args.query, 200);
      if (!query) throw new Error("Consulta vazia.");
      const data = await githubFetch(`/search/code?q=${encodeURIComponent(`${query} repo:${session.owner}/${session.name}`)}&per_page=20`, session.token);
      return { total: data?.total_count || 0, items: (data?.items || []).map((item) => ({ path: item.path, name: item.name })) };
    }
    case "github_list_commits": {
      const limit = Math.max(1, Math.min(30, Number(args.limit) || 10));
      const data = await githubFetch(`${session.base}/commits?per_page=${limit}${ref ? `&sha=${encodeURIComponent(ref)}` : ""}`, session.token);
      return (data || []).map((item) => ({ sha: String(item.sha).slice(0, 10), message: cleanText(item.commit?.message, 300), author: item.commit?.author?.name, date: item.commit?.author?.date }));
    }
    case "github_list_branches": {
      const data = await githubFetch(`${session.base}/branches?per_page=100`, session.token);
      return { defaultBranch: session.defaultBranch, branches: (data || []).map((item) => item.name) };
    }
    case "github_list_issues":
    case "github_list_pull_requests": {
      const state = ["open", "closed", "all"].includes(args.state) ? args.state : "open";
      const kind = name === "github_list_issues" ? "issues" : "pulls";
      const data = await githubFetch(`${session.base}/${kind}?state=${state}&per_page=20`, session.token);
      return (data || []).filter((item) => kind === "pulls" || !item.pull_request).map((item) => ({ number: item.number, title: cleanText(item.title, 200), state: item.state, url: item.html_url, user: item.user?.login }));
    }
    case "github_create_branch": {
      const branch = requireWorkBranch(session, args.branch);
      const from = safeBranch(args.from || session.defaultBranch) || session.defaultBranch;
      const source = await githubFetch(`${session.base}/git/ref/heads/${encodePath(from)}`, session.token);
      await githubFetch(`${session.base}/git/refs`, session.token, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: source.object.sha }) });
      return { created: true, branch, from };
    }
    case "github_write_file": {
      const branch = requireWorkBranch(session, args.branch);
      const path = safePath(args.path);
      if (!path) throw new Error("Caminho inválido.");
      const content = String(args.content ?? "");
      if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) throw new Error("Arquivo grande demais para gravar pelo KAZER.");
      const message = cleanText(args.message, 200) || `Atualiza ${path}`;
      const sha = await fileSha(session, path, branch);
      const data = await githubFetch(`${session.base}/contents/${encodePath(path)}`, session.token, {
        method: "PUT",
        body: JSON.stringify({ message, content: Buffer.from(content, "utf8").toString("base64"), branch, ...(sha ? { sha } : {}) }),
      });
      return { committed: true, path, branch, commit: String(data?.commit?.sha || "").slice(0, 10), url: data?.content?.html_url };
    }
    case "github_open_pull_request": {
      const head = requireWorkBranch(session, args.head);
      const base = safeBranch(args.base || session.defaultBranch) || session.defaultBranch;
      const data = await githubFetch(`${session.base}/pulls`, session.token, {
        method: "POST",
        body: JSON.stringify({ title: cleanText(args.title, 200), body: cleanText(args.body, 6000), head, base }),
      });
      return { opened: true, number: data?.number, url: data?.html_url };
    }
    case "github_create_issue": {
      const data = await githubFetch(`${session.base}/issues`, session.token, {
        method: "POST",
        body: JSON.stringify({ title: cleanText(args.title, 200), body: cleanText(args.body, 6000) }),
      });
      return { created: true, number: data?.number, url: data?.html_url };
    }
    case "github_comment": {
      const number = Number.parseInt(args.number, 10);
      if (!Number.isInteger(number) || number < 1) throw new Error("Número inválido.");
      const data = await githubFetch(`${session.base}/issues/${number}/comments`, session.token, {
        method: "POST",
        body: JSON.stringify({ body: cleanText(args.body, 6000) }),
      });
      return { commented: true, url: data?.html_url };
    }
    default:
      throw new Error("Ferramenta GitHub desconhecida.");
  }
}

module.exports = {
  ACTION_LABELS,
  createGitHubSession,
  executeGitHubTool,
  githubToolDefinitions,
  isGitHubTool,
  isGitHubWriteTool,
  safeBranch,
  safePath,
};
