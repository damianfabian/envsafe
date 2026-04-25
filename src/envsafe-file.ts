import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PROJECT_envsafe_FILE } from './paths';
import { isValidProfileName } from './profile-store';

const HEADER = '# SaveEnv Profile';

export interface envsafePointer {
  profile: string;
}

export function envsafeFilePath(projectDir: string): string {
  return path.join(projectDir, PROJECT_envsafe_FILE);
}

export async function readenvsafeFile(projectDir: string): Promise<envsafePointer | null> {
  const filePath = envsafeFilePath(projectDir);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const profile = parseProfile(raw);
  if (profile === null) {
    throw new Error(`malformed ${PROJECT_envsafe_FILE}: missing "profile=" entry`);
  }
  if (!isValidProfileName(profile)) {
    throw new Error(`malformed ${PROJECT_envsafe_FILE}: invalid profile name "${profile}"`);
  }
  return { profile };
}

export async function writeenvsafeFile(projectDir: string, pointer: envsafePointer): Promise<void> {
  if (!isValidProfileName(pointer.profile)) {
    throw new Error(`invalid profile name: "${pointer.profile}"`);
  }
  const content = `${HEADER}\nprofile=${pointer.profile}\n`;
  await fs.writeFile(envsafeFilePath(projectDir), content, 'utf8');
}

function parseProfile(raw: string): string | null {
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'profile') return value;
  }
  return null;
}
