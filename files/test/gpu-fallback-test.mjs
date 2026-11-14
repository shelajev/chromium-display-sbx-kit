// Real-browser GPU policy check over CDP: starts the shared browser through
// sbx-chrome with the caller's environment, confirms the policy reached the
// browser's argv, reads Chromium's own GPU status, and renders a synthetic
// page whose pixels are read back as numbers (no screenshots, no input).
// Usage: node gpu-fallback-test.mjs <sbx-chrome> <default|software> [expected mode]
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);
const [bin, policy, expectMode] = process.argv.slice(2);
assert.ok(bin && ['default', 'software'].includes(policy), 'usage: gpu-fallback-test.mjs <sbx-chrome> <default|software>');
const port = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || 9222);
const devices = ['/dev/dri', ...fs.readdirSync('/dev').filter(f => f.startsWith('nvidia')).map(f => `/dev/${f}`)].filter(f => fs.existsSync(f));

function cdp(url) {
  const ws = new WebSocket(url), pending = new Map();
  let id = 0;
  ws.onmessage = ({data}) => {
    const m = JSON.parse(data);
    if (pending.has(m.id)) { const [res, rej] = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  };
  const open = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, [res, rej]);
    ws.send(JSON.stringify({id: n, method, params, ...(sessionId ? {sessionId} : {})}));
  });
  // Wait for our own socket to close so it is not open across sbx-chrome stop.
  return {open, send, close: () => new Promise(r => { if (ws.readyState === WebSocket.CLOSED) return r(); ws.onclose = () => r(); ws.close(); })};
}

// Runs inside the synthetic page: Canvas2D, WebGL, rAF and layout, as data.
const probe = async () => {
  const out = {};
  const c = document.createElement('canvas'); c.width = c.height = 4;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(255,0,0)'; g.fillRect(0, 0, 2, 4);
  g.fillStyle = 'rgb(0,0,255)'; g.fillRect(2, 0, 2, 4);
  out.canvas2d = [...g.getImageData(0, 0, 1, 1).data, ...g.getImageData(3, 3, 1, 1).data];
  const w = document.createElement('canvas').getContext('webgl');
  if (w) {
    w.clearColor(0, 1, 0, 1); w.clear(w.COLOR_BUFFER_BIT);
    const px = new Uint8Array(4); w.readPixels(0, 0, 1, 1, w.RGBA, w.UNSIGNED_BYTE, px);
    const dbg = w.getExtension('WEBGL_debug_renderer_info');
    out.webgl = {pixel: [...px], renderer: dbg ? w.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : w.getParameter(w.RENDERER)};
  } else out.webgl = null;
  // Text: layout, real glyph ink on a canvas, and distinct generic families.
  const t = document.createElement('span'); t.id = 'text'; t.style.font = '48px sans-serif';
  t.textContent = 'sbx-chromium renders text'; document.body.append(t);
  const tr = t.getBoundingClientRect(); out.textBox = [tr.width, tr.height];
  const tc = document.createElement('canvas'); tc.width = 800; tc.height = 80;
  const tg = tc.getContext('2d'); tg.fillStyle = '#fff'; tg.fillRect(0, 0, 800, 80);
  tg.fillStyle = '#000'; tg.font = '48px sans-serif'; tg.fillText(t.textContent, 0, 60);
  const ink = tg.getImageData(0, 0, 800, 80).data; out.textInk = 0;
  for (let i = 0; i < ink.length; i += 4) if (ink[i] < 128) out.textInk++;
  out.textWidths = ['48px sans-serif', '48px monospace'].map(f => { tg.font = f; return tg.measureText(t.textContent).width; });
  const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:10px;top:20px;width:30px;height:40px';
  document.body.append(d);
  const r = d.getBoundingClientRect(); out.rect = [r.x, r.y, r.width, r.height];
  out.raf = await Promise.race([new Promise(r => requestAnimationFrame(t => r(t > 0))), new Promise(r => setTimeout(() => r(false), 5000))]);
  return JSON.stringify(out);
};

