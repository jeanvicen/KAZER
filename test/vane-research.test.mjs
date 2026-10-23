import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const vane = require('../server/research/_vane-sources.js');

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

test('classificador separa acadêmico, discussões, código e widgets', () => {
  const academic = vane.classifyQuestion('quais artigos científicos falam de sono e memória?');
  assert.equal(academic.academic, true);
  assert.equal(vane.classifyQuestion('o que a galera acha do Godot 4?').discussions, true);
  assert.equal(vane.classifyQuestion('erro de typescript no react').code, true);
  assert.equal(vane.classifyQuestion('previsão do tempo em Curitiba').weather, true);
  assert.equal(vane.classifyQuestion('oi').skipSearch, true);
  assert.equal(vane.classifyQuestion('quanto é 25% de 80').calculation, true);
  assert.equal(vane.classifyQuestion('a ação do filme foi boa').stock, false);
});

test('calculadora segura não executa código', () => {
  assert.equal(vane.evaluateExpression(vane.extractExpression('quanto é 25% de 80 + 2^3')), 28);
  assert.equal(vane.evaluateExpression('(2+3)*4'), 20);
  assert.throws(() => vane.evaluateExpression('process.exit()'));
  assert.equal(vane.extractExpression('me explique o universo'), null);
});

test('modos Free/Pro seguem o Vane (balanced x quality)', () => {
  assert.ok(vane.MODES.quality.searches > vane.MODES.balanced.searches);
  assert.ok(vane.MODES.quality.pages > vane.MODES.balanced.pages);
});

test('fontes especializadas usam só HTTPS e respeitam o modo', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('wikipedia.org')) return json({ query: { search: [{ title: 'Godot (game engine)', snippet: 'Free <b>engine</b>' }] } });
    if (value.includes('openalex.org')) return json({ results: [{ title: 'A study', doi: 'https://doi.org/10.1/x', publication_year: 2026, abstract_inverted_index: { Hello: [0], world: [1] } }, { title: 'bad', doi: 'http://insecure' }] });
    if (value.includes('arxiv.org')) return new Response('<feed></feed>');
    throw new Error('blocked');
  };
  const out = await vane.searchSpecializedSources('godot study', vane.classifyQuestion('artigos sobre godot'), 'balanced');
  assert.ok(out.items.some((item) => item.kind === 'wiki'));
  const paper = out.items.find((item) => item.kind === 'academic');
  assert.equal(paper.snippet, 'Hello world');
  assert.ok(out.items.every((item) => item.uri.startsWith('https://')));
  assert.ok(out.sourcesUsed.includes('academic'));
});
