import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

const requiredFiles = [
  '.env.example',
  '.nvmrc',
  'README.md',
  'CHANGELOG.md',
  'vercel.json',
  'interface/login.html',
  'interface/chat.html',
  'api/chat.js',
  'server/security/_security.js',
  'server/README.md',
  'server/agent/_kazer-brain.js',
  'server/integrations/_github.js',
  'server/research/_research-orchestrator.js',
  'server/storage/_kazer-data.js',
  'server/tasks/_tasks-handler.js',
  'server/usage/_usage.js',
  'docs/project-guide.md',
  '.github/workflows/ci.yml',
];

test('arquivos essenciais do projeto existem', () => {
  for (const file of requiredFiles) {
    assert.equal(existsSync(resolve(root, file)), true, `arquivo ausente: ${file}`);
  }
});

test('api/ contém rotas finas e a lógica fica em server/', () => {
  const implementation = require('../server/security/_security.js');
  assert.equal(typeof implementation.redactSensitiveText, 'function');
  assert.equal(existsSync(resolve(root, 'api/_security.js')), false);
  assert.match(read('api/chat.js'), /require\(\"\.\.\/server\/security\/_security/);
});

test('package declara runtime, licença e scripts de qualidade', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.engines.node, '>=20');
  assert.equal(pkg.license, 'UNLICENSED');
  for (const script of ['test', 'check', 'security:audit']) {
    assert.equal(typeof pkg.scripts[script], 'string', `script ausente: ${script}`);
  }
});

test('o exemplo de ambiente não contém credenciais reais', () => {
  const env = read('.env.example');
  assert.doesNotMatch(env, /sk-[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(env, /-----BEGIN (?:RSA|EC|OPENSSH) PRIVATE KEY-----/);
});

test('o workflow executa os gates de qualidade', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm run security:audit/);
  assert.match(workflow, /pull_request:/);
});
