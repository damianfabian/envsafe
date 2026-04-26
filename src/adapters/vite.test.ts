import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ConfigEnv, Plugin, UserConfig } from 'vite';
import hidevars from './vite';
import { runInit, type Prompter } from '../commands/init';
import { runSet } from '../commands/set';

let tmpDir: string;
let projectDir: string;
let profilesFile: string;
let warnings: string[];
let envSnapshot: NodeJS.ProcessEnv;

const baseEnv = { HIDEVARS_PROFILE: undefined } as NodeJS.ProcessEnv;

const prompter: Prompter = {
  pickOrCreateProfile: async () => ({ kind: 'create' }),
  newProfileName: async () => 'default',
  newPassphrase: async () => 'test-passphrase',
  confirmSwitchProfile: async () => true,
};

async function bootstrap(): Promise<void> {
  await runInit({ cwd: projectDir, profilesFile, prompter });
}

async function callConfig(
  plugin: Plugin,
  userConfig: UserConfig = {},
  env: ConfigEnv = { mode: 'development', command: 'serve' },
): Promise<UserConfig | null | void> {
  const hook = plugin.config;
  if (typeof hook !== 'function') throw new Error('plugin.config is not a function');
  return hook.call({} as never, { root: projectDir, ...userConfig }, env);
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hidevars-vite-'));
  projectDir = path.join(tmpDir, 'project');
  profilesFile = path.join(tmpDir, 'profiles.json');
  await fs.mkdir(projectDir, { recursive: true });
  warnings = [];
  envSnapshot = { ...process.env };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) {
    if (!(k in envSnapshot)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(envSnapshot)) {
    process.env[k] = v;
  }
});

describe('hidevars/vite', () => {
  it('decrypts VITE_-prefixed entries into the define map', async () => {
    await bootstrap();
    await runSet({ spec: 'VITE_API_URL', value: 'https://api.example.com', cwd: projectDir, profilesFile, env: baseEnv });

    const plugin = hidevars({ profilesFile, loadServerVars: false, warn: (m) => warnings.push(m) });
    const result = await callConfig(plugin);

    expect(result).toEqual({
      define: {
        'import.meta.env.VITE_API_URL': JSON.stringify('https://api.example.com'),
      },
    });
    expect(warnings).toEqual([]);
  });

  it('passes plain entries through as well', async () => {
    await bootstrap();
    await runSet({ spec: 'VITE_PUBLIC:o', value: 'visible', cwd: projectDir, profilesFile, env: baseEnv });

    const plugin = hidevars({ profilesFile, loadServerVars: false });
    const result = (await callConfig(plugin)) as UserConfig;

    expect(result.define).toMatchObject({
      'import.meta.env.VITE_PUBLIC': JSON.stringify('visible'),
    });
  });

  it('omits non-VITE_ keys from define but populates process.env when loadServerVars=true', async () => {
    await bootstrap();
    await runSet({ spec: 'API_KEY', value: 's3cret', cwd: projectDir, profilesFile, env: baseEnv });
    await runSet({ spec: 'VITE_FOO', value: 'public-ish', cwd: projectDir, profilesFile, env: baseEnv });

    const plugin = hidevars({ profilesFile });
    const result = (await callConfig(plugin)) as UserConfig;

    expect(Object.keys(result.define ?? {})).toEqual(['import.meta.env.VITE_FOO']);
    expect(process.env.API_KEY).toBe('s3cret');
    expect(process.env.VITE_FOO).toBe('public-ish');
  });

  it('honors a custom envPrefix from userConfig', async () => {
    await bootstrap();
    await runSet({ spec: 'APP_TOKEN', value: 'abc', cwd: projectDir, profilesFile, env: baseEnv });

    const plugin = hidevars({ profilesFile, loadServerVars: false });
    const result = (await callConfig(plugin, { envPrefix: 'APP_' })) as UserConfig;

    expect(result.define).toEqual({
      'import.meta.env.APP_TOKEN': JSON.stringify('abc'),
    });
  });

  it('warns and skips encrypted vars when the session cannot be opened', async () => {
    await bootstrap();
    await runSet({ spec: 'VITE_SECRET', value: 'nope', cwd: projectDir, profilesFile, env: baseEnv });
    await fs.writeFile(path.join(projectDir, '.hidevars'), 'profile=missing\n');

    const plugin = hidevars({ profilesFile, loadServerVars: false, warn: (m) => warnings.push(m) });
    const result = (await callConfig(plugin)) as UserConfig;

    expect(result.define).toEqual({});
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/could not open profile session/);
  });

  it('throws on session failure when failOnError=true', async () => {
    await bootstrap();
    await runSet({ spec: 'VITE_X', value: '1', cwd: projectDir, profilesFile, env: baseEnv });
    await fs.writeFile(path.join(projectDir, '.hidevars'), 'profile=missing\n');

    const plugin = hidevars({ profilesFile, loadServerVars: false, failOnError: true });
    await expect(callConfig(plugin)).rejects.toThrow(/could not open profile session/);
  });

  it('returns an empty define map when there are no env files', async () => {
    await bootstrap();
    await fs.unlink(path.join(projectDir, '.env')).catch(() => {});

    const plugin = hidevars({ profilesFile, loadServerVars: false });
    const result = (await callConfig(plugin)) as UserConfig;

    expect(result.define).toEqual({});
  });
});
