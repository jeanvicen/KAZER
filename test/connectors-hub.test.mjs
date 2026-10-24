import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const hub = require('../server/integrations/_connectors-hub.js');
const flame = require('../server/agent/_flame-api.js');
const byId = (id) => hub.CATALOG.find((item) => item.id === id);

test('catálogo traz muitos serviços oficiais com host HTTPS fixo', () => {
  assert.ok(hub.CATALOG.length >= 40);
  const ids = new Set();
  for (const item of hub.CATALOG) {
    assert.ok(!ids.has(item.id), `id duplicado: ${item.id}`);
    ids.add(item.id);
    if (item.api?.base) assert.match(item.api.base, /^https:\/\//);
    if (item.tokenPage) assert.match(item.tokenPage, /^https:\/\//);
    if (item.oauth) assert.match(item.oauth.authorize, /^https:\/\//);
  }
});

test('caminhos nunca saem do host oficial', () => {
  const notion = byId('notion');
  assert.equal(hub.buildUrl(notion, { token: 'x' }, '/users/me').toString(), 'https://api.notion.com/v1/users/me');
  assert.equal(hub.buildUrl(notion, { token: 'x' }, '//evil.com/x').host, 'api.notion.com');
  assert.throws(() => hub.buildUrl(notion, { token: 'x' }, '/../../x'));
  const jira = byId('atlassian');
  assert.equal(hub.apiBase(jira, { site: 'empresa.atlassian.net' }), 'https://empresa.atlassian.net');
  assert.throws(() => hub.apiBase(jira, { site: 'evil.com' }));
  assert.throws(() => hub.apiBase({ id: 'custom:x' }, { baseUrl: 'https://127.0.0.1/api' }));
});

test('credenciais vão no formato oficial de cada serviço', () => {
  assert.deepEqual(hub.authHeaders(byId('notion'), { token: 'abc' }), { Authorization: 'Bearer abc' });
  assert.deepEqual(hub.authHeaders(byId('linear'), { token: 'abc' }), { Authorization: 'abc' });
  assert.deepEqual(hub.authHeaders(byId('figma'), { token: 'abc' }), { 'X-Figma-Token': 'abc' });
  assert.equal(hub.authHeaders(byId('twilio'), { username: 'u', password: 'p' }).Authorization, `Basic ${Buffer.from('u:p').toString('base64')}`);
  assert.equal(hub.buildUrl(byId('telegram'), { token: '1:a', auth: 'telegram' }, '/getMe').pathname, '/bot1:a/getMe');
});

test('chat normal só lê; Computer libera escrita', () => {
  const session = { userId: 'u', connections: [{ provider: 'notion', account_label: 'Ana' }] };
  const chatTool = hub.connectorToolDefinitions(session, { computer: false })[0].function;
  assert.deepEqual(chatTool.parameters.properties.method.enum, ['GET', 'POST']);
  assert.ok(hub.connectorToolDefinitions(session, { computer: true })[0].function.parameters.properties.method.enum.includes('DELETE'));
  assert.deepEqual(hub.connectorToolDefinitions(null), []);
  const linear = byId('linear');
  assert.equal(hub.isReadOnlyCall(linear, 'POST', '/graphql', { query: '{ viewer { name } }' }), true);
  assert.equal(hub.isReadOnlyCall(linear, 'POST', '/graphql', { query: 'mutation { issueCreate }' }), false);
  assert.equal(hub.isReadOnlyCall(byId('stripe'), 'POST', '/charges', {}), false);
  assert.equal(hub.isReadOnlyCall(byId('stripe'), 'GET', '/balance'), true);
});

test('cliente nunca recebe segredos e vê OAuth só quando configurado', () => {
  const list = hub.catalogForClient([{ provider: 'notion', account_label: 'Ana' }]);
  const notion = list.find((item) => item.id === 'notion');
  assert.equal(notion.connected, true);
  assert.equal(notion.oauth, false);
  assert.ok(!JSON.stringify(list).includes('secret_encrypted'));
  process.env.KAZER_OAUTH_NOTION_CLIENT_ID = 'id';
  process.env.KAZER_OAUTH_NOTION_CLIENT_SECRET = 'secret';
  assert.equal(hub.catalogForClient([]).find((item) => item.id === 'notion').oauth, true);
  delete process.env.KAZER_OAUTH_NOTION_CLIENT_ID;
  delete process.env.KAZER_OAUTH_NOTION_CLIENT_SECRET;
});

test('instruções pedem cartão seguro e proíbem segredos no chat', () => {
  const text = hub.connectorsInstruction(null);
  assert.match(text, /kazer-connect/);
  assert.match(text, /nunca peça senha/i);
});

test('Flame API tem muitos provedores com lista de modelos', () => {
  const providers = Object.entries(flame.PRESETS).filter(([id]) => id !== 'custom');
  assert.ok(providers.length >= 18);
  for (const [, preset] of providers) {
    assert.match(preset.baseUrl, /^https:\/\//);
    assert.ok(preset.models.includes(preset.model));
  }
});
