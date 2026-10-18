import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  executeTerminalCommand,
  safeWorkingDirectory,
  terminalToolDefinition,
  validateTerminalArguments,
} = require('../api/_kazer-terminal.js');

test('terminal tool schema is narrow and command validation rejects path escape', () => {
  assert.equal(terminalToolDefinition.function.name, 'terminal_exec');
  assert.equal(validateTerminalArguments({ command: 'npm test', workingDirectory: 'src' }).ok, true);
  assert.equal(validateTerminalArguments({ command: 'npm test', workingDirectory: '../../etc' }).error, 'terminal_working_directory_invalid');
  assert.equal(validateTerminalArguments({ command: 'npm test', extra: 'value' }).error, 'terminal_arguments_invalid');
  assert.equal(validateTerminalArguments({ command: 'git push origin main' }).error, 'terminal_operation_blocked');
  assert.equal(validateTerminalArguments({ command: 'curl https://example.com' }).error, 'terminal_operation_blocked');
  assert.equal(safeWorkingDirectory('/etc'), null);
});

test('unconfigured executor returns unavailable without fetching repository files', async () => {
  let fetched = false;
  const result = await executeTerminalCommand(
    { userId: 'user-1', repository: { fullName: 'owner/repo', defaultBranch: 'main' }, args: { command: 'npm test' } },
    { fetchRepositoryFiles: async () => { fetched = true; return []; } },
  );
  assert.equal(result.state, 'unavailable');
  assert.equal(result.error, 'terminal_executor_not_configured');
  assert.equal(fetched, false);
});

test('authorized execution returns real exit state, redacts output and always kills sandbox', async () => {
  let killed = false;
  const madeDirs = [];
  const result = await executeTerminalCommand(
    { userId: 'user-1', repository: { fullName: 'owner/repo', defaultBranch: 'main' }, args: { command: 'npm test', workingDirectory: 'src' } },
    {
      fetchRepositoryFiles: async () => [{ path: 'src/package.json', data: '{"scripts":{"test":"node --test"}}' }],
      createSandbox: async () => ({
        files: {
          async makeDir(path) { madeDirs.push(path); },
          async write(files) { assert.equal(files[0].path, '/home/user/kazer-workspace/src/package.json'); },
        },
        commands: {
          async run(command, options) {
            assert.equal(command, 'npm test');
            assert.equal(options.cwd, '/home/user/kazer-workspace/src');
            assert.equal(options.timeoutMs, 20_000);
            assert.deepEqual(options.envs, {});
            return { exitCode: 0, stdout: 'ok sk' + '-12345678901234567890123456789012', stderr: '' };
          },
        },
        async kill() { killed = true; },
      }),
    },
  );
  assert.equal(result.state, 'completed');
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /\[chave removida\]/);
  assert.equal(result.filesPrepared, 1);
  assert.deepEqual(madeDirs, ['/home/user/kazer-workspace', '/home/user/kazer-workspace/src']);
  assert.equal(killed, true);
});

test('nonzero exit is not reported as success and sandbox is cleaned after failure', async () => {
  let killed = false;
  const result = await executeTerminalCommand(
    { userId: 'user-1', repository: { fullName: 'owner/repo', defaultBranch: 'main' }, args: { command: 'npm test' } },
    {
      fetchRepositoryFiles: async () => [{ path: 'package.json', data: '{}' }],
      createSandbox: async () => ({
        files: { async makeDir() {}, async write() {} },
        commands: { async run() { return { exitCode: 2, stdout: '', stderr: 'test failed' }; } },
        async kill() { killed = true; },
      }),
    },
  );
  assert.equal(result.state, 'error');
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, 'test failed');
  assert.equal(killed, true);
});
