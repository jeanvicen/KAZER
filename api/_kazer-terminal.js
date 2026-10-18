/*
 * KAZER terminal tool: GitHub-selected source is copied to a fresh E2B sandbox.
 * No command is run in the Vercel/Node host. Credentials never enter the sandbox.
 */
const path = require("node:path");
const { getConnection, decodeToken, githubFetch } = require("./_github");
const { redactSensitiveText } = require("./_security");

const WORKSPACE_ROOT = "/home/user/kazer-workspace";
const COMMAND_TIMEOUT_MS = 20_000;
const SANDBOX_TIMEOUT_MS = 45_000;
const MAX_COMMAND_CHARS = 1_600;
const MAX_OUTPUT_BYTES = 32 * 1024;
const MAX_SOURCE_FILES = 60;
const MAX_SOURCE_FILE_BYTES = 80 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 1_500_000;
const FILE_CONCURRENCY = 8;

const ALLOWED_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cxx", ".css", ".go", ".h", ".hpp", ".html",
  ".java", ".js", ".json", ".jsx", ".kt", ".lock", ".md", ".mjs", ".php",
  ".py", ".rb", ".rs", ".sh", ".sql", ".swift", ".toml", ".ts", ".tsx",
  ".txt", ".xml", ".yaml", ".yml",
]);
const ALLOWED_BASENAMES = new Set([
  "Dockerfile", "Makefile", "Procfile", ".gitignore", ".nvmrc", ".python-version",
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
]);
const SENSITIVE_PATH = /(?:^|\/)(?:\.env(?:\.|$)|secrets?(?:\/|$)|credentials?(?:\/|$)|private(?:\/|$)|node_modules(?:\/|$)|\.git(?:\/|$)|vendor(?:\/|$)|dist(?:\/|$)|build(?:\/|$))/i;
const SENSITIVE_EXTENSION = /\.(?:pem|key|p12|pfx|jks|keystore|sqlite|db)$/i;
const BLOCKED_COMMANDS = [
  /(?:^|[;&|]\s*)(?:sudo|su|shutdown|reboot|systemctl|mount|umount|mkfs(?:\.\w+)?|fdisk|iptables)\b/i,
  /\b(?:git\s+push|npm\s+publish|pnpm\s+publish|yarn\s+publish|vercel\s+deploy|terraform\s+(?:apply|destroy)|kubectl\s+(?:apply|delete))\b/i,
  /\b(?:curl|wget|nc|ncat|ssh|scp|ftp)\b/i,
];

const terminalToolDefinition = {
  type: "function",
  function: {
    name: "terminal_exec",
    description: "Executa um comando de diagnóstico ou validação no repositório GitHub que o usuário selecionou, dentro de um sandbox temporário sem rede e sem credenciais. Não publica, faz deploy, altera o repositório remoto nem acessa o servidor KAZER.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["command"],
      properties: {
        command: { type: "string", minLength: 1, maxLength: MAX_COMMAND_CHARS },
        workingDirectory: { type: "string", maxLength: 180, description: "Diretório relativo à raiz do workspace. Não use caminho absoluto." },
      },
    },
  },
};

function isTerminalConfigured() {
  return Boolean(String(process.env.E2B_API_KEY || "").trim());
}

function safeRepositoryIdentity(repository) {
  const fullName = String(repository?.fullName || "").trim();
  const branch = String(repository?.defaultBranch || "main").trim();
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName)) return null;
  if (!branch || branch.length > 120 || /[\u0000-\u001f\u007f]/.test(branch)) return null;
  const [owner, name] = fullName.split("/");
  return { owner, name, fullName, branch };
}

