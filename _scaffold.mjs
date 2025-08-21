#!/usr/bin/env node
/**
 * thaikolja/scaffold-nuxt-4  (ESM, positional target path)
 *
 * Additive Nuxt 4 scaffolder (repo-driven).
 * Fixes:
 *  - Removed brittle sparse/filtered clone default (was producing zero files in some Git setups).
 *  - Added automatic fallback: if optimized clone (when enabled) yields zero template files, redo full clone.
 *  - Positional path retained: node scaffold.mjs /absolute/or/relative/path/to/nuxt
 *
 * Production Hardening Additions:
 *  - Node version guard (>=18).
 *  - Exit codes consolidated + documented.
 *  - Optional JSON output (--json) for CI/pipelines.
 *  - Color suppression via --no-color or NO_COLOR env.
 *  - Concurrency guard via .scaffold-nuxt-4.lock (best-effort).
 *  - Explicit failure if template path == target path.
 *  - Safer error channel + structured log points.
 *
 * Flags:
 *   --all
 *   --with-content / --without-content
 *   --with-tailwind / --without-tailwind
 *   -c / --clean           Exclude INFO.md
 *   --dry-run              Simulate (no writes)
 *   --list                 Classification only (no writes)
 *   --json                 Machine-readable summary output (suppresses human output)
 *   --debug                Internal state
 *   --no-color             Disable ANSI colors (also honored: NO_COLOR env)
 *   -h / --help
 *
 * Env:
 *   SCAFFOLD_REPO_URL   Remote or local path (default below)
 *   SCAFFOLD_REPO_REF   Branch/tag/commit (default: main)
 *   SCAFFOLD_FAST=1     Use optimized shallow clone (sparse + blob filter) with fallback
 *   NO_COLOR=1          Disable color (flags override)
 *
 * Usage:
 *   node scaffold.mjs
 *   node scaffold.mjs ./nuxt-app
 *   node scaffold.mjs --all --dry-run ~/nuxt
 *   node scaffold.mjs --json --all ./nuxt-app
 */

// Import the 'fs' module for file system operations.
import fs          from 'fs';
// Import the 'path' module for path manipulation.
import path        from 'path';
// Import the 'os' module for operating system-related utility methods.
import os          from 'os';
// Import 'spawnSync' from 'child_process' to execute synchronous child processes.
import {spawnSync} from 'child_process';
// Import the 'process' module to interact with the current Node.js process.
import process     from 'process';

// ---------------- NODE VERSION GUARD ----------------
/**
 * Ensures the running Node.js version meets the minimum requirement.
 */
(function enforceNodeVersion() {
  const MIN_NODE_MAJOR = 18;
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    console.error(`ERROR: Node.js >= ${MIN_NODE_MAJOR} required. Detected ${process.versions.node}`);
    process.exit(1);
  }
})();

// ---------------- EXIT CODES ----------------
/**
 * Standardized exit codes for external automation consumption.
 * 0: success / help
 * 1: configuration / usage error
 * 2: empty template repository
 * 3: file copy errors (partial success)
 */
const EXIT = {
  OK:             0,
  USAGE_ERROR:    1,
  TEMPLATE_EMPTY: 2,
  FILE_ERRORS:    3
};

// ---------------- ARG PARSE ----------------
// Get raw command-line arguments, excluding 'node' and the script name.
const rawArgs = process.argv.slice(2);
// Initialize an array to store positional arguments.
const positional = [];
// Initialize a Set to store flags (arguments starting with '-').
const flags = new Set();
// Iterate over each raw argument to separate positional arguments and flags.
for (const a of rawArgs) {
  if (a.startsWith('-')) flags.add(a);
  else positional.push(a);
}
// Check if more than one positional path is provided.
if (positional.length > 1) {
  console.error('ERROR: Only one positional path allowed.');
  process.exit(EXIT.USAGE_ERROR);
}

