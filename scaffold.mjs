#!/usr/bin/env node
/**
 * @module @thaikolja/scaffold-nuxt-4
 * @version 1.0.0
 * @description Deterministic additive scaffolder for Nuxt 4 projects. Intelligently adds template files
 *   without overwriting existing ones. Supports built-in, Git, or local directory templates,
 *   with automatic feature detection for `@nuxt/content` and Tailwind CSS, configurable via flags.
 *
 * CORE PURPOSE
 *   - Classify template files vs target (add | skip | exclude).
 *   - Optionally write changes (default) or simulate (--dry-run).
 *   - Provide structured JSON (--json) or human console output.
 *   - Support various template sources (built-in, Git, local directory).
 *   - Feature gating for `@nuxt/content` and Tailwind CSS.
 *
 * USAGE
 *   npx @thaikolja/scaffold-nuxt-4 [flags]
 *   (If no flags, copies default template files to current working directory.)
 *
 * PRIMARY FLAGS (summarized)
 *   --all                  Includes all files from the template, ignoring automatic feature detection.
 *   --with-content         Forces the inclusion of files related to @nuxt/content.
 *   --without-content      Forces the exclusion of files related to @nuxt/content.
 *   --with-tailwind        Forces the inclusion of files related to Tailwind CSS.
 *   --without-tailwind     Forces the exclusion of files related to Tailwind CSS.
 *   -c, --clean            Excludes INFO.md files from being copied.
 *   --dry-run              Simulates the scaffolding process without making any changes to the filesystem.
 *   --list                 Lists all files in the template and their classification (add, skip, exclude).
 *   --json                 Outputs the results of the scaffolding process in JSON format.
 *   --debug                Enables debug mode for more verbose output.
 *   --no-color             Disables color-coded output.
 *   --include-docs         Includes documentation files (e.g., README.md, LICENSE) in the copy process.
 *   --template-url=<url>   Specifies the URL of a Git repository or the path to a local directory to use as the template source.
 *   --template-ref=<ref>   Specifies the branch, tag, or commit to use when cloning a Git repository.
 *   --template-dir=<dir>   Specifies the subdirectory within the template source that contains the files to be copied.
 *   -v, --version          Prints the version of the script.
 *   -h, --help             Displays the help message.
 */


import fs              from 'node:fs';
import path            from 'node:path';
import os              from 'node:os';
import process         from 'node:process';
import {spawnSync}     from 'node:child_process';
import {fileURLToPath} from 'node:url';

// ---------------- CONFIG CONSTANTS ----------------
const MIN_NODE_MAJOR = 18;
const DEFAULT_REPO_URL = 'https://gitlab.com/thaikolja/scaffold-nuxt-4.git';
const DEFAULT_REPO_REF = 'main';
const DEFAULT_TEMPLATE_DIR = 'templates';
const VERSION = '1.0.0';

// ---------------- NODE VERSION GUARD ----------------
(function enforceNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (!major || major < MIN_NODE_MAJOR) {
    console.error(`ERROR: Node.js >= ${MIN_NODE_MAJOR} required. Detected ${process.versions.node}`);
    process.exit(1);
  }
})();

// ---------------- EXIT CODES ----------------
const EXIT = {
  OK:             0,
  USAGE_ERROR:    1,
  TEMPLATE_EMPTY: 2,
  FILE_ERRORS:    3
};

// ---------------- ARG PARSING ----------------
const rawArgs = process.argv.slice(2);
const positional = [];
const longArgs = new Map();
const flags = new Set();

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    if (eq !== -1) {
      longArgs.set(a.slice(2, eq), a.slice(eq + 1));
    } else {
      longArgs.set(a.slice(2), true);
    }
  } else if (a.startsWith('-')) {
    // Support combined short flags like -vhc
    if (a.length > 2) {
      for (let j = 1; j < a.length; j++) flags.add(`-${a[j]}`);
    } else {
      flags.add(a);
    }
  } else {
    positional.push(a);
  }
}
const want = name => longArgs.has(name);
const wantFlag = (short, long) => flags.has(short) || longArgs.has(long);
const getOpt = (name, def) => {
  const v = longArgs.get(name);
  return v === true ? def : (v ?? def);
};

