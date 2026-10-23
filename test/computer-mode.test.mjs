import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const github = require('../server/integrations/_github-tools.js');
const vercel = require('../server/integrations/_vercel.js');
const { flattenTools } = require('../server/integrations/_mcp-runtime.js');

const names = (tools) => tools.map((tool) => tool.function.name);
const session = { token: 't', owner: 'o', name: 'r', base: '/repos/o/r', defaultBranch: 'main' };

test('chat normal expõe somente ferramentas GitHub de leitura', () => {
  const chat = names(github.githubToolDefinitions({ computer: false }));
  assert.ok(chat.includes('github_read_file'));
  assert.ok(!chat.some((name) => github.isGitHubWriteTool(name)));
  const computer = names(github.githubToolDefinitions({ computer: true }));
  assert.ok(computer.includes('github_write_file') && computer.includes('github_open_pull_request'));
});

test('escrita no GitHub é recusada fora do modo Computer', async () => {
  await assert.rejects(() => github.executeGitHubTool(session, 'github_write_file', { path: 'a.txt', content: 'x', message: 'm', branch: 'kazer/x' }, { computer: false }), /modo Computer/);
});

test('modo Computer nunca grava direto na branch padrão', async () => {
  await assert.rejects(() => github.executeGitHubTool(session, 'github_write_file', { path: 'a.txt', content: 'x', message: 'm', branch: 'main' }, { computer: true }), /branch padrão/);
  await assert.rejects(() => github.executeGitHubTool(session, 'github_create_branch', { branch: 'main' }, { computer: true }), /branch padrão/);
});

test('caminhos e branches maliciosos são rejeitados', () => {
  assert.equal(github.safePath('../etc/passwd'), null);
  assert.equal(github.safePath('src/../../x'), null);
  assert.equal(github.safePath('src/index.js'), 'src/index.js');
  assert.equal(github.safeBranch('feature/ok-1'), 'feature/ok-1');
  assert.equal(github.safeBranch('bad..branch'), null);
  assert.equal(github.safeBranch('/start'), null);
});

test('Vercel: redeploy só no modo Computer', async () => {
  assert.ok(!names(vercel.vercelToolDefinitions({ computer: false })).includes('vercel_redeploy'));
  assert.ok(names(vercel.vercelToolDefinitions({ computer: true })).includes('vercel_redeploy'));
  await assert.rejects(() => vercel.executeVercelTool({ token: 't' }, 'vercel_redeploy', { deploymentId: 'dpl_1' }, { computer: false }), /modo Computer/);
});

test('MCP: chat normal só recebe ferramentas readOnlyHint', () => {
  const servers = [{ id: 'abc', name: 'X', tools: [
    { name: 'read_thing', description: 'r', inputSchema: { type: 'object' }, readOnly: true },
    { name: 'delete_thing', description: 'd', inputSchema: { type: 'object' }, readOnly: false },
  ] }];
  assert.deepEqual(flattenTools(servers, { computer: false }).tools.map((tool) => tool.function.name.endsWith('read_thing')), [true]);
  assert.equal(flattenTools(servers, { computer: true }).tools.length, 2);
});