// Check if the help flag is present.
const wantHelp = flags.has('-h') || flags.has('--help');
const cleanInfo = flags.has('-c') || flags.has('--clean');
const listOnly = flags.has('--list');
const dryRun = flags.has('--dry-run');
const debug = flags.has('--debug');
const forceAll = flags.has('--all');
const overrideWithContent = flags.has('--with-content');
const overrideWithoutContent = flags.has('--without-content');
const overrideWithTailwind = flags.has('--with-tailwind');
const overrideWithoutTailwind = flags.has('--without-tailwind');
const jsonOutput = flags.has('--json');
const disableColorFlag = flags.has('--no-color');
const noColorEnv = !!process.env.NO_COLOR;
const wantColor = !(disableColorFlag || noColorEnv);

// Check if the user wants to display help information.
if (wantHelp) {
  console.log(`
Scaffold Nuxt 4 (additive, repo-driven).

Usage:
  node scaffold.mjs [flags] [targetPath]

Flags:
  --all
  --with-content / --without-content
  --with-tailwind / --without-tailwind
  -c, --clean       Exclude INFO.md
  --dry-run         Simulate only
  --list            Classification only
  --json            JSON summary output (no human text)
  --debug           Internal state
  --no-color        Disable color
  -h, --help        Help

Env:
  SCAFFOLD_REPO_URL   Template repo or local dir
  SCAFFOLD_REPO_REF   Branch/tag/commit (default: main)
  SCAFFOLD_FAST=1     Use sparse+filter clone with auto-fallback
  NO_COLOR=1          Disable color
`);
  process.exit(EXIT.OK);
}

// Check for mutual exclusivity of flags.
if (overrideWithContent && overrideWithoutContent) {
  console.error('ERROR: --with-content and --without-content are mutually exclusive.');
  process.exit(EXIT.USAGE_ERROR);
}
if (overrideWithTailwind && overrideWithoutTailwind) {
  console.error('ERROR: --with-tailwind and --without-tailwind are mutually exclusive.');
  process.exit(EXIT.USAGE_ERROR);
}

// ---------------- PATH RESOLUTION ----------------
/**
 * Expands a tilde (~) in a path to the user's home directory.
 * @param {string} p - The path to expand.
 * @returns {string} The expanded path.
 */
function expandTilde(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Resolve the target root path; if no positional argument, use current working directory.
const targetRoot = positional.length
    ? path.resolve(expandTilde(positional[0]))
    : process.cwd();

// Check if the target root path exists and is a directory.
if (!fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
  console.error('ERROR: Target path not a directory:', targetRoot);
  process.exit(EXIT.USAGE_ERROR);
}

// ---------------- LOCK (BEST-EFFORT) ----------------
/**
 * Prevents concurrent runs in the same target directory.
 */
const LOCK_NAME = '.scaffold-nuxt-4.lock';
const lockPath = path.join(targetRoot, LOCK_NAME);
let lockAcquired = false;
try {
  const fd = fs.openSync(lockPath, fs.existsSync(lockPath) ? 'r+' : 'wx');
  fs.writeFileSync(fd, String(process.pid));
  lockAcquired = true;
} catch {
  // Non-fatal; continue. Concurrency risk accepted.
}

// ---------------- NUXT DETECTION ----------------
const pkgPath = path.join(targetRoot, 'package.json');
if (!fs.existsSync(pkgPath)) {
  console.error('ERROR: package.json missing in target:', targetRoot);
  process.exit(EXIT.USAGE_ERROR);
}
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
} catch {
  console.error('ERROR: Failed to parse package.json.');
  process.exit(EXIT.USAGE_ERROR);
}
const hasNuxtConfig = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs']
    .some(f => fs.existsSync(path.join(targetRoot, f)));
if (!hasNuxtConfig) {
  console.error('ERROR: nuxt.config.* missing in target path.');
  process.exit(EXIT.USAGE_ERROR);
}
const deps = {...(pkg.dependencies || {}), ...(pkg.devDependencies || {})};
const detectedContent = !!deps['@nuxt/content'];
const detectedTailwind = !!deps['tailwindcss'];

const effectiveContent = forceAll
    ? true
    : overrideWithContent
        ? true
        : overrideWithoutContent
            ? false
            : detectedContent;

const effectiveTailwind = forceAll
    ? true
    : overrideWithTailwind
        ? true
        : overrideWithoutTailwind
            ? false
            : detectedTailwind;

