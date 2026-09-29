// Drives sbx-browser-mcp over stdio the way an agent does: initialize, list
// tools, open a page that registers a WebMCP tool, find it, call it.
import { spawn } from 'node:child_process';
import http from 'node:http';

// Chromium 154 exposes the API as document.modelContext; the draft spec says
// navigator.modelContext. Either works for the test.
const page = `<!doctype html><title>webmcp</title><script>
(navigator.modelContext || document.modelContext).registerTool({
  name: 'add',
  description: 'Adds two numbers',
  inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  execute: async ({ a, b }) => ({ content: [{ type: 'text', text: 'sum=' + (a + b) }] }),
});
</script><p>WebMCP test page</p>`;
const server = http.createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(page); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

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
  console.log('webmcp: ok');
} finally {
  mcp.kill();
  server.close();
}
