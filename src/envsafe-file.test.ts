import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readenvsafeFile, envsafeFilePath, writeenvsafeFile } from './envsafe-file';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'envsafe-pointer-'));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('envsafe-file', () => {
  it('returns null when missing', async () => {
    expect(await readenvsafeFile(tmpDir)).toBeNull();
  });

  it('round-trips a profile pointer', async () => {
    await writeenvsafeFile(tmpDir, { profile: 'work' });
    const back = await readenvsafeFile(tmpDir);
    expect(back).toEqual({ profile: 'work' });
  });

  it('writes the documented header + profile= line', async () => {
    await writeenvsafeFile(tmpDir, { profile: 'default' });
    const raw = await fs.readFile(envsafeFilePath(tmpDir), 'utf8');
    expect(raw).toBe('# SaveEnv Profile\nprofile=default\n');
  });

  it('rejects an invalid profile name on write', async () => {
    await expect(writeenvsafeFile(tmpDir, { profile: 'bad name' })).rejects.toThrow(/invalid profile/);
  });

  it('rejects an invalid profile name on read', async () => {
    await fs.writeFile(envsafeFilePath(tmpDir), 'profile=bad name\n');
    await expect(readenvsafeFile(tmpDir)).rejects.toThrow(/invalid profile/);
  });

  it('throws when no profile= line is present', async () => {
    await fs.writeFile(envsafeFilePath(tmpDir), '# only a comment\n');
    await expect(readenvsafeFile(tmpDir)).rejects.toThrow(/missing/);
  });

  it('ignores extra comments and blank lines', async () => {
    await fs.writeFile(
      envsafeFilePath(tmpDir),
      '# header\n\n# more\nprofile=work\n# trailing\n',
    );
    expect((await readenvsafeFile(tmpDir))?.profile).toBe('work');
  });
});