// ---------------- CONFIG ----------------
const DEFAULT_REPO_URL = 'https://gitlab.com/thaikolja/scaffold-nuxt-4.git';
const REPO_URL = process.env.SCAFFOLD_REPO_URL || DEFAULT_REPO_URL;
const REPO_REF = process.env.SCAFFOLD_REPO_REF || 'main';
const USE_OPTIMIZED = process.env.SCAFFOLD_FAST === '1';

// ---------------- HELPERS ----------------
/**
 * Applies ANSI color codes to a string if the output is a TTY.
 * @param {number} code - The ANSI color code.
 * @param {string} str - The string to color.
 * @returns {string} The colored string or original string.
 */
function color(code, str) {
  return (process.stdout.isTTY && wantColor) ? `\x1b[${code}m${str}\x1b[0m` : str;
}

const green = s => color(32, s);
const yellow = s => color(33, s);
const cyan = s => color(36, s);
const magenta = s => color(35, s);
const red = s => color(31, s);
const dim = s => color(2, s);

/**
 * Checks if a relative path corresponds to a content-related file.
 * @param {string} rel - The relative file path.
 * @returns {boolean} True if it's a content file, false otherwise.
 */
const isContentFile = rel =>
    rel === 'content.config.ts' ||
    rel.startsWith('content/') ||
    rel.startsWith('content\\');
/**
 * Checks if a relative path corresponds to a Tailwind CSS related file.
 * @param {string} rel - The relative file path.
 * @returns {boolean} True if it's a Tailwind file, false otherwise.
 */
const isTailwindFile = rel =>
    rel === 'tailwind.config.ts';
/**
 * Checks if a relative path corresponds to the INFO.md file.
 * @param {string} rel - The relative file path.
 * @returns {boolean} True if it's the INFO.md file, false otherwise.
 */
const isInfoFile = rel => path.basename(rel) === 'INFO.md';

// Define a set of files that should always be excluded from scaffolding.
const ALWAYS_EXCLUDE = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb'
]);

/**
 * Executes a Git command synchronously.
 * @param {string[]} args - Arguments for the Git command.
 * @param {string} cwd - The current working directory for the command.
 * @returns {string} The standard output of the command.
 * @throws {Error} If the Git command fails.
 */
