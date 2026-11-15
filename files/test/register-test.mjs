// Registration: the Codex entry passes the browser's environment names through
// `env_vars`, older kit entries are upgraded in place, user entries and every
// other byte of the file are kept, and repeated runs change nothing.
//
//   node register-test.mjs [path/to/register.mjs]
//
// Agent binaries on PATH are empty marker files: registration only checks that
// an agent is installed, it never runs it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(process.argv[2] || path.join(here, '..', 'register.mjs'));
const { ENV_NAMES, RegisterError, planCodex, isOurCommand, main } = await import(pathToFileURL(modulePath).href);

const CMD = '/opt/sbx-chromium/bin/sbx-browser-mcp';
const ENV_LINE = `env_vars = [${ENV_NAMES.map(n => JSON.stringify(n)).join(', ')}]`;
// Exactly what register.mjs of 2.0.0 through 2.0.2 appended.
const LEGACY = `\n[mcp_servers.chrome-devtools]\ncommand = "${CMD}"\nstartup_timeout_sec = 30\n`;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function sandbox(agentsOnPath = ['codex']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'register-test-'));
  const bin = path.join(root, 'bin'), home = path.join(root, 'home');
  fs.mkdirSync(bin); fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  for (const a of agentsOnPath) fs.writeFileSync(path.join(bin, a), '#!/bin/sh\n', { mode: 0o755 });
  const env = { HOME: home, PATH: bin };
  const config = path.join(home, '.codex', 'config.toml');
  // main() reports on stderr; capture stdout and stderr so assertions can read
  // everything it printed.
  const run = (...flags) => {
    const lines = [], err = process.stderr.write, out = process.stdout.write;
    process.stderr.write = process.stdout.write = chunk => { lines.push(String(chunk)); return true; };
    try { return { failed: main([CMD, ...flags], env), out: lines.join('') }; }
    finally { process.stderr.write = err; process.stdout.write = out; }
  };
  return { root, env, config, run, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

// ── The allowlist ────────────────────────────────────────────────────────────
test('allowlist is names only, unique, and matches the descriptor startup hook', () => {
  for (const n of ENV_NAMES) assert.match(n, /^[A-Za-z_][A-Za-z0-9_]*$/);
  assert.equal(new Set(ENV_NAMES).size, ENV_NAMES.length);
  for (const n of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'no_proxy', 'PROXY_CA_CERT_B64', 'SBX_PROXY_MODE',
    'WAYLAND_DISPLAY', 'SBX_CHROME_HEADLESS', 'SBX_CHROME_DISABLE_GPU']) assert.ok(ENV_NAMES.includes(n), n);
  const yaml = path.join(here, '..', '..', 'chromium-display.yaml');
  if (!fs.existsSync(yaml)) { process.stdout.write('  (descriptor not in this tree; hook comparison runs from the repository)\n'); return; }
  const hook = /sbx-chrome", "--if-display"\][\s\S]*?env: \[([^\]]*)\]/.exec(fs.readFileSync(yaml, 'utf8'));
  assert.ok(hook, 'startup hook env list not found in chromium-display.yaml');
  assert.deepEqual([...ENV_NAMES].sort(), hook[1].split(',').map(s => s.trim()).filter(Boolean).sort());
});

// ── planCodex: pure text planning ────────────────────────────────────────────
test('fresh file gets the full entry', () => {
  const { text, result } = planCodex('', CMD);
  assert.equal(result, 'registered');
  assert.equal(text, `\n[mcp_servers.chrome-devtools]\ncommand = "${CMD}"\nstartup_timeout_sec = 30\n${ENV_LINE}\n`);
});

test('existing unrelated tables are kept byte for byte', () => {
  const before = 'approval_policy = "never"\n\n[projects."/w"]\ntrust_level = "trusted"';
  const { text } = planCodex(before, CMD);
  assert.ok(text.startsWith(before + '\n\n[mcp_servers.chrome-devtools]\n'));
  assert.ok(text.includes(ENV_LINE));
});