// ---------------- OPTIONS ----------------
if (positional.length > 1) {
  console.error('ERROR: Only one positional path allowed.');
  process.exit(EXIT.USAGE_ERROR);
}

const wantHelp = wantFlag('-h', 'help');
const wantVersion = wantFlag('-v', 'version');
const cleanInfo = wantFlag('-c', 'clean');
const listOnly = want('list');
const dryRun = want('dry-run');
const debug = want('debug');
const forceAll = want('all');
const overrideWithContent = want('with-content');
const overrideWithoutContent = want('without-content');
const overrideWithTailwind = want('with-tailwind');
const overrideWithoutTailwind = want('without-tailwind');
const jsonOutput = want('json');
const disableColorFlag = want('no-color');
const includeDocs = want('include-docs');

const templateUrlFlag = getOpt('template-url');
const templateRefFlag = getOpt('template-ref');
const templateDirFlag = getOpt('template-dir');

const noColorEnv = !!process.env.NO_COLOR;
const wantColor = !(disableColorFlag || noColorEnv);

if (wantVersion) {
  console.log(VERSION);
  process.exit(EXIT.OK);
}

if (wantHelp) {
  // noinspection XmlDeprecatedElement,HtmlDeprecatedTag
  console.log(`
Scaffold Nuxt 4 (additive).

Usage:
  scaffold-nuxt-4 [flags] [targetPath]

Flags:
  --all
  --with-content / --without-content
  --with-tailwind / --without-tailwind
  -c, --clean           Exclude INFO.md files
  --dry-run             Simulate only
  --list                Classification only
  --json                JSON output
  --debug               Internal state
  --no-color            Disable ANSI colors
  --include-docs        Allow README/LICENSE/CHANGELOG copying
  --template-url=<url>  Override template repo URL (can be a local path)
  --template-ref=<ref>  Override ref (branch/tag/commit)
  --template-dir=<dir>  Template subdirectory (default: templates)
  -v, --version         Print version
  -h, --help            Help

Notes:
  - Short flags can be combined: -vh, -cv, etc.

Env:
  SCAFFOLD_REPO_URL
  SCAFFOLD_REPO_REF
  SCAFFOLD_FAST=1
  NO_COLOR=1
`);
  process.exit(EXIT.OK);
}

// Mutual exclusivity
if (overrideWithContent && overrideWithoutContent) {
  console.error('ERROR: --with-content and --without-content are mutually exclusive.');
  process.exit(EXIT.USAGE_ERROR);
}
if (overrideWithTailwind && overrideWithoutTailwind) {
  console.error('ERROR: --with-tailwind and --without-tailwind are mutually exclusive.');
  process.exit(EXIT.USAGE_ERROR);
}

// ---------------- TARGET PATH ----------------
function expandTilde(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

const targetRoot = positional.length ? path.resolve(expandTilde(positional[0])) : process.cwd();
if (!fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
  console.error('ERROR: Target path not a directory:', targetRoot);
  process.exit(EXIT.USAGE_ERROR);
}

// ---------------- LOCK ----------------
const LOCK_NAME = '.scaffold-nuxt-4.lock';
const lockPath = path.join(targetRoot, LOCK_NAME);
let lockAcquired = false;

function isProcessAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH -> not running; EPERM/others -> assume running
    return e && e.code !== 'ESRCH';
  }
}

