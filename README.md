# scaffold-nuxt-4

[![Pipeline Status](https://img.shields.io/gitlab/pipeline-status/gitlab.com/thaikolja/scaffold-nuxt-4?branch=main)](https://gitlab.com/thaikolja/scaffold-nuxt-4/-/pipelines)
[![License](https://img.shields.io/gitlab/license/gitlab.com/thaikolja/scaffold-nuxt-4)](https://gitlab.com/thaikolja/scaffold-nuxt-4/-/blob/main/LICENSE)
![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-339933?logo=node.js)

Additive post-create scaffolder for Nuxt 4 projects. Copies only missing files from a template repository. Never overwrites. Feature‑gated (content + tailwind). CI-friendly JSON output. Designed to be boringly reliable.

## Why
You keep rebuilding the same `content/`, tailwind config, docs, and helper structure. This script clones a template (remote or local), classifies files, and only adds what you do not already have. Idempotent. Re-runnable without wrecking anything.

## Features
- Additive only: never overwrites existing files.
- Feature detection: `@nuxt/content`, `tailwindcss`.
- Force flags to include/exclude features regardless of dependencies.
- Positional target directory argument.
- Local or remote template repo (`SCAFFOLD_REPO_URL`).
- Shallow clone with optional sparse optimization + fallback.
- `--dry-run`, `--list`, `--json` for safe inspection + automation.
- ANSI color with opt-out (`--no-color` / `NO_COLOR=1`).
- Concurrency guard via `.scaffold-nuxt-4.lock` (best-effort).
- Clean removal of informational files (`--clean` for `INFO.md`).
- Node >= 18 enforced (top-level ESM, modern APIs).

## Install / Use
Direct (local copy in repo):
```bash
node scaffold.mjs
node scaffold.mjs ~/projects/my-nuxt
node scaffold.mjs --all --dry-run ./nuxt-app
node scaffold.mjs --json --all ./nuxt-app > scaffold-report.json
```
If you package later in npm:
```bash
npx @thaikolja/scaffold-nuxt-4
```

## Flags
| Flag | Description |
|------|-------------|
| `--all` | Force-enable all feature sets (content + tailwind) |
| `--with-content` / `--without-content` | Override content feature detection |
| `--with-tailwind` / `--without-tailwind` | Override tailwind detection |
| `-c`, `--clean` | Exclude all `INFO.md` files |
| `--dry-run` | Simulate additions (no writes) |
| `--list` | List classification of all template files |
| `--json` | Emit JSON summary (machine output) |
| `--debug` | Internal diagnostic output |
| `--no-color` | Disable ANSI colors |
| `-h`, `--help` | Show help |

## Positional Argument
Optional final argument = target path (default: current directory):
```bash
node scaffold.mjs ./some/nuxt/project
```
Tilde expansion supported:
```bash
node scaffold.mjs ~/dev/nuxt-site
```

## Environment Variables
| Variable | Purpose | Default |
|----------|---------|---------|
| `SCAFFOLD_REPO_URL` | Template repo (remote URL or absolute local path) | `https://gitlab.com/thaikolja/scaffold-nuxt-4.git` |
| `SCAFFOLD_REPO_REF` | Branch / tag / commit | `main` |
| `SCAFFOLD_FAST=1` | Enable sparse + blob-filter clone (auto fallback) | off |
| `NO_COLOR=1` | Disable color output | off |

## Output Modes
Human (default):
```
=== nuxt 4 scaffold ===
Added (or would add):
  + content/config.ts
...
Totals: added=5 skipped=2 excluded=3 errors=0
```
List mode:
```
node scaffold.mjs --list --all
[ADD] content/articles/hello.md
[EXCL-FEAT] tailwind.config.ts (tailwind-off)
...
```
JSON:
```bash
node scaffold.mjs --json --all > report.json
```
Sample structure:
```json
{
  "target": "/abs/path",
  "repo": "https://gitlab.com/thaikolja/scaffold-nuxt-4.git",
  "ref": "main",
  "mode": "full",
  "detected": { "content": false, "tailwind": false },
  "effective": { "content": true, "tailwind": true, "all": true, "cleanInfo": false, "dryRun": false, "listOnly": false },
  "counts": { "add": 7, "skip": 0, "excluded": 0, "errors": 0 },
  "added": ["content/index.md"],
  "actions": [ { "rel": "content/index.md", "action": "add" } ]
}
```

## Exit Codes
| Code | Meaning |
|------|---------|
| 0 | Success / help |
| 1 | Usage / configuration error |
| 2 | Template repository empty |
| 3 | Partial success with file copy errors |

## Template Strategy
Keep the template repo minimal and additive. No `package.json` or lock files unless you intend to exclude them anyway (they are auto-excluded).

## Recommended .gitignore Addition
```
.scaffold-nuxt-4.lock
```

## Typical Workflows
1. Basic scaffold:
   ```bash
   node scaffold.mjs
   ```
2. Force everything even if deps not installed:
   ```bash
   node scaffold.mjs --all
   ```
3. Preview without writing:
   ```bash
   node scaffold.mjs --all --dry-run
   ```
4. CI verification (JSON + error on file copy issues):
   ```bash
   node scaffold.mjs --json ./nuxt-app
   ```
5. Local template repo:
   ```bash
   SCAFFOLD_REPO_URL=/abs/path/to/template node scaffold.mjs --all
   ```

## Troubleshooting
| Symptom | Cause | Fix |
|---------|-------|-----|
| No files added, zero counts | Template empty or wrong URL | Check `SCAFFOLD_REPO_URL`, run `--debug` |
| All tailwind files excluded | Tailwind not detected | Install deps or use `--with-tailwind` |
| `git ... failed` | Missing Git or network/firewall | Install Git / verify remote reachability |
| Colors unwanted in CI | ANSI pollution | Use `--no-color` or `NO_COLOR=1` |
| Locked directory warning | Prior run crashed | Remove `.scaffold-nuxt-4.lock` |

## Safety Guarantees
- Never overwrites existing files.
- Exclusions are explicit and consistent.
- Fails fast on unusable target or empty template.
- Partial errors surface as exit code 3 with granular list.

## Roadmap (Optional)
- Glob-based feature groups
- Pluggable filters
- Overwrite whitelist flag (if you decide to allow it)

## License
MIT (see repository LICENSE file). Do what you want; just don’t blame this script when you point it at `/` and wonder why nothing happened.

## Minimal package.json Snippet (If Publishing)
```json
{
  "name": "@thaikolja/scaffold-nuxt-4",
  "version": "0.1.0",
  "type": "module",
  "bin": { "scaffold-nuxt-4": "scaffold.mjs" },
  "engines": { "node": ">=18" }
}
```

## Philosophy
Add the structural cruft once. Re-run safely. Ship faster. Avoid the ritualistic copy/paste liturgy.

---
If this script wakes you up at 3 AM, something upstream failed harder. This one is intentionally dull.
