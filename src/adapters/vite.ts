/**
 * hidevars — Vite adapter.
 *
 * Usage:
 *   // vite.config.ts
 *   import hidevars from 'hidevars/vite'
 *   export default defineConfig({ plugins: [hidevars()] })
 *
 * Reads .env / .env.[mode] / .env.local / .env.[mode].local via Vite's
 * loadEnv(), decrypts any `hidevars('…')` placeholders using the project's
 * profile, and feeds the plain values into:
 *   - Vite's `define` map for keys matching `envPrefix` (client-exposed).
 *   - `process.env` for every key (server-side use in vite.config.ts, SSR).
 *
 * Security note: keys matching `envPrefix` (default `VITE_`) are inlined into
 * the browser bundle as plaintext. Do not encrypt server-only secrets under a
 * `VITE_*` name; they will become public.
 */

import path from 'node:path';
import type { Plugin } from 'vite' with { 'resolution-mode': 'import' };
import { decryptValue } from '../crypto';
import { openSession } from '../session';

const HIDEVARS_PATTERN = /^hidevars\(\s*'([^']*)'\s*\)$/;

interface HidevarsViteOptions {
  /** Directory containing the .env files. Defaults to Vite's `envDir` or root. */
  envDir?: string;
  /** Override the active profile (otherwise resolved from HIDEVARS_PROFILE / .hidevars). */
  profile?: string;
  /** Path to a non-default profiles.json file (test/CI use). */
  profilesFile?: string;
  /** Populate `process.env` with decrypted values (default: true). */
  loadServerVars?: boolean;
  /** Throw on decryption / session errors instead of warning and skipping (default: false). */
  failOnError?: boolean;
  /** Override the warning sink (default: stderr). */
  warn?: (message: string) => void;
}

function hidevars(options: HidevarsViteOptions = {}): Plugin {
  return {
    name: 'hidevars',
    enforce: 'pre',
    async config(userConfig, env) {
      const warn = options.warn ?? defaultWarn;
      const root = path.resolve(userConfig.root ?? process.cwd());
      const userEnvDir = userConfig.envDir === false ? undefined : userConfig.envDir;
      const envDir = path.resolve(root, options.envDir ?? userEnvDir ?? root);
      const prefixes = normalizePrefix(userConfig.envPrefix);

      // Vite is ESM-only; use dynamic import from our CJS build.
      // Structural type avoids the CJS-vs-ESM resolution-mode requirement.
      const vite = (await import('vite')) as {
        loadEnv: (mode: string, envDir: string, prefixes?: string | string[]) => Record<string, string>;
      };
      const all = vite.loadEnv(env.mode, envDir, '');

      const encryptedKeys: string[] = [];
      for (const [key, value] of Object.entries(all)) {
        if (HIDEVARS_PATTERN.test(value)) encryptedKeys.push(key);
      }

      const resolved: Record<string, string> = { ...all };

      if (encryptedKeys.length > 0) {
        let key: Buffer | null = null;
        try {
          const session = await openSession({
            cwd: root,
            profile: options.profile,
            profilesFile: options.profilesFile,
          });
          key = session.key;
        } catch (err) {
          const msg = `[hidevars] could not open profile session: ${describe(err)}; encrypted variables will be skipped`;
          if (options.failOnError) throw new Error(msg);
          warn(msg);
        }

        for (const name of encryptedKeys) {
          const match = HIDEVARS_PATTERN.exec(all[name] ?? '');
          if (!match || key === null) {
            delete resolved[name];
            continue;
          }
          try {
            const { plaintext } = decryptValue(match[1] ?? '', key);
            resolved[name] = plaintext;
          } catch (err) {
            const msg = `[hidevars] failed to decrypt "${name}": ${describe(err)}`;
            if (options.failOnError) throw new Error(msg);
            warn(msg);
            delete resolved[name];
          }
        }
      }

      if (options.loadServerVars !== false) {
        for (const [name, value] of Object.entries(resolved)) {
          const current = process.env[name];
          if (current === undefined || HIDEVARS_PATTERN.test(current)) {
            process.env[name] = value;
          }
        }
      }

      const define: Record<string, string> = {};
      for (const [name, value] of Object.entries(resolved)) {
        if (matchesPrefix(name, prefixes)) {
          define[`import.meta.env.${name}`] = JSON.stringify(value);
        }
      }

      return { define };
    },
  };
}

function normalizePrefix(prefix: string | string[] | undefined): string[] {
  if (prefix === undefined) return ['VITE_'];
  return Array.isArray(prefix) ? prefix : [prefix];
}

function matchesPrefix(key: string, prefixes: string[]): boolean {
  return prefixes.some((p) => p.length > 0 && key.startsWith(p));
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function defaultWarn(message: string): void {
  process.stderr.write(`${message}\n`);
}

// Merge the option type onto the default export so consumers can write
// `import hidevars from 'hidevars/vite'` and reference `hidevars.Options`.
namespace hidevars {
  export type Options = HidevarsViteOptions;
}

// `export =` (compiles to `module.exports = hidevars`) keeps ESM consumers
// importing the function directly, since Node's ESM-from-CJS interop returns
// `module.exports` as the default import.
export = hidevars;
