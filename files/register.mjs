// Registers the chrome-devtools MCP server with each installed agent, in the
// agent's user-level config — never the workspace, which is the user's repo.
//
// A mixin cannot ship these files: each is also written by the agent kit and
// by the agent itself, and a layer replaces a file rather than merging into
// it. So this merges at create (after the agent kit's own install hooks,
// which `integrates` orders first) and again at boot, touching a file only
// when the entry is missing or is this kit's own entry from an older release.
//
// An existing `chrome-devtools` entry that points somewhere else is the
// user's choice and is left as it is, with a note on stderr.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFsError } from './proxy-trust.mjs';

const NAME = 'chrome-devtools';

// The environment NAMES (never values) an agent must hand the MCP server so
// that the browser it starts or attaches to keeps the sandbox proxy, its CA
// and the display/GPU controls. They are exactly the names the descriptor's
// `sbx-chrome --if-display` startup hook declares, so a browser started by
// the MCP server sees what a browser started by that hook sees. Who reads them:
//   proxy:   *_PROXY / *_proxy  proxy-trust.mjs plan(), sbx-chromium, sbx-browser-mcp
//   CA:      SSL_CERT_FILE, PROXY_CA_CERT_B64, SBX_PROXY_CA_FILE  proxy-trust.mjs caSources()
//   mode:    SBX_PROXY_MODE  proxy-trust.mjs plan()
//   display: WAYLAND_DISPLAY, XDG_RUNTIME_DIR, SBX_WAYLAND_SOCKET  wayland-probe.mjs discover();
//            DISPLAY, SBX_CHROME_HEADLESS  display.sh sbx_detect_display()
//   GPU:     SBX_CHROME_DISABLE_GPU  sbx-chromium
//   port:    CHROME_REMOTE_DEBUGGING_PORT  sbx-browser-mcp, lifecycle.mjs (documented)
// Deliberately absent: CHROME_USER_DATA_DIR, XDG_STATE_HOME and
// SBX_CHROME_START_TIMEOUT (undocumented code controls; the default profile
// and state paths derive from HOME, which Codex always passes), and loader or
// credential variables.
// Codex starts stdio MCP servers with a cleared environment plus a small core
// set (HOME, PATH, locale, …, and CA bundle paths such as SSL_CERT_FILE), so
// without `env_vars` the proxy variables never arrive and the browser refuses
// to start or attach while the sandbox CA is present.
export const ENV_NAMES = Object.freeze([
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'PROXY_CA_CERT_B64', 'SBX_PROXY_CA_FILE', 'SBX_PROXY_MODE',
  'WAYLAND_DISPLAY', 'DISPLAY', 'XDG_RUNTIME_DIR', 'SBX_WAYLAND_SOCKET',
  'SBX_CHROME_HEADLESS', 'SBX_CHROME_DISABLE_GPU', 'CHROME_REMOTE_DEBUGGING_PORT',
]);

// A configuration this script will not change and the user has to fix.
export class RegisterError extends Error {}
const isAbsent = e => isFsError(e) && (e.code === 'ENOENT' || e.code === 'ENOTDIR');

function onPath(bin, envPath) {
  return (envPath || '').split(':').some(dir => {
    try { fs.accessSync(path.join(dir, bin), fs.constants.X_OK); return true; }
    catch (e) { if (isFsError(e)) return false; throw e; }
  });
}

function readOptional(file) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (e) {
    if (isAbsent(e)) return null;
    if (isFsError(e)) throw new RegisterError(`cannot read ${file} (${e.code}); fix its permissions and run sbx-browser-register again`);
    throw e;
  }
}