test('legacy 2.0.x entry is upgraded in place', () => {
  const before = `approval_policy = "never"\n${LEGACY}\n[projects."/w"]\ntrust_level = "trusted"\n`;
  const { text, result } = planCodex(before, CMD);
  assert.equal(result, 'upgraded: added env_vars');
  assert.equal(text, before.replace(`command = "${CMD}"\n`, `command = "${CMD}"\n${ENV_LINE}\n`));
});

test('legacy entry with user settings and an env subtable keeps them', () => {
  const before = `[mcp_servers.chrome-devtools]\ncommand = "${CMD}"\nstartup_timeout_sec = 90\ntool_timeout_sec = 120\n\n` +
    `[mcp_servers.chrome-devtools.env]\nCHROME_REMOTE_DEBUGGING_PORT = "9333"\n`;
  const { text } = planCodex(before, CMD);
  assert.equal(text, before.replace(`command = "${CMD}"\n`, `command = "${CMD}"\n${ENV_LINE}\n`));
  // The subtable belongs to the user; it is outside the edited block.
  assert.ok(text.endsWith(`[mcp_servers.chrome-devtools.env]\nCHROME_REMOTE_DEBUGGING_PORT = "9333"\n`));
});

test('owned entry with a partial single-line env_vars keeps user names and adds the rest', () => {
  const before = `[mcp_servers."chrome-devtools"]\ncommand = '${CMD}'\nenv_vars = ["MY_TOKEN_PATH", 'HTTP_PROXY']  # mine\n`;
  const { text, result } = planCodex(before, CMD);
  const missing = ENV_NAMES.filter(n => n !== 'HTTP_PROXY');
  assert.equal(result, `upgraded: added ${missing.join(', ')} to env_vars`);
  assert.equal(text, `[mcp_servers."chrome-devtools"]\ncommand = '${CMD}'\n` +
    `env_vars = [${['MY_TOKEN_PATH', 'HTTP_PROXY', ...missing].map(n => JSON.stringify(n)).join(', ')}]  # mine\n`);
});

test('owned entry with a multi-line env_vars is merged into one line', () => {
  const before = `[mcp_servers.chrome-devtools]\ncommand = "${CMD}"\nenv_vars = [\n  "EXTRA",\n  "NO_PROXY",\n]\nstartup_timeout_sec = 30\n`;
  const { text } = planCodex(before, CMD);
  const missing = ENV_NAMES.filter(n => n !== 'NO_PROXY');
  assert.equal(text, `[mcp_servers.chrome-devtools]\ncommand = "${CMD}"\n` +
    `env_vars = [${['EXTRA', 'NO_PROXY', ...missing].map(n => JSON.stringify(n)).join(', ')}]\nstartup_timeout_sec = 30\n`);
});

test('owned entry whose env_vars already covers the allowlist is left unchanged', () => {
  const before = `[mcp_servers.chrome-devtools]\ncommand = "${CMD}"\nenv_vars = ["EXTRA", ${ENV_NAMES.map(n => `'${n}'`).join(', ')}]\n`;
  assert.deepEqual(planCodex(before, CMD), { text: null, result: 'already registered' });
});

test('owned entry with inline-table env_vars is not rewritten; the message names what to add', () => {
  const before = `[mcp_servers.chrome-devtools]\ncommand = "${CMD}"\nenv_vars = [{ name = "HTTP_PROXY", source = "local" }]\n`;
  const { text, result } = planCodex(before, CMD);
  assert.equal(text, null);
  assert.match(result, /^left alone: .*custom layout; add HTTPS_PROXY, /);
  assert.ok(!result.includes('add HTTP_PROXY,'));
});

test('CRLF files keep CRLF on the inserted line', () => {
  const before = `x = 1\r\n\r\n[mcp_servers.chrome-devtools]\r\ncommand = "${CMD}"\r\nstartup_timeout_sec = 30\r\n`;
  const { text } = planCodex(before, CMD);
  assert.equal(text, before.replace(`command = "${CMD}"\r\n`, `command = "${CMD}"\r\n${ENV_LINE}\r\n`));
});