function execGit(args, cwd) {
  const res = spawnSync('git', args, {
    cwd,
    stdio:    ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr.trim() || res.stdout.trim()}`);
  }
  return res.stdout.trim();
}

/**
 * Checks if Git is available in the system's PATH.
 * @returns {boolean} True if Git is available, false otherwise.
 */
function gitAvailable() {
  try {
    execGit(['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walks a directory recursively and returns a list of relative paths to all files,
 * excluding .git and node_modules directories.
 * @param {string} dir - The directory to walk.
 * @returns {string[]} An array of relative file paths.
 */
function walk(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, {withFileTypes: true});
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const full = path.join(cur, e.name);
      const rel = path.relative(dir, full);
      if (!rel) continue;
      if (e.isDirectory()) stack.push(full);
      else out.push(rel);
    }
  }
  return out;
}

/**
 * Ensures that the directory containing the given path exists, creating it if necessary.
 * @param {string} p - The file path for which to ensure the parent directory exists.
 */
function ensureDir(p) {
  const d = path.dirname(p);
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, {recursive: true});
  }
}

/**
 * Checks if a given URL is a remote Git repository URL.
 * @param {string} url - The URL to check.
 * @returns {boolean} True if the URL is remote, false otherwise.
 */
function isRemote(url) {
  return /^(?:git@|https?:\/\/)/i.test(url);
}

// ---------------- CLONE LOGIC ----------------
let cloneDir;
let tempRoot;
let files = [];

/**
 * Attempts to clone the repository, with an option for optimized cloning.
 * @param {object} options - Options for the clone.
 * @param {boolean} options.optimized - Whether to perform an optimized shallow clone.
 * @returns {{dir: string, optimized: boolean}} An object containing the clone directory and whether optimized was used.
 * @throws {Error} If Git is not available or the local template path is not found.
 */
function attemptClone({optimized}) {
  if (!isRemote(REPO_URL)) {
    const local = path.resolve(expandTilde(REPO_URL));
    if (!fs.existsSync(local)) throw new Error(`Local template path not found: ${local}`);
    return {dir: local, optimized: false};
  }
  if (!gitAvailable()) throw new Error('Git not found in PATH.');
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt4-scaffold-'));
  const dir = path.join(tempRoot, 'repo');

  if (optimized) {
    execGit(['clone', '--depth=1', '--no-tags', '--filter=blob:none', '--sparse', REPO_URL, dir]);
    try {
      execGit(['sparse-checkout', 'set', '--no-cone', '.'], dir);
    } catch {
      // ignore
    }
    if (REPO_REF !== 'main') {
      execGit(['fetch', '--depth=1', 'origin', REPO_REF], dir);
      execGit(['checkout', REPO_REF], dir);
    }
  } else {
    execGit(['clone', '--depth=1', '--no-tags', REPO_URL, dir]);
    if (REPO_REF !== 'main') {
      execGit(['fetch', '--depth=1', 'origin', REPO_REF], dir);
      execGit(['checkout', REPO_REF], dir);
    }
  }
  return {dir, optimized};
}

// Prevent self-target (template == target)
if (!isRemote(REPO_URL)) {
  const templateAbs = path.resolve(expandTilde(REPO_URL));
  if (templateAbs === targetRoot) {
    console.error('ERROR: Template path and target path are identical.');
    process.exit(EXIT.USAGE_ERROR);
  }
}

// Clone
let cloneMeta;
try {
  cloneMeta = attemptClone({optimized: USE_OPTIMIZED});
  cloneDir = cloneMeta.dir;
  files = walk(cloneDir);

  if (cloneMeta.optimized && files.length === 0) {
    if (debug) console.log(dim('[debug] optimized clone yielded 0 files, retrying full clone'));
    if (tempRoot) {
      try {
        fs.rmSync(tempRoot, {recursive: true, force: true});
      } catch {
      }
    }
    files = [];
    cloneMeta = attemptClone({optimized: false});
    cloneDir = cloneMeta.dir;
    files = walk(cloneDir);
  }
} catch (e) {
  console.error('ERROR: Unable to load template repo:', e.message);
  cleanupAndExit(EXIT.USAGE_ERROR);
}

if (debug) {
  console.log(dim('[debug] repo mode:'), cloneMeta.optimized ? 'optimized' : 'full');
  console.log(dim('[debug] template file count:'), files.length);
}

if (files.length === 0) {
  console.error('ERROR: Template repository has no files to process.');
  cleanupAndExit(EXIT.TEMPLATE_EMPTY);
}

// ---------------- CLASSIFICATION ----------------
const actions = [];
const added = [];
const skipped = [];
const excluded = [];
const errors = [];

for (const relRaw of files) {
  const rel = relRaw.replace(/\\/g, '/');
  const targetPath = path.join(targetRoot, rel);

  if (ALWAYS_EXCLUDE.has(rel)) {
    actions.push({rel, action: 'exclude-always', reason: 'always-exclude'});
    excluded.push({file: rel, reason: 'always-exclude'});
    continue;
  }
  if (cleanInfo && isInfoFile(rel)) {
    actions.push({rel, action: 'exclude-info', reason: 'clean'});
    excluded.push({file: rel, reason: 'info-clean'});
    continue;
  }
  if (isContentFile(rel) && !effectiveContent) {
    actions.push({rel, action: 'exclude-feature', reason: 'content-off'});
    excluded.push({file: rel, reason: 'content-disabled'});
    continue;
  }
  if (isTailwindFile(rel) && !effectiveTailwind) {
    actions.push({rel, action: 'exclude-feature', reason: 'tailwind-off'});
    excluded.push({file: rel, reason: 'tailwind-disabled'});
    continue;
  }
  if (fs.existsSync(targetPath)) {
    actions.push({rel, action: 'skip-exists'});
    skipped.push(rel);
    continue;
  }
  actions.push({rel, action: 'add'});
  if (!(dryRun || listOnly)) {
    try {
      ensureDir(targetPath);
      fs.copyFileSync(path.join(cloneDir, relRaw), targetPath);
      added.push(rel);
    } catch (e) {
      errors.push({file: rel, error: e.message});
    }
  } else {
    added.push(rel);
  }
}

// ---------------- LIST MODE ----------------
if (listOnly && !jsonOutput) {
  console.log(cyan('=== Template classification ==='));
  console.log('Target:', targetRoot);
  console.log(`Repo: ${REPO_URL} Ref: ${REPO_REF} Mode: ${cloneMeta.optimized ? 'optimized' : 'full'}`);
  console.log(`Flags: all=${forceAll} content=${effectiveContent} tailwind=${effectiveTailwind} cleanInfo=${cleanInfo} dryRun=${dryRun}`);
  console.log('');
  for (const a of actions.sort((a, b) => a.rel.localeCompare(b.rel))) {
    let tag;
    switch (a.action) {
      case 'add':
        tag = green('[ADD]');
        break;
      case 'skip-exists':
        tag = magenta('[SKIP]');
        break;
      case 'exclude-info':
        tag = yellow('[EXCL-INFO]');
        break;
      case 'exclude-feature':
        tag = yellow('[EXCL-FEAT]');
        break;
      case 'exclude-always':
        tag = yellow('[EXCL]');
        break;
      default:
        tag = '[?]';
    }
    console.log(tag, a.rel, a.reason ? dim(`(${a.reason})`) : '');
  }
  console.log('\nTotals:',
      `add=${actions.filter(a => a.action === 'add').length}`,
      `skip=${actions.filter(a => a.action === 'skip-exists').length}`,
      `excluded=${actions.filter(a => a.action.startsWith('exclude')).length}`
  );
  cleanupAndExit(EXIT.OK);
}

// ---------------- JSON OUTPUT (SUMMARY OR LIST) ----------------
if (jsonOutput) {
  const payload = {
    target:    targetRoot,
    repo:      REPO_URL,
    ref:       REPO_REF,
    mode:      cloneMeta.optimized ? 'optimized' : 'full',
    detected:  {
      content:  detectedContent,
      tailwind: detectedTailwind
    },
    effective: {
      content:  effectiveContent,
      tailwind: effectiveTailwind,
      all:      forceAll,
      cleanInfo,
      dryRun,
      listOnly
    },
    counts:    {
      add:      added.length,
      skip:     skipped.length,
      excluded: excluded.length,
      errors:   errors.length
    },
    added,
    skipped,
    excluded,
    errors,
    actions
  };
  console.log(JSON.stringify(payload, null, 2));
  cleanupAndExit(errors.length ? EXIT.FILE_ERRORS : EXIT.OK);
}

// ---------------- SUMMARY (HUMAN) ----------------
console.log('');
console.log(cyan('=== nuxt 4 scaffold ==='));
console.log('Target:', targetRoot);
console.log(`Repo: ${REPO_URL} Ref: ${REPO_REF} Mode: ${cloneMeta.optimized ? 'optimized' : 'full'}`);
console.log(`Detected deps: content=${detectedContent} tailwind=${detectedTailwind}`);
console.log(`Effective: content=${effectiveContent} tailwind=${effectiveTailwind} all=${forceAll} cleanInfo=${cleanInfo} dryRun=${dryRun}`);
console.log('');

if (added.length) {
  console.log(green('Added (or would add):'));
  for (const f of added) console.log('  +', f);
} else {
  console.log(yellow('No new files added.'));
}
if (skipped.length) {
  console.log(magenta('\nSkipped:'));
  for (const f of skipped) console.log('  -', f);
}
if (excluded.length) {
  console.log('\nExcluded:');
  for (const e of excluded) console.log('  x', e.file, dim(`(${e.reason})`));
}
if (errors.length) {
  console.log('\n' + red('Errors:'));
  for (const e of errors) console.log('  !', e.file, '=>', e.error);
}
console.log('');
console.log(`Totals: added=${added.length} skipped=${skipped.length} excluded=${excluded.length} errors=${errors.length}`);
console.log('');
cleanupAndExit(errors.length ? EXIT.FILE_ERRORS : EXIT.OK);

// ---------------- CLEANUP ----------------
/**
 * Cleans up temporary directories, releases lock, and exits the process with the given code.
 * @param {number} code - The exit code for the process.
 */
function cleanupAndExit(code) {
  if (tempRoot) {
    try {
      fs.rmSync(tempRoot, {recursive: true, force: true});
    } catch {
    }
  }
  if (lockAcquired) {
    try {
      fs.rmSync(lockPath, {force: true});
    } catch {
    }
  }
  process.exit(code);
}
