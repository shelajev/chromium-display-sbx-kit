// Drives sbx-browser-mcp over stdio the way an agent does: initialize, list
// tools, open a page that registers a WebMCP tool, find it, call it.
import { spawn, execFile } from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const exec = promisify(execFile);
const chrome = path.join(path.dirname(process.argv[2]), 'sbx-chrome');
import http from 'node:http';

// Chromium versions may expose the API as document.modelContext; the draft spec says
// navigator.modelContext. Either works for the test.
const page = `<!doctype html><title>webmcp</title><script>
if (location.pathname === '/seed') localStorage.setItem('sbx_test', 'retained');
(navigator.modelContext || document.modelContext).registerTool({
  name: 'add',
  description: 'Adds two numbers',
  inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  execute: async ({ a, b }) => ({ content: [{ type: 'text', text: 'sum=' + (a + b) }] }),
});
(navigator.modelContext || document.modelContext).registerTool({
 name: 'saved_state', description: 'Checks synthetic test persistence', inputSchema: {type: 'object', properties: {}},
 execute: async () => ({content: [{type: 'text', text: 'cookie=' + document.cookie.includes('sbx_login=retained') + ' storage=' + (localStorage.getItem('sbx_test') === 'retained')}]})
});
</script><p>WebMCP test page</p>`;
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); if (req.url === '/seed') res.setHeader('Set-Cookie', 'sbx_login=retained; Max-Age=3600; Path=/'); res.end(page); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/seed`;

const mcp = spawn(process.argv[2], [], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '', id = 0;
const pending = new Map();
mcp.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line); // anything that is not JSON-RPC on stdout is a bug
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  const t = setTimeout(() => reject(new Error(`timeout: ${method}`)), Number(process.env.MCP_TEST_TIMEOUT_MS || 60000));
  pending.set(n, m => { clearTimeout(t); m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result); });
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
});
const call = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = (r.content || []).map(c => c.text || '').join('\n');
  if (r.isError) throw new Error(`${name}: ${text}`);
  return text;
};

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const { tools } = await rpc('tools/list');
  const names = tools.map(t => t.name);
  for (const want of ['navigate_page', 'take_snapshot', 'list_webmcp_tools', 'execute_webmcp_tool']) {
    if (!names.includes(want)) throw new Error(`missing tool ${want}; have ${names.join(', ')}`);
  }
  console.log(`tools: ${names.length}`);
  // Page tools take the page they act on; the shared browser opens on one.
  const pages = await call('list_pages');
  const pageId = Number((pages.match(/^\D*(\d+):/m) || [])[1]);
  if (!Number.isInteger(pageId)) throw new Error(`list_pages:\n${pages}`);
  await call('navigate_page', { pageId, type: 'url', url });
  const snap = await call('take_snapshot', { pageId });
  if (!snap.includes('WebMCP test page')) throw new Error(`snapshot:\n${snap}`);
  const listed = await call('list_webmcp_tools', { pageId });
  if (!listed.includes('add')) throw new Error(`list_webmcp_tools:\n${listed}`);
  const out = await call('execute_webmcp_tool', { pageId, toolName: 'add', input: JSON.stringify({ a: 2, b: 3 }) });
  if (!out.includes('sum=5')) throw new Error(`execute_webmcp_tool:\n${out}`);
  const seeded = await call('execute_webmcp_tool', {pageId, toolName:'saved_state', input:'{}'});
  if (!seeded.includes('cookie=true storage=true')) throw new Error('synthetic state was not seeded');
  console.log('webmcp: ok');
  await Promise.all(Array.from({length: 4}, (_, i) => exec(chrome, i % 2 ? [url + '?q=hello%20world#marker'] : ['start'])));
  if (!(await call('list_pages')).includes('?q=hello%20world#marker')) throw new Error('open tab lost URL escapes or fragment');
  const before = JSON.parse((await exec(chrome, ['diag'])).stdout);
  if (before.pids.length !== 1) throw new Error('concurrent start created duplicate browsers');
  // A real Chromium owns this profile; changing the CDP port must neither
  // delete its SingletonLock nor terminate it.
  let refused = false;
  try { await exec(chrome, ['start'], {env: {...process.env, CHROME_REMOTE_DEBUGGING_PORT: '19397'}}); }
  catch (e) { refused = /live owner/.test(e.stderr); }
  if (!refused || !JSON.parse((await exec(chrome, ['diag'])).stdout).running) throw new Error('live profile owner was not protected');
  await exec(chrome, ['restart', url.replace('/seed','/verify')]);
  // Keep this MCP stdio process open: the next tool must reconnect itself.
  const afterPages = await call('list_pages');
  const afterId = Number((afterPages.match(/^\D*(\d+):/m) || [])[1]);
  if (!Number.isInteger(afterId)) throw new Error('no page after restart');
  await call('navigate_page', {pageId: afterId, type: 'url', url: url.replace('/seed','/verify')});
  if (!(await call('take_snapshot', {pageId: afterId})).includes('WebMCP test page')) throw new Error('snapshot after restart failed');
  const saved = await call('execute_webmcp_tool', {pageId: afterId, toolName: 'saved_state', input: '{}'});
  if (!saved.includes('cookie=true storage=true')) throw new Error('profile did not persist: '+saved);
  const again = await call('execute_webmcp_tool', {pageId: afterId, toolName: 'add', input: JSON.stringify({a:2,b:3})});
  if (!again.includes('sum=5')) throw new Error('WebMCP after restart failed');
  const after = JSON.parse((await exec(chrome, ['diag'])).stdout);
  if (after.pids.length !== 1 || after.pids[0] === before.pids[0]) throw new Error('restart did not replace the single browser');
  console.log('restart, MCP reattach, cookie/localStorage persistence: ok');
} finally {
  mcp.kill();
  server.closeAllConnections();
  server.close();
}