function readLockPid(p) {
  try {
    const txt = fs.readFileSync(p, 'utf8').trim();
    const pid = parseInt(txt, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function createLock() {
  const fd = fs.openSync(lockPath, 'wx');
  try {
    fs.writeFileSync(fd, String(process.pid));
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
    }
  }
  lockAcquired = true;
}

try {
  createLock();
} catch (e) {
  if (e && e.code === 'EEXIST') {
    const pid = readLockPid(lockPath);
    if (isProcessAlive(pid)) {
      console.error(`ERROR: Another scaffold process appears active (lock: ${lockPath}${pid ? `, pid ${pid}` : ''}).`);
      process.exit(EXIT.USAGE_ERROR);
    }
    try {
      fs.rmSync(lockPath, {force: true});
    } catch {
    }
    try {
      createLock();
    } catch (ee) {
      console.error(`ERROR: Failed to acquire lock at ${lockPath}: ${ee.message}`);
      process.exit(EXIT.USAGE_ERROR);
    }
  } else {
    console.error(`ERROR: Failed to create lock at ${lockPath}: ${e?.message || e}`);
    process.exit(EXIT.USAGE_ERROR);
  }
}

// Register signal/exit cleanup so locks/temp dirs don't become immortal
const SIGNAL_EXIT_CODE = {SIGINT: 130, SIGHUP: 129, SIGTERM: 143};
let cleaning = false;
process.once('SIGINT', () => {
  cleanup();
  process.exit(SIGNAL_EXIT_CODE.SIGINT);
});
process.once('SIGHUP', () => {
  cleanup();
  process.exit(SIGNAL_EXIT_CODE.SIGHUP);
});
process.once('SIGTERM', () => {
  cleanup();
  process.exit(SIGNAL_EXIT_CODE.SIGTERM);
});
process.once('exit', () => {
  cleanup();
});

// ---------------- NUXT DETECTION ----------------
const pkgPath = path.join(targetRoot, 'package.json');
if (!fs.existsSync(pkgPath)) {
  console.error('ERROR: package.json missing in target:', targetRoot);
  cleanupAndExit(EXIT.USAGE_ERROR);
}
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
} catch {
  console.error('ERROR: Failed to parse package.json.');
  cleanupAndExit(EXIT.USAGE_ERROR);
}
const hasNuxtConfig = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs']
    .some(f => fs.existsSync(path.join(targetRoot, f)));
if (!hasNuxtConfig) {
  console.error('ERROR: nuxt.config.* missing in target path.');
  cleanupAndExit(EXIT.USAGE_ERROR);
}

const deps = {...(pkg.dependencies || {}), ...(pkg.devDependencies || {})};
const detectedContent = !!deps['@nuxt/content'];
const detectedTailwind = !!deps['tailwindcss'];

const effectiveContent =
          forceAll ? true :
              overrideWithContent ? true :
                  overrideWithoutContent ? false :
                      detectedContent;

const effectiveTailwind =
          forceAll ? true :
              overrideWithTailwind ? true :
                  overrideWithoutTailwind ? false :
                      detectedTailwind;

// ---------------- TEMPLATE SOURCE DECISION ----------------
const REPO_URL = templateUrlFlag || process.env.SCAFFOLD_REPO_URL || DEFAULT_REPO_URL;
const REPO_REF = templateRefFlag || process.env.SCAFFOLD_REPO_REF || DEFAULT_REPO_REF;
const USE_OPTIMIZED = process.env.SCAFFOLD_FAST === '1';
const REQUESTED_TEMPLATE_SUBDIR = templateDirFlag || DEFAULT_TEMPLATE_DIR;

const selfDir = path.dirname(fileURLToPath(import.meta.url));
let templateRoot = null;
let cloneDir = null;
let tempRoot = null;
let usedEmbedded = false;
let cloneMode = null;

function isRemote(url) {
  return /^(?:git@|https?:\/\/)/i.test(url);
}

function localEmbeddedTemplates() {
  const candidate = path.join(selfDir, REQUESTED_TEMPLATE_SUBDIR);
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() ? candidate : null;
  } catch {
    return null;
  }
}

const embedded = localEmbeddedTemplates();
if (embedded && REPO_URL === DEFAULT_REPO_URL) {
  templateRoot = embedded;
  usedEmbedded = true;
  cloneMode = 'embedded';
}

