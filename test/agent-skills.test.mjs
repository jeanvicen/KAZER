import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  loadAgentSkill,
  safeReadSkillFile,
  selectAgentSkill,
  skillDeclaresPermission,
} = require('../server/agent/_kazer-skills.js');

test('skills are selected from task intent, not from a client-supplied skill id', () => {
  assert.equal(selectAgentSkill({ text: 'Quanto custa este modelo hoje?', taskType: 'analysis', needsResearch: true }), 'kazer-research');
  assert.equal(selectAgentSkill({ text: 'Corrija este bug', taskType: 'coding' }), 'kazer-code');
  assert.equal(selectAgentSkill({ text: 'Faça uma auditoria de segurança', taskType: 'coding' }), 'kazer-security');
  assert.equal(selectAgentSkill({ text: 'Escreva um relatório', taskType: 'analysis' }), 'kazer-docs');
  assert.equal(selectAgentSkill({ text: 'Defina o pricing e lançamento', taskType: 'analysis' }), 'kazer-growth');
  assert.equal(selectAgentSkill({ text: 'Crie uma tela visual', taskType: 'visual' }), 'kazer-design-system');
  assert.equal(selectAgentSkill({ text: 'Quanto é 2 + 2?', taskType: 'conversation' }), null);
});

test('every allowlisted skill loads its prompt and references with verified permissions', () => {
  const expected = {
    'kazer-research': ['web.read', 'net.fetch'],
    'kazer-security': ['shell.exec', 'code.run', 'net.fetch'],
    'kazer-code': ['code.run', 'files.write', 'shell.exec'],
    'kazer-docs': ['files.write', 'web.read'],
    'kazer-growth': ['web.read', 'files.write'],
    'kazer-design-system': [],
  };
  for (const [slug, permissions] of Object.entries(expected)) {
    const skill = loadAgentSkill(slug);
    assert.equal(skill.slug, slug);
    assert.deepEqual(skill.permissions, permissions);
    assert.match(skill.prompt, /^# Skill /);
    assert.match(skill.prompt, /não concedem acesso a ferramentas/i);
  }
  assert.equal(loadAgentSkill('unknown-skill'), null);
});

test('Skill declarations are not authority to grant tools', () => {
  const code = loadAgentSkill('kazer-code');
  assert.equal(skillDeclaresPermission(code, 'shell.exec'), true);
  assert.equal(skillDeclaresPermission(code, 'net.fetch'), false);
  assert.equal(skillDeclaresPermission(code, 'admin'), false);
  assert.equal(skillDeclaresPermission(null, 'shell.exec'), false);
});

test('skill asset paths cannot escape their allowlisted directory', () => {
  assert.throws(() => safeReadSkillFile('kazer-code', '../kazer-security/SKILL.md'), /skill_path_invalid/);
  assert.throws(() => safeReadSkillFile('unknown-skill', 'SKILL.md'), /skill_not_allowlisted/);
});

test('Vercel bundles the server-side Skill assets with the chat function', () => {
  const config = require('../vercel.json');
  assert.equal(config.functions['api/chat.js'].includeFiles, 'skills/**');
});