await exec(bin, ['start']);
let client;
try {
  const diag = JSON.parse((await exec(bin, ['diag'])).stdout);
  assert.equal(diag.cdpHealthy, true); assert.equal(diag.pids.length, 1);
  if (expectMode) assert.equal(diag.mode, expectMode);
  const argv = fs.readFileSync(`/proc/${diag.pids[0]}/cmdline`, 'utf8').split('\0');
  const forced = ['--disable-gpu', '--disable-gpu-compositing'].filter(f => argv.includes(f));
  assert.deepEqual(forced, policy === 'software' ? ['--disable-gpu', '--disable-gpu-compositing'] : [], `browser argv: ${forced}`);
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  client = cdp(version.webSocketDebuggerUrl); await client.open;
  const {gpu} = await client.send('SystemInfo.getInfo');
  const {processInfo} = await client.send('SystemInfo.getProcessInfo');
  const {targetId} = await client.send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await client.send('Target.attachToTarget', {targetId, flatten: true});
  const {result, exceptionDetails} = await client.send('Runtime.evaluate', {expression: `(${probe})()`, awaitPromise: true, returnByValue: true}, sessionId);
  assert.ok(!exceptionDetails, JSON.stringify(exceptionDetails));
  const page = JSON.parse(result.value);
  // Which font files Chromium actually shaped the text with.
  await client.send('DOM.enable', {}, sessionId); await client.send('CSS.enable', {}, sessionId);
  const {root} = await client.send('DOM.getDocument', {}, sessionId);
  const {nodeId} = await client.send('DOM.querySelector', {nodeId: root.nodeId, selector: '#text'}, sessionId);
  const {fonts} = await client.send('CSS.getPlatformFontsForNode', {nodeId}, sessionId);
  page.platformFonts = fonts.map(f => `${f.familyName}:${f.glyphCount}`);
  await client.send('Target.closeTarget', {targetId});
  const report = {
    policy, mode: diag.mode, renderDevices: devices, forcedFlags: forced,
    gpuProcess: processInfo.some(p => p.type === 'GPU' || p.type === 'gpu'),
    featureStatus: gpu.featureStatus,
    devices: gpu.devices.map(d => `${d.vendorString || d.vendorId} ${d.deviceString || d.deviceId}`.trim()),
    glRenderer: gpu.auxAttributes?.gl_renderer, ...page,
  };
  console.log(JSON.stringify(report));
  // Rendering must be correct whatever path Chromium negotiated.
  assert.deepEqual(page.canvas2d, [255, 0, 0, 255, 0, 0, 255, 255]);
  assert.deepEqual(page.rect, [10, 20, 30, 40]);
  assert.equal(page.raf, true);
  assert.ok(page.textBox[0] > 300 && page.textBox[1] > 30, `text layout ${page.textBox}`);
  assert.ok(page.textInk > 1000, `text ink ${page.textInk}`);
  assert.ok(page.textWidths[0] > 0 && page.textWidths[1] > 0 && page.textWidths[0] !== page.textWidths[1], `font widths ${page.textWidths}`);
  assert.ok(fonts.length && fonts.reduce((n, f) => n + f.glyphCount, 0) >= 23, `platform fonts ${page.platformFonts}`);
  if (page.webgl) assert.deepEqual(page.webgl.pixel, [0, 255, 0, 255]);
  assert.ok(Object.keys(gpu.featureStatus || {}).length, 'Chromium reported no GPU feature status');
  if (policy === 'software') assert.equal(gpu.featureStatus.gpu_compositing, 'disabled_software');
  console.log(`gpu policy ${policy} (${diag.mode}, ${devices.length ? 'render devices present' : 'no render device'}): ok`);
} finally {
  await client?.close();
  await exec(bin, ['stop']);
}