test('user entries in every header spelling are left alone', () => {
  for (const header of ['chrome-devtools', '"chrome-devtools"', "'chrome-devtools'"]) {
    const before = `[mcp_servers.${header}]\ncommand = "custom"\n# sbx-browser-mcp is mentioned only in a comment\n`;
    const { text, result } = planCodex(before, CMD);
    assert.equal(text, null, header);
    assert.match(result, /^left alone: /);
  }
});

test('ownership is decided by the command (and legacy npx args) only', () => {
  for (const c of [CMD, '/usr/local/bin/sbx-browser-mcp', 'chrome-devtools-mcp']) assert.equal(isOurCommand(c), true, c);
  assert.equal(isOurCommand('npx', ['-y', 'chrome-devtools-mcp@latest', '--browser-url=http://127.0.0.1:9222']), true);
  assert.equal(isOurCommand('npx', ['chrome-devtools-mcp']), true);
  for (const [c, a] of [['/usr/bin/other', []], ['/home/me/my-sbx-browser-mcp-fork', []], ['sbx-browser-mcp.sh', []],
    ['npx', ['other-mcp', '--note=chrome-devtools-mcp']], ['npx', []], [undefined, []], [['sbx-browser-mcp'], []]])
    assert.equal(isOurCommand(c, a), false, JSON.stringify([c, a]));
});

test('a Codex user entry that only mentions the kit in a comment or another key stays user-owned', () => {
  for (const before of [
    '[mcp_servers.chrome-devtools]\ncommand = "/usr/bin/other" # formerly sbx-browser-mcp\n',
    '[mcp_servers.chrome-devtools]\ncommand = "/home/me/my-sbx-browser-mcp-fork"\n',
    '[mcp_servers.chrome-devtools]\ncommand = "/usr/bin/other"\nargs = ["--wrap", "/opt/sbx-chromium/bin/sbx-browser-mcp"]\n',
    '[mcp_servers.chrome-devtools]\n# command = "/opt/sbx-chromium/bin/sbx-browser-mcp"\ncommand = "/usr/bin/other"\n',
  ]) {
    const { text, result } = planCodex(before, CMD);
    assert.equal(text, null, before);
    assert.match(result, /^left alone: /);
  }
});

test('an unclosed env_vars array is a configuration error', () => {
  const before = `[mcp_servers.chrome-devtools]\ncommand = "${CMD}"\nenv_vars = ["HTTP_PROXY",\n`;
  assert.throws(() => planCodex(before, CMD), e => e instanceof RegisterError && /not closed/.test(e.message));
});