function safeRelativePath(value) {
  if (typeof value !== "string" || value.length > 180 || value.includes("\\") || value.startsWith("/")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalized = path.posix.normalize(value);
  if (normalized === "." || normalized === "") return "";
  if (normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

function safeWorkingDirectory(value) {
  const relative = safeRelativePath(value || "");
  if (relative === null) return null;
  return relative ? `${WORKSPACE_ROOT}/${relative}` : WORKSPACE_ROOT;
}

function isAllowedRepositoryFile(item) {
  if (!item || item.type !== "blob" || !Number.isFinite(Number(item.size))) return false;
  const relative = safeRelativePath(item.path);
  if (!relative || relative !== item.path || SENSITIVE_PATH.test(relative) || SENSITIVE_EXTENSION.test(relative)) return false;
  const basename = path.posix.basename(relative);
  const extension = path.posix.extname(basename).toLowerCase();
  if (!ALLOWED_BASENAMES.has(basename) && !ALLOWED_EXTENSIONS.has(extension)) return false;
  if (Number(item.size) < 1 || Number(item.size) > MAX_SOURCE_FILE_BYTES) return false;
  return true;
}

function filePriority(filePath) {
  const basename = path.posix.basename(filePath).toLowerCase();
  if (["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "pyproject.toml", "requirements.txt", "cargo.toml", "go.mod", "readme.md"].includes(basename)) return 0;
  if (/^(?:test|tests|spec|specs)\//i.test(filePath)) return 1;
  if (/^(?:src|app|lib|api|server)\//i.test(filePath)) return 2;
  return 3;
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await mapper(items[index], index);
    }
  }));
  return output;
}

async function fetchRepositoryFiles({ userId, repository }) {
  if (!userId) throw new Error("terminal_auth_required");
  const identity = safeRepositoryIdentity(repository);
  if (!identity) throw new Error("terminal_repository_invalid");
  const connection = await getConnection(userId).catch(() => null);
  const token = decodeToken(connection);
  if (!token) throw new Error("terminal_github_not_connected");

  const repoPath = `/repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.name)}`;
  const tree = await githubFetch(`${repoPath}/git/trees/${encodeURIComponent(identity.branch)}?recursive=1`, token);
  if (!Array.isArray(tree?.tree) || tree.truncated) throw new Error("terminal_repository_tree_unavailable");
  const candidates = tree.tree
    .filter(isAllowedRepositoryFile)
    .sort((left, right) => filePriority(left.path) - filePriority(right.path) || left.path.localeCompare(right.path))
    .slice(0, MAX_SOURCE_FILES);
  if (!candidates.length) throw new Error("terminal_repository_no_safe_files");

  const contents = await mapLimit(candidates, FILE_CONCURRENCY, async (entry) => {
    const contentPath = entry.path.split("/").map(encodeURIComponent).join("/");
    const file = await githubFetch(`${repoPath}/contents/${contentPath}?ref=${encodeURIComponent(identity.branch)}`, token);
    if (file?.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") return null;
    const bytes = Buffer.from(file.content.replace(/\s/g, ""), "base64");
    if (!bytes.length || bytes.length > MAX_SOURCE_FILE_BYTES) return null;
    const text = bytes.toString("utf8");
    if (text.includes("-----BEGIN ") && /PRIVATE KEY-----/.test(text)) return null;
    return { path: entry.path, data: redactSensitiveText(text) };
  });

  let totalBytes = 0;
  const files = [];
  for (const file of contents) {
    if (!file) continue;
    const size = Buffer.byteLength(file.data, "utf8");
    if (totalBytes + size > MAX_SOURCE_TOTAL_BYTES) continue;
    totalBytes += size;
    files.push(file);
  }
  if (!files.length) throw new Error("terminal_repository_no_safe_files");
  return files;
}

async function createE2BSandbox() {
  if (!isTerminalConfigured()) throw new Error("terminal_executor_not_configured");
  const sdk = await import("e2b");
  const Sandbox = sdk.Sandbox || sdk.default;
  if (!Sandbox?.create) throw new Error("terminal_executor_sdk_unavailable");
  return Sandbox.create({
    timeoutMs: SANDBOX_TIMEOUT_MS,
    allowInternetAccess: false,
    network: { denyOut: ["0.0.0.0/0"] },
    metadata: { application: "kazer-agent-terminal" },
  });
}

function validateTerminalArguments(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, error: "terminal_arguments_invalid" };
  const keys = Object.keys(args).sort();
  if (keys.some((key) => !["command", "workingDirectory"].includes(key))) return { ok: false, error: "terminal_arguments_invalid" };
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (!command || command.length > MAX_COMMAND_CHARS || command.includes("\u0000")) return { ok: false, error: "terminal_command_invalid" };
  const workingDirectory = safeWorkingDirectory(args.workingDirectory);
  if (!workingDirectory) return { ok: false, error: "terminal_working_directory_invalid" };
  if (BLOCKED_COMMANDS.some((pattern) => pattern.test(command))) return { ok: false, error: "terminal_operation_blocked" };
  return { ok: true, args: { command, workingDirectory } };
}

function trimOutput(value, maximumBytes = MAX_OUTPUT_BYTES) {
  const text = redactSensitiveText(String(value || ""));
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maximumBytes) return text;
  return `${buffer.subarray(0, maximumBytes).toString("utf8")}\n[saída truncada pelo limite do KAZER]`;
}

function publicErrorMessage(error) {
  const code = String(error?.message || "");
  const known = new Set([
    "terminal_auth_required",
    "terminal_repository_invalid",
    "terminal_github_not_connected",
    "terminal_repository_tree_unavailable",
    "terminal_repository_no_safe_files",
    "terminal_executor_not_configured",
    "terminal_executor_sdk_unavailable",
  ]);
  return known.has(code) ? code : "terminal_executor_failed";
}

async function executeTerminalCommand({ userId, repository, args }, dependencies = {}) {
  const validation = validateTerminalArguments(args);
  if (!validation.ok) return { state: "denied", error: validation.error, exitCode: null, stdout: "", stderr: "" };
  if (!dependencies.createSandbox && !isTerminalConfigured()) {
    return { state: "unavailable", error: "terminal_executor_not_configured", exitCode: null, stdout: "", stderr: "" };
  }

  const startedAt = Date.now();
  let sandbox;
  try {
    const readFiles = dependencies.fetchRepositoryFiles || fetchRepositoryFiles;
    const files = await readFiles({ userId, repository });
    const makeSandbox = dependencies.createSandbox || createE2BSandbox;
    sandbox = await makeSandbox();
    await sandbox.files.makeDir(WORKSPACE_ROOT);
    const directories = new Set();
    for (const file of files) {
      let directory = WORKSPACE_ROOT;
      const parent = path.posix.dirname(file.path);
      if (parent !== ".") {
        for (const segment of parent.split("/")) {
          directory = `${directory}/${segment}`;
          directories.add(directory);
        }
      }
    }
    for (const directory of [...directories].sort((left, right) => left.length - right.length)) {
      await sandbox.files.makeDir(directory);
    }
    await sandbox.files.write(files.map((file) => ({ path: `${WORKSPACE_ROOT}/${file.path}`, data: file.data })));
    const result = await sandbox.commands.run(validation.args.command, {
      cwd: validation.args.workingDirectory,
      timeoutMs: COMMAND_TIMEOUT_MS,
      envs: {},
    });
    return {
      state: result.exitCode === 0 ? "completed" : "error",
      command: validation.args.command,
      workingDirectory: validation.args.workingDirectory,
      exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
      stdout: trimOutput(result.stdout),
      stderr: trimOutput(result.stderr),
      durationMs: Date.now() - startedAt,
      filesPrepared: files.length,
      error: result.error ? trimOutput(result.error, 2_000) : null,
    };
  } catch (error) {
    const timedOut = /timeout|timed out|aborted/i.test(`${error?.name || ""} ${error?.message || ""}`);
    return {
      state: timedOut ? "timeout" : "error",
      command: validation.args.command,
      workingDirectory: validation.args.workingDirectory,
      exitCode: Number.isInteger(error?.exitCode) ? error.exitCode : null,
      stdout: trimOutput(error?.stdout),
      stderr: trimOutput(error?.stderr),
      durationMs: Date.now() - startedAt,
      filesPrepared: 0,
      error: publicErrorMessage(error),
    };
  } finally {
    if (sandbox?.kill) await sandbox.kill().catch(() => null);
  }
}

module.exports = {
  COMMAND_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
  WORKSPACE_ROOT,
  createE2BSandbox,
  executeTerminalCommand,
  fetchRepositoryFiles,
  isTerminalConfigured,
  safeRelativePath,
  safeWorkingDirectory,
  terminalToolDefinition,
  validateTerminalArguments,
};