function execGit(args, cwd) {
  const res = spawnSync('git', args, {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8'
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr.trim() || res.stdout.trim()}`);
  }
  return res.stdout.trim();
}

function gitAvailable() {
  try {
    execGit(['--version']);
    return true;
  } catch {
    return false;
  }
}

function attemptClone(optimized) {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt4-scaffold-'));
  const dir = path.join(tempRoot, 'repo');
  if (optimized) {
    execGit(['clone', '--depth=1', '--no-tags', '--filter=blob:none', '--sparse', REPO_URL, dir]);
    try {
      // Target only the requested template subdir
      execGit(['sparse-checkout', 'set', '--no-cone', `${REQUESTED_TEMPLATE_SUBDIR}/**`], dir);
    } catch {
      // Sparse may fail on older git; caller will fallback if needed
    }
  } else {
    execGit(['clone', '--depth=1', '--no-tags', REPO_URL, dir]);
  }
  if (REPO_REF !== DEFAULT_REPO_REF) {
    execGit(['fetch', '--depth=1', 'origin', REPO_REF], dir);
    execGit(['checkout', REPO_REF], dir);
  }
  return dir;
}

if (!templateRoot) {
  if (!isRemote(REPO_URL)) {
    const local = path.resolve(expandTilde(REPO_URL));
    if (!fs.existsSync(local)) {
      console.error('ERROR: Local template path not found:', local);
      cleanupAndExit(EXIT.USAGE_ERROR);
    }
    cloneDir = local;
    cloneMode = 'full';
  } else {
    if (!gitAvailable()) {
      console.error('ERROR: Git not available and no embedded templates.');
      cleanupAndExit(EXIT.USAGE_ERROR);
    }
    try {
      if (USE_OPTIMIZED) {
        cloneDir = attemptClone(true);
        cloneMode = 'optimized';
        // If optimized clone is empty (excluding .git), retry full
        const test = fs.readdirSync(cloneDir).filter(x => x !== '.git');
        if (test.length === 0) {
          if (debug) console.log('[debug] optimized clone empty; retry full');
          fs.rmSync(tempRoot, {recursive: true, force: true});
          cloneDir = attemptClone(false);
          cloneMode = 'full';
        }
      } else {
        cloneDir = attemptClone(false);
        cloneMode = 'full';
      }
    } catch (e) {
      console.error('ERROR: Clone failed:', e.message);
      cleanupAndExit(EXIT.USAGE_ERROR);
    }
  }
  const candidate = path.join(cloneDir, REQUESTED_TEMPLATE_SUBDIR);
  templateRoot = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()
      ? candidate
      : cloneDir;
}

// Self-target guard
try {
  const tStat = fs.statSync(targetRoot);
  const trStat = fs.statSync(templateRoot);
  if (tStat.ino === trStat.ino && tStat.dev === trStat.dev) {
    console.error('ERROR: Template root == target root.');
    cleanupAndExit(EXIT.USAGE_ERROR);
  }
} catch {
}

// ---------------- COLOR HELPERS ----------------
const color = (code, str) =>
    (process.stdout.isTTY && wantColor) ? `\x1b[${code}m${str}\x1b[0m` : str;
const green = s => color(32, s);
const yellow = s => color(33, s);
const cyan = s => color(36, s);
const magenta = s => color(35, s);
const red = s => color(31, s);
const dim = s => color(2, s);

// ---------------- CLASSIFIERS ----------------
const isContentFile = rel =>
    rel === 'content.config.ts' ||
    rel.startsWith('content/') ||
    rel.startsWith('content\\');

const isTailwindFile = rel =>
    rel === 'tailwind.config.ts' ||
    rel === 'tailwind.config.js' ||
    rel === 'tailwind.config.cjs';

const isInfoFile = rel => path.basename(rel) === 'INFO.md';

// Always-exclude basenames
const ALWAYS_EXCLUDE = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'scaffold.mjs',
  '_scaffold.mjs',
  'a.txt',
  LOCK_NAME,
  '.DS_Store',
  'Thumbs.db'
]);

// Docs excluded unless explicitly included
const DOC_EXCLUDE = new Set([
  'README.md',
  'LICENSE',
  'LICENSE.txt',
  'CHANGELOG.md',
  'CHANGES.md'
]);

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

function ensureDir(p) {
  const d = path.dirname(p);
  if (!fs.existsSync(d)) fs.mkdirSync(d, {recursive: true});
}

// ---------------- GATHER FILES ----------------
let files = walk(templateRoot);
if (files.length === 0) {
  console.error('ERROR: Template source has no files.');
  cleanupAndExit(EXIT.TEMPLATE_EMPTY);
}

const actions = [];
const added = [];
const skipped = [];
const excluded = [];
const errors = [];

for (const relRaw of files) {
  const rel = relRaw.replace(/\\/g, '/');
  const baseName = path.basename(rel);

  if (ALWAYS_EXCLUDE.has(baseName)) {
    actions.push({rel, action: 'exclude-always', reason: 'utility'});
    excluded.push({file: rel, reason: 'utility'});
    continue;
  }
  if (!includeDocs && DOC_EXCLUDE.has(baseName)) {
    actions.push({rel, action: 'exclude-docs', reason: 'docs'});
    excluded.push({file: rel, reason: 'docs'});
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

  const dest = path.join(targetRoot, rel);
  if (fs.existsSync(dest)) {
    actions.push({rel, action: 'skip-exists'});
    skipped.push(rel);
    continue;
  }

  actions.push({rel, action: 'add'});
  if (!(dryRun || listOnly)) {
    try {
      ensureDir(dest);
      fs.copyFileSync(path.join(templateRoot, relRaw), dest);
      added.push(rel);
    } catch (e) {
      errors.push({file: rel, error: e.message});
    }
  } else {
    added.push(rel);
  }
}

// Deterministic ordering
actions.sort((a, b) => a.rel.localeCompare(b.rel));
added.sort();
skipped.sort();
excluded.sort((a, b) => a.file.localeCompare(b.file));

// ---------------- OUTPUT ----------------
if (listOnly && !jsonOutput) {
  console.log(cyan('=== Template classification ==='));
  console.log('Target:', targetRoot);
  const modeForPrint = usedEmbedded ? 'embedded' : (cloneMode || (USE_OPTIMIZED ? 'optimized' : 'full'));
  console.log(`Source: ${usedEmbedded ? 'embedded' : REPO_URL} Ref: ${REPO_REF} Mode: ${modeForPrint}`);
  console.log(`Flags: all=${forceAll} content=${effectiveContent} tailwind=${effectiveTailwind} cleanInfo=${cleanInfo} includeDocs=${includeDocs} dryRun=${dryRun}`);
  console.log('');
  for (const a of actions) {
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
      case 'exclude-docs':
        tag = yellow('[EXCL-DOC]');
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

if (jsonOutput) {
  const payload = {
    version:   VERSION,
    target:    targetRoot,
    source:    usedEmbedded ? 'embedded' : REPO_URL,
    ref:       REPO_REF,
    mode:      usedEmbedded ? 'embedded' : (cloneMode || (USE_OPTIMIZED ? 'optimized' : 'full')),
    detected:  {content: detectedContent, tailwind: detectedTailwind},
    effective: {
      content:  effectiveContent,
      tailwind: effectiveTailwind,
      all:      forceAll,
      cleanInfo,
      dryRun,
      listOnly,
      includeDocs
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

// Human summary
console.log('');
console.log(cyan('=== nuxt 4 scaffold ==='));
console.log('Target:', targetRoot);
console.log(`Source: ${usedEmbedded ? 'embedded templates' : REPO_URL}`);
console.log(`Ref: ${REPO_REF}`);
console.log(`Mode: ${usedEmbedded ? 'embedded' : (cloneMode || (USE_OPTIMIZED ? 'optimized' : 'full'))}`);
console.log(`Detected deps: content=${detectedContent} tailwind=${detectedTailwind}`);
console.log(`Effective: content=${effectiveContent} tailwind=${effectiveTailwind} all=${forceAll} cleanInfo=${cleanInfo} includeDocs=${includeDocs} dryRun=${dryRun}`);
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
function cleanup() {
  if (cleaning) return;
  cleaning = true;
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
}

function cleanupAndExit(code) {
  cleanup();
  process.exit(code);
}