// ── main(): the installed script's behaviour on disk ─────────────────────────
test('installed entry: first run registers, repeated run changes nothing', () => {
  const s = sandbox();
  try {
    fs.writeFileSync(s.config, 'approval_policy = "never"\n');
    const first = s.run();
    assert.equal(first.failed, 0);
    assert.match(first.out, /codex: registered in /);
    const text = fs.readFileSync(s.config, 'utf8');
    assert.ok(text.startsWith('approval_policy = "never"\n'));
    assert.ok(text.includes(ENV_LINE));
    fs.utimesSync(s.config, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
    const mtime = fs.statSync(s.config).mtimeMs;
    const second = s.run();
    assert.match(second.out, /codex: already registered/);
    assert.equal(fs.readFileSync(s.config, 'utf8'), text);
    assert.equal(fs.statSync(s.config).mtimeMs, mtime);
  } finally { s.cleanup(); }
});

test('legacy entry on disk: upgraded once, then already registered; file mode kept', () => {
  const s = sandbox();
  try {
    fs.writeFileSync(s.config, `approval_policy = "never"\n${LEGACY}`, { mode: 0o600 });
    fs.chmodSync(s.config, 0o600);
    assert.match(s.run().out, /codex: upgraded: added env_vars in /);
    const text = fs.readFileSync(s.config, 'utf8');
    assert.equal(text, `approval_policy = "never"\n${LEGACY}`.replace(`command = "${CMD}"\n`, `command = "${CMD}"\n${ENV_LINE}\n`));
    assert.equal(fs.statSync(s.config).mode & 0o777, 0o600);
    assert.match(s.run().out, /codex: already registered/);
    assert.equal(fs.readFileSync(s.config, 'utf8'), text);
  } finally { s.cleanup(); }
});

test('user entry on disk is byte-identical after a run', () => {
  const s = sandbox();
  try {
    const before = "[mcp_servers.'chrome-devtools']\ncommand = \"custom\"\n";
    fs.writeFileSync(s.config, before);
    assert.match(s.run().out, /codex: left alone: /);
    assert.equal(fs.readFileSync(s.config, 'utf8'), before);
  } finally { s.cleanup(); }
});

test('--quiet hides progress but still reports failures, and other agents continue', () => {
  const s = sandbox(['codex', 'claude']);
  try {
    fs.mkdirSync(s.config);  // a directory where the config file should be: EISDIR on read
    const r = s.run('--quiet');
    assert.equal(r.failed, 1);
    assert.match(r.out, /codex: failed: cannot read .*config\.toml \(EISDIR\); fix its permissions/);
    assert.ok(!r.out.includes('claude:'), 'quiet run printed progress');
    const claude = JSON.parse(fs.readFileSync(path.join(s.env.HOME, '.claude.json'), 'utf8'));
    assert.equal(claude.mcpServers['chrome-devtools'].command, CMD);
  } finally { s.cleanup(); }
});

const MARKER = 'SYNTHETIC_REGISTER_SECRET_not_json';

test('invalid JSON config is skipped with an actionable message that never quotes its content', () => {
  const s = sandbox(['claude', 'gemini']);
  try {
    const claude = path.join(s.env.HOME, '.claude.json'), gemini = path.join(s.env.HOME, '.gemini', 'settings.json');
    fs.mkdirSync(path.dirname(gemini));
    fs.writeFileSync(claude, MARKER);
    fs.writeFileSync(gemini, `{"token": "${MARKER}", oops}`);
    const { out } = s.run();
    assert.match(out, /claude: skipped: .*\.claude\.json is not valid JSON; fix or remove it, then run sbx-browser-register again/);
    assert.match(out, /gemini: skipped: .*settings\.json is not valid JSON; fix or remove it/);
    assert.ok(!out.includes('SYNTHETIC'), 'config content leaked into the output');
    assert.equal(fs.readFileSync(claude, 'utf8'), MARKER);
  } finally { s.cleanup(); }
});

test('Codex messages never quote config content', () => {
  const s = sandbox();
  try {
    for (const text of [
      `secret = "${MARKER}"\n[mcp_servers.chrome-devtools]\ncommand = "${CMD}"\nenv_vars = ["${MARKER}",\n`,
      `[mcp_servers.chrome-devtools]\ncommand = "/usr/bin/${MARKER}"\n`,
      `[mcp_servers.chrome-devtools]\ncommand = "${CMD}"\nenv_vars = [{ name = "${MARKER}" }]\n`,
    ]) {
      fs.writeFileSync(s.config, text);
      const { out } = s.run();
      assert.match(out, /codex: (failed|left alone): /);
      assert.ok(!out.includes('SYNTHETIC'), `config content leaked: ${out}`);
      assert.equal(fs.readFileSync(s.config, 'utf8'), text);
    }
  } finally { s.cleanup(); }
});

test('JSON user entries that mention the kit only in env or other keys are left alone', () => {
  const s = sandbox(['claude', 'gemini', 'cursor-agent', 'opencode']);
  try {
    const H = s.env.HOME;
    const files = {
      claude: [path.join(H, '.claude.json'), { mcpServers: { 'chrome-devtools': { type: 'stdio', command: '/usr/bin/other', args: [], env: { NOTE: 'formerly sbx-browser-mcp' } } } }],
      gemini: [path.join(H, '.gemini', 'settings.json'), { mcpServers: { 'chrome-devtools': { command: '/usr/bin/other', args: ['--note=chrome-devtools-mcp'] } } }],
      cursor: [path.join(H, '.cursor', 'mcp.json'), { mcpServers: { 'chrome-devtools': { command: '/home/me/my-sbx-browser-mcp-fork', description: 'sbx-browser-mcp' } } }],
      opencode: [path.join(H, '.config', 'opencode', 'opencode.json'), { mcp: { 'chrome-devtools': { type: 'local', command: ['/usr/bin/other', 'chrome-devtools-mcp-note'], environment: { X: 'sbx-browser-mcp' } } } }],
    };
    const before = {};
    for (const [name, [file, doc]] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, before[name] = JSON.stringify(doc, null, 2) + '\n');
    }
    const { out } = s.run();
    for (const [name, [file]] of Object.entries(files)) {
      assert.match(out, new RegExp(`${name}: left alone: `), name);
      assert.equal(fs.readFileSync(file, 'utf8'), before[name], name);
    }
  } finally { s.cleanup(); }
});