// Write beside the target and rename over it, so a reader never sees half a
// file and a failure leaves the original intact.
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.sbx-browser.${process.pid}`;
  let mode = 0o644;
  try { mode = fs.statSync(file).mode & 0o777; }
  catch (e) { if (!isAbsent(e)) throw e; }
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}

// Merge `entry` at obj[key][NAME] in a JSON file. Returns what happened.
function mergeJson(file, key, entry, isOurs) {
  let doc = {};
  const raw = readOptional(file);
  if (raw?.trim()) {
    // The parser's message quotes the input, which may hold secrets, so it
    // is never shown.
    try { doc = JSON.parse(raw); } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      return `skipped: ${file} is not valid JSON; fix or remove it, then run sbx-browser-register again`;
    }
  }
  if (!isObject(doc)) return `skipped: ${file} is not a JSON object; fix it, then run sbx-browser-register again`;
  if (doc[key] !== undefined && !isObject(doc[key])) return `left alone: ${file} has a '${key}' that is not an object`;
  const servers = (doc[key] ??= {});
  const current = servers[NAME];
  if (current && JSON.stringify(current) === JSON.stringify(entry)) return 'already registered';
  if (current && !isOurs(current)) return `left alone: ${file} already has a different '${NAME}' entry`;
  servers[NAME] = entry;
  writeAtomic(file, `${JSON.stringify(doc, null, 2)}\n`);
  return `registered in ${file}`;
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// An entry is this kit's only by what it runs: this kit's server, or the v2
// kit's `npx chrome-devtools-mcp --browser-url=…` / a direct
// chrome-devtools-mcp, so upgrading replaces those instead of leaving them
// behind. Comments, env and other keys never decide it. For npx, the package
// is the first argument after npx's own -y/--yes; any other option, or any
// other package first, is someone else's invocation and is left alone.
const base = p => typeof p === 'string' ? p.split('/').pop() : '';
export function isOurCommand(command, args = []) {
  const name = base(command);
  if (name === 'sbx-browser-mcp' || name === 'chrome-devtools-mcp') return true;
  if (name !== 'npx' || !Array.isArray(args)) return false;
  const target = args.find(a => a !== '-y' && a !== '--yes');
  return typeof target === 'string' && /^chrome-devtools-mcp(@[^\s/]*)?$/.test(target);
}
const ownsCommandEntry = e => isObject(e) && isOurCommand(e.command, e.args);
const ownsOpencodeEntry = e => isObject(e) && Array.isArray(e.command) && isOurCommand(e.command[0], e.command.slice(1));

// ── Codex: TOML, edited in place without a TOML library ──────────────────────
// Only the lines of our own table are ever touched; everything else in the
// file is kept byte for byte.
const CODEX_HEADER = /^\s*\[\s*mcp_servers\s*\.\s*(?:chrome-devtools|"chrome-devtools"|'chrome-devtools')\s*\]\s*(?:#.*)?$/;
const ANY_HEADER = /^\s*\[\[?\s*[^\]"'=]*(?:"[^"]*"|'[^']*')?[^\]=]*\]\]?\s*(?:#.*)?$/;
const COMMAND_KEY = /^\s*command\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/;
const ENV_VARS_KEY = /^(\s*env_vars\s*=\s*)\[/;
// The value of a quoted TOML string; basic strings use JSON-compatible escapes
// for any path this kit writes, and anything else is not this kit's.
function tomlString(quoted) {
  if (quoted.startsWith("'")) return quoted.slice(1, -1);
  try { return JSON.parse(quoted); } catch (e) { if (e instanceof SyntaxError) return null; throw e; }
}
const tomlArray = names => `[${names.map(n => JSON.stringify(n)).join(', ')}]`;

// From `[` at lines[row][col], the position just after the matching `]`,
// skipping brackets inside strings and comments. Arrays of strings and inline
// tables are what Codex accepts for env_vars; neither nests further arrays.
function arrayEnd(lines, row, col) {
  let quote = null;
  for (let r = row; r < lines.length; r++) {
    const line = lines[r];
    for (let c = r === row ? col + 1 : 0; c < line.length; c++) {
      const ch = line[c];
      if (quote) {
        if (quote === '"' && ch === '\\') c++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '#') break;
      else if (ch === ']') return { row: r, col: c + 1 };
    }
  }
  return null;
}

// What to do with the Codex config text. Returns {text, result}; text is null
// when the file must not be written.
export function planCodex(text, command) {
  const fresh = `[mcp_servers.${NAME}]\ncommand = ${JSON.stringify(command)}\nstartup_timeout_sec = 30\nenv_vars = ${tomlArray(ENV_NAMES)}\n`;
  const lines = text.split('\n');
  const start = lines.findIndex(l => CODEX_HEADER.test(l.replace(/\r$/, '')));
  if (start < 0) {
    // A new table at the end of the file cannot capture keys that belong to
    // another one.
    return { text: text + (text && !text.endsWith('\n') ? '\n' : '') + '\n' + fresh, result: 'registered' };
  }
  let end = lines.findIndex((l, i) => i > start && ANY_HEADER.test(l.replace(/\r$/, '')));
  if (end < 0) end = lines.length;
  const cmdRow = lines.findIndex((l, i) => i > start && i < end && COMMAND_KEY.test(l));
  if (cmdRow < 0 || !isOurCommand(tomlString(COMMAND_KEY.exec(lines[cmdRow])[1]))) return { text: null, result: `left alone: the existing '${NAME}' entry runs a different command` };

  // Ours, possibly from a release that did not pass the environment through.
  const envRow = lines.findIndex((l, i) => i > start && i < end && ENV_VARS_KEY.test(l));
  const cr = lines[cmdRow].endsWith('\r') ? '\r' : '';
  if (envRow < 0) {
    lines.splice(cmdRow + 1, 0, `env_vars = ${tomlArray(ENV_NAMES)}${cr}`);
    return { text: lines.join('\n'), result: 'upgraded: added env_vars' };
  }
  const open = lines[envRow].indexOf('[', ENV_VARS_KEY.exec(lines[envRow])[1].length);
  const close = arrayEnd(lines, envRow, open);
  if (!close) throw new RegisterError(`the env_vars array of '${NAME}' is not closed; fix the TOML and run sbx-browser-register again`);
  const body = [lines[envRow].slice(open + 1, close.row === envRow ? close.col - 1 : undefined),
    ...lines.slice(envRow + 1, close.row), ...(close.row === envRow ? [] : [lines[close.row].slice(0, close.col - 1)])].join('\n');
  const quoted = [...body.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map(m => m[0]);
  const names = quoted.map(tomlString);
  if (names.includes(null)) throw new RegisterError(`an env_vars name of '${NAME}' is not a plain quoted string; fix the TOML and run sbx-browser-register again`);
  const missing = ENV_NAMES.filter(n => !names.includes(n));
  if (!missing.length) return { text: null, result: 'already registered' };
  // Inline tables ({name = …, source = …}) and comments are the user's own
  // layout; rewriting them could lose a source or a note, so say what to add.
  if (/[{#]/.test(body)) return { text: null, result: `left alone: the '${NAME}' env_vars uses a custom layout; add ${missing.join(', ')} to it so the browser keeps the sandbox proxy` };
  const merged = `${lines[envRow].slice(0, open)}${tomlArray([...names, ...missing])}${lines[close.row].slice(close.col)}`;
  lines.splice(envRow, close.row - envRow + 1, merged);
  return { text: lines.join('\n'), result: `upgraded: added ${missing.join(', ')} to env_vars` };
}

function registerCodex(file, command) {
  const text = readOptional(file) ?? '';
  let plan;
  try { plan = planCodex(text, command); }
  catch (e) {
    // Name the file; the message never carries its content.
    if (e instanceof RegisterError) throw new RegisterError(`${file}: ${e.message}`);
    throw e;
  }
  if (plan.text === null) return plan.result;
  writeAtomic(file, plan.text);
  return `${plan.result} in ${file}`;
}

export function agents(command, env) {
  const home = env.HOME;
  return [
    {
      name: 'claude',
      present: () => onPath('claude', env.PATH),
      // User scope: top-level mcpServers in ~/.claude.json.
      run: () => mergeJson(path.join(home, '.claude.json'), 'mcpServers',
        { type: 'stdio', command, args: [], env: {} }, ownsCommandEntry),
    },
    {
      name: 'gemini',
      present: () => onPath('gemini', env.PATH),
      run: () => mergeJson(path.join(home, '.gemini', 'settings.json'), 'mcpServers',
        { command, args: [] }, ownsCommandEntry),
    },
    {
      name: 'cursor',
      present: () => onPath('cursor-agent', env.PATH),
      run: () => mergeJson(path.join(home, '.cursor', 'mcp.json'), 'mcpServers',
        { command, args: [] }, ownsCommandEntry),
    },
    {
      name: 'opencode',
      present: () => onPath('opencode', env.PATH),
      run: () => mergeJson(path.join(home, '.config', 'opencode', 'opencode.json'), 'mcp',
        { type: 'local', command: [command], enabled: true }, ownsOpencodeEntry),
    },
    {
      name: 'codex',
      present: () => onPath('codex', env.PATH),
      run: () => registerCodex(path.join(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml'), command),
    },
  ];
}

// Returns the number of agents whose registration failed.
export function main(argv, env) {
  const [command, ...flags] = argv;
  const quiet = flags.includes('--quiet');
  const say = msg => process.stderr.write(`sbx-browser-register: ${msg}\n`);
  let found = 0, failed = 0;
  for (const agent of agents(command, env)) {
    if (!agent.present()) continue;
    found++;
    try {
      const result = agent.run();
      if (!quiet) say(`${agent.name}: ${result}`);
    } catch (e) {
      // One agent's unreadable or broken config must not stop the others.
      // Failures are reported even with --quiet; anything unexpected propagates.
      if (!(e instanceof RegisterError) && !isFsError(e)) throw e;
      failed++;
      say(`${agent.name}: failed: ${e.message}`);
    }
  }
  if (!found && !quiet) say('no supported agent found on PATH (claude, codex, gemini, cursor-agent, opencode)');
  return failed;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env);
}
