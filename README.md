# EnvSafe

Manage project environment variables with at-rest encryption of secret values.
Drop-in replacement for `dotenv`.

Secrets in `.env` are stored as opaque ciphertext (`API_KEY=envsafe('…')`) so
they cannot be read by AI assistants indexing the workspace, screen-sharing,
or accidental `cat .env`.

## Install

```bash
npm install envsafe
```

Requires Node.js ≥ 20.

## Quick start

```bash
npx envsafe init                       # pick/create a profile, scaffold .env, update .gitignore
npx envsafe set API_KEY my-s3cret      # encrypted (mode m) by default
npx envsafe set PUBLIC_URL:o https://… # plaintext entry
npx envsafe list                       # masked listing
```

In your application:

```js
const envsafe = require('envsafe');

async function main() {
  await envsafe.load();        // populates process.env with plain + decrypted values
  console.log(process.env.API_KEY);
}
```

## CLI

### `envsafe init`

Interactive. Picks an existing profile or creates a new one (prompting for
name + passphrase). Writes the project-local `.envsafe` pointer, ensures
`.env` and `.envsafe` are present in `.gitignore`, and either creates a fresh
`.env` template or migrates an existing `.env` by encrypting every value
(default display mode `m`). On migration, a `.env.bak` is written first and
removed on success; on failure the original is restored.

Re-running `init` in a project that is already configured offers to switch
profiles.

### `envsafe set NAME[:OPT] VALUE`

`OPT` is one of:

| Mode | Storage    | `list` rendering        |
|------|------------|-------------------------|
| `p`  | encrypted  | `**********`            |
| `m`  | encrypted  | `abc*******` (default)  |
| `o`  | plaintext  | the value, as-is        |

If `NAME` doesn't exist in `.env`, the line is appended; otherwise it is
replaced (the mode may change).

### `envsafe get NAME`

Prints the **decrypted plaintext** value to stdout. Suitable for scripting:

```bash
export API_KEY=$(envsafe get API_KEY)
```

Exits non-zero if the variable is unknown or decryption fails.

### `envsafe del NAME`

Removes `NAME` from `.env`.

### `envsafe list`

Prints every variable, rendered per its display mode.

## Library API

```ts
import { load, type LoadOptions, type LoadResult } from 'envsafe';

await load({
  cwd?: string,                  // defaults to process.cwd()
  profile?: string,              // override the .envsafe pointer
  env?: NodeJS.ProcessEnv,       // target env (default process.env)
  warn?: (msg: string) => void,  // default writes to stderr
}): Promise<{ loaded: string[]; failed: string[] }>
```

`load()` reads `.env`, passes through plain entries, and decrypts
`envsafe('…')` entries using the active profile's key. On a per-variable
decryption failure it emits one warning and leaves the variable undefined,
continuing with the rest. If the profile cannot be resolved at all, plain
entries are still loaded.

## How it works

### Files

| File                                      | Where                | Role                                                  | Committed? |
|-------------------------------------------|----------------------|-------------------------------------------------------|------------|
| `.env`                                    | project root         | variable storage (plain or `envsafe('<base64>')`)      | **no**     |
| `.envsafe`                                 | project root         | pointer: `profile=<name>`                             | **no**     |
| `~/.config/envsafe/profiles.json`          | per user             | passphrases, salts, KDF params (mode `0600`)          | **no**     |
| `%APPDATA%\envsafe\profiles.json`          | per user (Windows)   | same as above                                         | **no**     |

Profile selection: `envsafe_PROFILE` env var overrides the `.envsafe` file.

### Encryption

- **Cipher:** AES-256-GCM, fresh 12-byte IV per value, 16-byte auth tag.
- **KDF:** scrypt (N=2¹⁵, r=8, p=1) over the profile passphrase using the
  profile's stored salt.
- **Payload layout** (before base64): `[version:1][mode:1][iv:12][tag:16][ciphertext:N]`.

### Display mode

Modes `p` and `m` produce encrypted entries; the mode byte is embedded in
the payload, so re-running `set` swaps the rendering without re-keying.
Mode `o` stores the value as plaintext (no `envsafe(...)` wrapper).

## Security model

- **In scope:** local file readers (AI agents indexing the workspace,
  `cat .env`, screen sharing, accidental git tracking).
- **Out of scope:** an attacker with full read access to the user's home
  directory (the passphrase lives in `profiles.json` there), memory dumps
  of running processes, malicious processes running as the same OS user.

`envsafe` is single-user / per-machine. There is no v1 mechanism for sharing
secrets across a team; each developer initializes their own profile.

## Contributing

### Setup

```bash
git clone <repo-url>
cd envsafe
npm install        # also installs the Husky commit-msg hook
npm test
```

### Commit messages

Commits must follow the [Conventional Commits](https://www.conventionalcommits.org/)
specification. A `commit-msg` hook (Husky + commitlint with
`@commitlint/config-conventional`) rejects non-conforming messages locally.

| Type        | Effect on next release |
|-------------|------------------------|
| `feat:`     | minor bump             |
| `fix:`      | patch bump             |
| `perf:`     | patch bump             |
| `feat!:` / `fix!:` / `BREAKING CHANGE:` footer | major bump |
| `chore:`, `docs:`, `refactor:`, `test:`, `style:`, `build:`, `ci:` | no release |

Examples:

```
feat(cli): add envsafe rotate command
fix(crypto): tolerate trailing whitespace in passphrase
feat(api)!: rename load() option `profile` to `profileName`
```

## Releasing

Releases are fully automated by [semantic-release](https://semantic-release.gitbook.io/)
on every push to `master`.

The release workflow (`.github/workflows/release.yml`):

1. Runs `npm ci`, `npm run build`, `npm test`.
2. `commit-analyzer` reads commits since the last tag and decides the bump.
3. `release-notes-generator` renders Markdown notes.
4. `@semantic-release/changelog` updates `CHANGELOG.md`.
5. `@semantic-release/npm` bumps `package.json` and runs `npm publish` with
   provenance.
6. `@semantic-release/github` creates the GitHub Release.
7. `@semantic-release/git` commits `CHANGELOG.md` + `package.json` +
   `package-lock.json` back to `master` with `[skip ci]`.

If no commit since the last tag would change the version (e.g. only `chore:`
or `docs:` commits), no release is published.

### One-time repo setup

- **Secret `NPM_TOKEN`** — npm Automation token with publish scope.
- **Settings → Actions → General → Workflow permissions** → "Read and write
  permissions" (lets `@semantic-release/git` push the version-bump commit).
- **`repository` field in `package.json`** — required by
  `@semantic-release/github` to know which repo to release into.

## License

ISC — see [LICENSE](./LICENSE).
