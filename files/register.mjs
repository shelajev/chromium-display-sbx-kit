// Registers the chrome-devtools MCP server with each installed agent, in the
// agent's user-level config — never the workspace, which is the user's repo.
//
// A mixin cannot ship these files: each is also written by the agent kit and
// by the agent itself, and a layer replaces a file rather than merging into
// it. So this merges at create (after the agent kit's own install hooks,
// which `integrates` orders first) and again at boot, touching a file only
// when the entry is missing.
//
// An existing `chrome-devtools` entry that points somewhere else is the
// user's choice and is left as it is, with a note on stderr.
import fs from 'node:fs';
import path from 'node:path';

const [, , command, ...flags] = process.argv;
const quiet = flags.includes('--quiet');
const NAME = 'chrome-devtools';
const home = process.env.HOME;
const log = msg => { if (!quiet) process.stderr.write(`sbx-browser-register: ${msg}\n`); };

function onPath(bin) {
  return (process.env.PATH || '').split(':').some(dir => {
    try { fs.accessSync(path.join(dir, bin), fs.constants.X_OK); return true; } catch { return false; }
  });
}

// Write beside the target and rename over it, so a reader never sees half a
// file and a failure leaves the original intact.
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.sbx-browser.${process.pid}`;
  let mode = 0o644;
  try { mode = fs.statSync(file).mode & 0o777; } catch {}
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}

// Merge `entry` at obj[key][NAME] in a JSON file. Returns what happened.
function mergeJson(file, key, entry, isOurs) {
  let doc = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    if (raw.trim()) {
      try { doc = JSON.parse(raw); } catch (e) {
        return `skipped: ${file} is not valid JSON (${e.message})`;
      }
    }
  }
  const servers = (doc[key] ??= {});
  const current = servers[NAME];
  if (current && JSON.stringify(current) === JSON.stringify(entry)) return 'already registered';
  if (current && !isOurs(current)) return `left alone: ${file} already has a different '${NAME}' entry`;
  servers[NAME] = entry;
  writeAtomic(file, `${JSON.stringify(doc, null, 2)}\n`);
  return `registered in ${file}`;
}

// The v2 kit's entry (npx chrome-devtools-mcp --browser-url=…:9222) counts as
// ours too, so upgrading replaces it instead of leaving it behind.
const mentionsUs = e => JSON.stringify(e).includes('sbx-browser-mcp') || JSON.stringify(e).includes('chrome-devtools-mcp');

const agents = [
  {
    name: 'claude',
    present: () => onPath('claude'),
    // User scope: top-level mcpServers in ~/.claude.json.
    run: () => mergeJson(path.join(home, '.claude.json'), 'mcpServers',
      { type: 'stdio', command, args: [], env: {} }, mentionsUs),
  },
  {
    name: 'gemini',
    present: () => onPath('gemini'),
    run: () => mergeJson(path.join(home, '.gemini', 'settings.json'), 'mcpServers',
      { command, args: [] }, mentionsUs),
  },
  {
    name: 'cursor',
    present: () => onPath('cursor-agent'),
    run: () => mergeJson(path.join(home, '.cursor', 'mcp.json'), 'mcpServers',
      { command, args: [] }, mentionsUs),
  },
  {
    name: 'opencode',
    present: () => onPath('opencode'),
    run: () => mergeJson(path.join(home, '.config', 'opencode', 'opencode.json'), 'mcp',
      { type: 'local', command: [command], enabled: true }, mentionsUs),
  },
  {
    name: 'codex',
    present: () => onPath('codex'),
    // TOML, so append rather than parse: a new table at the end of the file
    // cannot capture keys that belong to another one. Both header spellings
    // count as present.
    run: () => {
      const file = path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'config.toml');
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (/^\[mcp_servers\.(chrome-devtools|"chrome-devtools")\]/m.test(text)) return 'already registered';
      const block = `\n[mcp_servers.${NAME}]\ncommand = ${JSON.stringify(command)}\nstartup_timeout_sec = 30\n`;
      writeAtomic(file, text + (text && !text.endsWith('\n') ? '\n' : '') + block);
      return `registered in ${file}`;
    },
  },
];

let found = 0;
for (const agent of agents) {
  if (!agent.present()) continue;
  found++;
  try {
    log(`${agent.name}: ${agent.run()}`);
  } catch (e) {
    // One agent's broken config must not stop the others, or fail the hook.
    log(`${agent.name}: failed: ${e.message}`);
  }
}
if (!found) log('no supported agent found on PATH (claude, codex, gemini, cursor-agent, opencode)');