test('JSON entries that run the kit, including the v2 npx entry, are replaced; other keys kept', () => {
  const s = sandbox(['claude', 'gemini', 'opencode']);
  try {
    const H = s.env.HOME;
    const claude = path.join(H, '.claude.json'), gemini = path.join(H, '.gemini', 'settings.json'), opencode = path.join(H, '.config', 'opencode', 'opencode.json');
    fs.writeFileSync(claude, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' }, 'chrome-devtools': { command: 'npx', args: ['chrome-devtools-mcp@latest', '--browser-url=http://127.0.0.1:9222'] } } }));
    fs.mkdirSync(path.dirname(gemini)); fs.mkdirSync(path.dirname(opencode), { recursive: true });
    fs.writeFileSync(gemini, JSON.stringify({ mcpServers: { 'chrome-devtools': { command: '/old/prefix/bin/sbx-browser-mcp', args: [] } } }));
    fs.writeFileSync(opencode, JSON.stringify({ mcp: { 'chrome-devtools': { type: 'local', command: ['/old/bin/sbx-browser-mcp'], enabled: true } } }));
    const { out } = s.run();
    for (const name of ['claude', 'gemini', 'opencode']) assert.match(out, new RegExp(`${name}: registered in `), name);
    const c = JSON.parse(fs.readFileSync(claude, 'utf8'));
    assert.equal(c.theme, 'dark'); assert.deepEqual(c.mcpServers.other, { command: 'x' });
    assert.deepEqual(c.mcpServers['chrome-devtools'], { type: 'stdio', command: CMD, args: [], env: {} });
    assert.deepEqual(JSON.parse(fs.readFileSync(gemini, 'utf8')).mcpServers['chrome-devtools'], { command: CMD, args: [] });
    assert.deepEqual(JSON.parse(fs.readFileSync(opencode, 'utf8')).mcp['chrome-devtools'], { type: 'local', command: [CMD], enabled: true });
    assert.match(s.run().out, /claude: already registered/);
  } finally { s.cleanup(); }
});

test('an unexpected fault propagates instead of being reported as a config problem', () => {
  const s = sandbox();
  try {
    delete s.env.HOME;  // path.join(undefined) is a programming error, not a config state
    assert.throws(() => s.run(), TypeError);
  } finally { s.cleanup(); }
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); process.stdout.write(`ok - ${name}\n`); }
  catch (e) {
    // A failed assertion is a test result; any other error is a broken test and propagates.
    if (!(e instanceof assert.AssertionError)) throw e;
    failed++;
    process.stdout.write(`not ok - ${name}\n${e.stack}\n`);
  }
}
if (failed) { process.stdout.write(`register-test: ${failed} of ${tests.length} failed\n`); process.exitCode = 1; }
else process.stdout.write(`register-test: all ${tests.length} passed\n`);
