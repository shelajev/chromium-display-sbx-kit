// Real Chromium through a synthetic TLS-intercepting proxy, the way an SBX
// guest is wired: HTTP(S)_PROXY names a forward proxy that re-signs TLS with
// its own CA and injects a credential for one destination only. Everything
// here is synthetic — CAs, certificates, hostnames and the credential — and
// lives in a temporary HOME. Run against an installed prefix (PREFIX).
import fs from 'node:fs';
import os from 'node:os';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert/strict';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { execFileSync, spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const PREFIX = process.env.PREFIX;
assert.ok(PREFIX, 'PREFIX is required');
const dir = fs.mkdtempSync(`${os.tmpdir()}/sbx-proxy-ca-test-`);
const TOKEN = `sbx-synthetic-credential-${randomBytes(8).toString('hex')}`;
const timeoutMs = Number(process.env.MCP_TEST_TIMEOUT_MS || 60000);
const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Synthetic PKI ────────────────────────────────────────────────────────────
const openssl = (...a) => execFileSync('openssl', a, {cwd: dir, stdio: ['ignore', 'ignore', 'pipe']});
function ca(name) {
  openssl('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.pem`,
    '-days', '2', '-subj', `/CN=sbx synthetic ${name}`, '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  return {pem: fs.readFileSync(`${dir}/${name}.pem`, 'utf8'), file: `${dir}/${name}.pem`, fingerprint: new X509Certificate(fs.readFileSync(`${dir}/${name}.pem`)).fingerprint256};
}
function leaf(caName, name, dns) {
  fs.writeFileSync(`${dir}/${name}.ext`, `subjectAltName=${dns.map(d => `DNS:${d}`).join(',')}\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\n`);
  openssl('req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${dns[0]}`);
  openssl('x509', '-req', '-in', `${name}.csr`, '-CA', `${caName}.pem`, '-CAkey', `${caName}.key`, '-CAcreateserial', '-days', '2', '-out', `${name}.pem`, '-extfile', `${name}.ext`);
  return tls.createSecureContext({key: fs.readFileSync(`${dir}/${name}.key`), cert: fs.readFileSync(`${dir}/${name}.pem`)});
}
const ca1 = ca('ca1'), untrusted = ca('untrusted'), ca3 = ca('ca3');
const hosts = ['api-a.test', 'api-b.test', 'denied.test'];
const leaves = {ca1: leaf('ca1', 'leaf1', hosts), ca3: leaf('ca3', 'leaf3', hosts)};
const badLeaf = leaf('untrusted', 'bad', ['bad.test']);
const wrongLeaf = leaf('ca1', 'wrong', ['other.test']);
let mitmCa = 'ca1';
const contextFor = host => host === 'bad.test' ? badLeaf : host === 'wrong.test' ? wrongLeaf : leaves[mitmCa];

// ── Synthetic origins, behind the proxy ─────────────────────────────────────
const hits = [], proxyLog = [], trapHits = [];
const authOf = req => req.headers.authorization === `Bearer ${TOKEN}` ? 'injected' : req.headers.authorization ? 'other' : 'plain';
// Destination-scoped: the synthetic credential belongs to api-a.test only. The
// proxy only ever adds it; it never strips headers elsewhere, so whatever the
// browser sent to another destination stays visible as evidence.
function inject(req, host) {
  if (host === 'api-a.test') req.headers.authorization = `Bearer ${TOKEN}`;
}
// `sent` is what arrived from the browser, before the proxy touched it;
// `auth` is what the destination received.
function record(scheme, host, path, req) {
  const sent = authOf(req);
  inject(req, host);
  const entry = {scheme, host, path, sent, auth: authOf(req)};
  hits.push(entry);
  return entry;
}
// Non-leakage at an unapproved destination: there must be evidence, and none
// of it may carry any Authorization header, from the browser or the proxy.
function assertNoLeak(records, label) {
  assert.ok(records.length, `${label}: no requests recorded, nothing proven`);
  for (const r of records) assert.ok(r.sent === 'plain' && r.auth === 'plain', `${label}: ${r.scheme}://${r.host}${r.path} carried a credential (sent=${r.sent}, received=${r.auth})`);
}
function origin(scheme, host, req, res) {
  const path = new URL(req.url, `${scheme}://${host}`).pathname, {auth} = record(scheme, host, path, req);
  const html = body => { res.writeHead(200, {'content-type': 'text/html'}); res.end(`<!doctype html><title>${host}</title>${body}`); };
  if (path === '/') return html(`<p id=r>${host} ${auth}</p>`);
  if (path === '/redirect') { res.writeHead(302, {location: `${scheme}://api-b.test/landing`}); return res.end(); }
  if (path === '/landing') return html(`<p id=r>${host} landing ${auth}</p>`);
  if (path === '/page') return html(`<p id=r>subresources</p><img src="https://api-b.test/pixel"><script>fetch('https://api-b.test/data', {mode: 'no-cors', credentials: 'include'})</script>`);
  if (path === '/pixel') { res.writeHead(200, {'content-type': 'image/gif'}); return res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64')); }
  if (path === '/data') { res.writeHead(200, {'content-type': 'application/json', 'access-control-allow-origin': 'https://api-a.test', 'access-control-allow-credentials': 'true'}); return res.end('{}'); }
  res.writeHead(404); res.end();
}
function websocket(req, socket, reply) {
  socket.on('error', () => {});
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.once('data', frame => {
    const length = frame[1] & 0x7f, mask = frame.subarray(2, 6);
    const text = Buffer.from(frame.subarray(6, 6 + length).map((b, i) => b ^ mask[i % 4])).toString();
    const out = Buffer.from(reply(text));
    socket.write(Buffer.concat([Buffer.from([0x81, out.length]), out]));
  });
}
function originUpgrade(scheme, host, req, socket) {
  const {auth} = record(scheme, host, req.url, req);
  if (req.url !== '/ws') return socket.destroy();
  websocket(req, socket, text => `${host} ${auth} ${text}`);
}
const inner = scheme => {
  const server = http.createServer((req, res) => origin(scheme, req.headers.host.replace(/:\d+$/, ''), req, res));
  server.on('upgrade', (req, socket) => originUpgrade(scheme === 'https' ? 'wss' : 'ws', req.headers.host.replace(/:\d+$/, ''), req, socket));
  server.on('clientError', (e, socket) => socket.destroy());
  return server;
};
const innerHttp = inner('http'), innerHttps = inner('https');

// ── The synthetic intercepting proxy ────────────────────────────────────────
const known = new Set([...hosts, 'bad.test', 'wrong.test']);
const denied = host => host === 'denied.test' || !known.has(host);
// Two identical proxies; `via` says which endpoint carried each request.
function makeProxy(via) {
  const server = http.createServer((req, res) => {
    let url; try { url = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
    proxyLog.push({via, method: req.method, host: url.hostname, port: url.port});
    if (denied(url.hostname)) { res.writeHead(403, {'content-type': 'text/html'}); return res.end('<p id=r>sbx-synthetic-proxy-denied</p>'); }
    origin('http', url.hostname, req, res);
  });
  server.on('connect', (req, socket) => {
    socket.on('error', () => {});
    const [host, port] = req.url.split(':');
    proxyLog.push({via, method: 'CONNECT', host, port});
    if (denied(host)) return socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (port === '80') return innerHttp.emit('connection', socket);
    const secure = new tls.TLSSocket(socket, {isServer: true, secureContext: contextFor(host), ALPNProtocols: ['http/1.1']});
    secure.on('error', () => {});
    innerHttps.emit('connection', secure);
  });
  return server;
}
const proxy = makeProxy('first'), proxy2 = makeProxy('second');

// ── Direct-path traps: *.test resolves here, so a bypass would land on them ──
const trapHandler = (req, res) => { trapHits.push(req.headers.host); res.writeHead(200, {'content-type': 'text/html'}); res.end('<p id=r>sbx-synthetic-trap</p>'); };
const trapHttp = http.createServer(trapHandler);
const trapHttps = https.createServer({SNICallback: (name, cb) => cb(null, leaves.ca1)}, trapHandler);
trapHttps.on('upgrade', (req, socket) => { trapHits.push(req.headers.host); websocket(req, socket, () => 'sbx-synthetic-trap'); });
const local = http.createServer((req, res) => { res.writeHead(200, {'content-type': 'text/html'}); res.end('<p id=r>loopback direct</p>'); });
const servers = [proxy, proxy2, trapHttp, trapHttps, local];
for (const s of servers) await new Promise(r => s.listen(0, '127.0.0.1', r));
const port = s => s.address().port;
const proxyUrl = `http://127.0.0.1:${port(proxy)}`;
const proxyMarker = `127.0.0.1:${port(proxy)}`;
const proxyUrl2 = `http://127.0.0.1:${port(proxy2)}`, proxyMarker2 = `127.0.0.1:${port(proxy2)}`;

// An SBX-shaped guest: proxy variables, the CA in the bundle block and in
// PROXY_CA_CERT_B64, loopback in NO_PROXY.
const home = `${dir}/home`;
fs.mkdirSync(home);
const bundle = `${dir}/ca-certificates.crt`;
fs.writeFileSync(bundle, `# public roots would be here\n# BEGIN docker-sandboxes proxy-ca\n${ca1.pem}# END docker-sandboxes proxy-ca\n`);
const base = {...process.env, HOME: home, XDG_STATE_HOME: `${dir}/state`, SBX_CHROME_HEADLESS: '1'};
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'PROXY_CA_CERT_B64', 'SBX_PROXY_CA_FILE', 'SBX_PROXY_MODE', 'SSL_CERT_FILE']) { delete base[k]; delete base[k.toLowerCase()]; }
const proxied = {...base, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl,
  NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1', SSL_CERT_FILE: bundle, PROXY_CA_CERT_B64: Buffer.from(ca1.pem).toString('base64')};

// ── A minimal CDP client ────────────────────────────────────────────────────
async function cdp(endpoint) {
  const version = await (await fetch(`${endpoint}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('CDP connect failed')); });
  let id = 0; const pending = new Map(), listeners = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else for (const l of listeners) l(m);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id, t = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), timeoutMs);
    pending.set(n, m => { clearTimeout(t); m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result); });
    ws.send(JSON.stringify({id: n, method, params, sessionId}));
  });
  async function page() {
    const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
    const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
    const evaluate = async expression => (await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, sessionId)).result.value;
    return {
      evaluate,
      async go(url) {
        const r = await send('Page.navigate', {url}, sessionId);
        if (r.errorText) return {error: r.errorText};
        for (const end = Date.now() + timeoutMs; Date.now() < end; await delay(100)) {
          if (await evaluate('document.readyState') === 'complete') return {error: null, text: await evaluate('document.getElementById("r")?.textContent ?? ""'), href: await evaluate('location.href')};
        }
        throw new Error(`load timeout: ${url}`);
      },
      socket: url => evaluate(`new Promise(r => { const ws = new WebSocket(${JSON.stringify(url)}); const t = setTimeout(() => r('timeout'), 20000);
        ws.onopen = () => ws.send('ping'); ws.onmessage = e => { clearTimeout(t); r(e.data); ws.close(); }; ws.onerror = () => { clearTimeout(t); r('error'); }; })`),
    };
  }
  return {send, page, close: () => ws.close()};
}

// Launch the shipped wrapper with its own profile; DevTools on loopback.
async function launch(env, name) {
  const profile = `${dir}/${name}`, log = `${dir}/${name}.log`;
  const fd = fs.openSync(log, 'w');
  const child = spawn(`${PREFIX}/bin/sbx-chromium`, ['--headless', `--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--host-resolver-rules=MAP *.test 127.0.0.1', 'about:blank'], {env, stdio: ['ignore', fd, fd]});
  fs.closeSync(fd);
  let exit = null; child.on('exit', code => { exit = code; });
  for (const end = Date.now() + timeoutMs; Date.now() < end; await delay(100)) {
    if (exit !== null) throw new Error(`${name}: sbx-chromium exited ${exit}: ${fs.readFileSync(log, 'utf8').slice(-2000)}`);
    let text; try { text = fs.readFileSync(`${profile}/DevToolsActivePort`, 'utf8'); } catch { continue; }
    const devtools = text.split('\n')[0];
    if (!devtools) continue;
    const client = await cdp(`http://127.0.0.1:${devtools}`);
    return {client, log, pid: child.pid, async stop() {
      await client.send('Browser.close').catch(() => {}); client.close();
      for (let i = 0; i < 100 && exit === null; i++) await delay(100);
      if (exit === null) child.kill('SIGKILL');
    }};
  }
  throw new Error(`${name}: DevTools did not come up`);
}
function chromiumArgv() {
  return fs.readdirSync('/proc').filter(p => /^\d+$/.test(p)).flatMap(p => {
    try { const a = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8'); return a.startsWith(`${PREFIX}/chromium/`) ? [a] : []; } catch { return []; }
  });
}
function noLeak(label, text) {
  assert.ok(!text.includes(TOKEN), `${label} contains the synthetic credential`);
  assert.ok(!text.includes(proxyMarker) && !text.includes(proxyMarker2), `${label} contains a proxy address`);
  assert.ok(!/route(Key|Hmac)/.test(text) && !routeSecrets.some(v => text.includes(v)), `${label} contains the route identity record`);
  assert.ok(!/--proxy-server|--ignore-certificate-errors|--allow-insecure-localhost/.test(text), `${label} contains a proxy or certificate-bypass flag`);
}
// The stored route key/digest values seen so far; they must never be printed.
const routeSecrets = [];
const trust = await import(`${PREFIX}/libexec/proxy-trust.mjs`);
const hit = (host, path) => hits.filter(h => h.host === host && h.path === path);
const ok = message => console.log(`proxy-ca: ${message}: ok`);

try {
  // 1. The SBX-shaped guest: everything goes through the proxy, trusted.
  const main = await launch(proxied, 'main');
  try {
    const argv = chromiumArgv();
    assert.ok(argv.length, 'no Chromium processes found'); noLeak('Chromium argv', argv.join(' '));
    const tab = await main.client.page();

    assert.equal((await tab.go('http://api-a.test/')).text, 'api-a.test injected');
    assert.equal((await tab.go('https://api-a.test/')).text, 'api-a.test injected');
    assert.equal((await tab.go('https://api-b.test/')).text, 'api-b.test plain');
    assert.ok(proxyLog.some(l => l.method === 'GET' && l.host === 'api-a.test'), 'http:// did not use the proxy');
    assert.ok(proxyLog.some(l => l.method === 'CONNECT' && l.host === 'api-a.test' && l.port === '443'), 'https:// did not tunnel through the proxy');
    ok('http and https routed through the proxy, sandbox CA trusted, injection scoped to api-a.test');

    const redirected = await tab.go('https://api-a.test/redirect');
    assert.equal(redirected.href, 'https://api-b.test/landing');
    assert.deepEqual(hit('api-a.test', '/redirect').map(h => [h.sent, h.auth]), [['plain', 'injected']]);
    assertNoLeak(hit('api-b.test', '/landing'), 'https redirect');
    const redirectedHttp = await tab.go('http://api-a.test/redirect');
    assert.equal(redirectedHttp.href, 'http://api-b.test/landing');
    assertNoLeak(hit('api-b.test', '/landing').filter(h => h.scheme === 'http'), 'http redirect');
    await tab.go('https://api-a.test/page');
    for (const end = Date.now() + timeoutMs; !(hit('api-b.test', '/pixel').length && hit('api-b.test', '/data').length); await delay(100)) assert.ok(Date.now() < end, 'subresources never arrived');
    assert.deepEqual(hit('api-a.test', '/page').map(h => [h.sent, h.auth]), [['plain', 'injected']]);
    assertNoLeak(hit('api-b.test', '/pixel'), 'image subresource');
    assertNoLeak(hit('api-b.test', '/data'), 'fetch subresource');
    ok('cross-origin redirects and subresources do not carry the api-a.test credential');

    await tab.go('http://api-a.test/');
    assert.equal(await tab.socket('ws://api-a.test/ws'), 'api-a.test injected ping');
    assert.equal(await tab.socket('ws://api-b.test/ws'), 'api-b.test plain ping');
    await tab.go('https://api-a.test/');
    assert.equal(await tab.socket('wss://api-a.test/ws'), 'api-a.test injected ping');
    assert.equal(await tab.socket('wss://api-b.test/ws'), 'api-b.test plain ping');
    assert.ok(proxyLog.some(l => l.method === 'CONNECT' && l.host === 'api-a.test' && l.port === '80'), 'ws:// did not tunnel through the proxy');
    assertNoLeak(hit('api-b.test', '/ws').filter(h => h.scheme === 'ws'), 'ws upgrade');
    assertNoLeak(hit('api-b.test', '/ws').filter(h => h.scheme === 'wss'), 'wss upgrade');
    // The browser itself never holds the credential, anywhere.
    assert.ok(hits.every(h => h.sent === 'plain'), 'the browser sent an Authorization header');
    ok('ws:// and wss:// through the proxy, scoped injection on the upgrade');

    // Negative control: the leak check must catch a credential that does reach
    // an unapproved destination, and must not pass on missing evidence.
    await new Promise((resolve, reject) => http.get({host: '127.0.0.1', port: port(proxy), path: 'http://api-b.test/leak-control',
      headers: {host: 'api-b.test', authorization: `Bearer ${TOKEN}`}}, res => { res.resume(); res.on('end', resolve); }).on('error', reject));
    assert.deepEqual(hit('api-b.test', '/leak-control').map(h => [h.sent, h.auth]), [['injected', 'injected']]);
    assert.throws(() => assertNoLeak(hit('api-b.test', '/leak-control'), 'control'), /carried a credential/);
    assert.throws(() => assertNoLeak([], 'control'), /nothing proven/);
    ok('negative control: a credential at an unapproved destination is detected');

    assert.match((await tab.go('https://bad.test/')).error, /ERR_CERT_AUTHORITY_INVALID/);
    assert.match((await tab.go('https://wrong.test/')).error, /ERR_CERT_COMMON_NAME_INVALID/);
    await tab.go('https://api-a.test/');
    assert.equal(await tab.socket('wss://bad.test/ws'), 'error');
    assert.equal(hits.filter(h => ['bad.test', 'wrong.test'].includes(h.host)).length, 0);
    ok('untrusted CA and wrong-hostname certificates rejected (https and wss)');

    const before = proxyLog.length;
    assert.equal((await tab.go(`http://denied.test:${port(trapHttp)}/`)).text, 'sbx-synthetic-proxy-denied');
    assert.match((await tab.go(`https://denied.test:${port(trapHttps)}/`)).error, /ERR_TUNNEL_CONNECTION_FAILED/);
    await tab.go('https://api-a.test/');
    assert.equal(await tab.socket(`wss://denied.test:${port(trapHttps)}/ws`), 'error');
    assert.ok(proxyLog.slice(before).filter(l => l.host === 'denied.test').length >= 3, 'denied requests did not reach the proxy');
    assert.deepEqual(trapHits, [], 'a denied request went around the proxy');
    assert.equal(hits.filter(h => h.host === 'denied.test').length, 0);
    ok('proxy denials (http, https, wss) are final; nothing falls back to direct');

    assert.equal((await tab.go(`http://127.0.0.1:${port(local)}/`)).text, 'loopback direct');
    assert.equal(proxyLog.filter(l => /^(127\.|localhost|\[?::1)/.test(l.host)).length, 0);
    ok('loopback (local servers and DevTools) bypasses the proxy');
  } finally { await main.stop(); }
  noLeak('main browser log', fs.readFileSync(main.log, 'utf8'));

  // 2. The managed browser and the MCP server under the same environment.
  const managed = {...proxied, CHROME_USER_DATA_DIR: `${dir}/managed`, CHROME_REMOTE_DEBUGGING_PORT: '9333'};
  await exec(`${PREFIX}/bin/sbx-chrome`, ['start'], {env: managed});
  try {
    const diagText = (await exec(`${PREFIX}/bin/sbx-chrome`, ['diag'], {env: managed})).stdout;
    noLeak('sbx-chrome diag', diagText);
    const diag = JSON.parse(diagText).proxyCallerEnvironment;
    assert.equal(diag.mode, 'proxy'); assert.equal(diag.nssDbHasCurrentCa, true); assert.equal(diag.caSha256, ca1.fingerprint); assert.equal(diag.noProxyLoopback, true);
    const running = JSON.parse(diagText).proxyRunningBrowser;
    assert.deepEqual({mode: running.mode, http: running.http, https: running.https, caSha256: running.caSha256}, {mode: 'proxy', http: true, https: true, caSha256: ca1.fingerprint});
    assert.match(running.source, /recorded by sbx-chrome at launch; not a check of the live network route/);
    const client = await cdp('http://127.0.0.1:9333');
    const tab = await client.page();
    assert.equal((await tab.go('https://api-a.test/')).text, 'api-a.test injected');
    client.close();
    await exec(process.execPath, [new URL('./mcp-test.mjs', import.meta.url).pathname, `${PREFIX}/bin/sbx-browser-mcp`], {env: managed, timeout: timeoutMs * 3});
    noLeak('managed chrome.log', fs.readFileSync(`${dir}/state/sbx-chromium/chrome.log`, 'utf8'));
    noLeak('Chromium argv', chromiumArgv().join(' '));
  } finally { await exec(`${PREFIX}/bin/sbx-chrome`, ['stop'], {env: managed}); }
  ok('sbx-chrome, CDP on 127.0.0.1 and the MCP server work through the proxy; diag/log/argv carry no proxy address or credential');

  // Route identity. diag keeps the running browser's recorded launch apart
  // from the caller's environment, and a proxy-needing caller never silently
  // reuses a browser launched direct, unrecorded or with another CA.
  const chromeBin = `${PREFIX}/bin/sbx-chrome`;
  const diagOf = async env => JSON.parse((await exec(chromeBin, ['diag'], {env})).stdout);
  const refusedStart = async (env, pattern, bin = chromeBin, args = ['start']) => {
    await assert.rejects(exec(bin, args, {env, timeout: timeoutMs}), e => {
      assert.match(e.stderr, pattern); noLeak('refusal', e.stderr + e.stdout); return true;
    });
  };
  const explicit = {...managed, SBX_PROXY_MODE: 'proxy'};
  const notReusable = /cannot be reused through the sandbox proxy: .*sbx-chrome restart/;
  await exec(chromeBin, ['start'], {env: {...managed, SBX_PROXY_MODE: 'direct'}});
  try {
    const d = await diagOf(managed), pid = d.pids[0];
    assert.equal(d.proxyRunningBrowser.mode, 'direct'); assert.equal(d.proxyRunningBrowser.http, false); assert.equal(d.proxyRunningBrowser.caSha256, null);
    assert.equal(d.proxyCallerEnvironment.mode, 'proxy');
    noLeak('diag after direct start', JSON.stringify(d));
    // (1) explicit proxy and (2) auto with proxy env refuse a direct browser,
    // for start and for the MCP attach path; nothing is restarted.
    await refusedStart(explicit, /launched in direct mode/);
    await refusedStart(managed, /launched in direct mode/);
    await refusedStart(managed, /launched in direct mode/, `${PREFIX}/bin/sbx-browser-mcp`, []);
    assert.deepEqual((await diagOf(managed)).pids, [pid], 'the refused browser was left running untouched');
    // (4) an invalid configuration fails closed, also for restart, which
    // validates before stopping anything.
    const broken = {...managed, HTTP_PROXY: 'invalid', http_proxy: ''};
    await refusedStart(broken, /proxy setup failed: HTTP_PROXY is not a valid URL/);
    await refusedStart(broken, /proxy setup failed: HTTP_PROXY is not a valid URL/, chromeBin, ['restart']);
    assert.deepEqual((await diagOf(managed)).pids, [pid]);
    // A direct caller may reuse it: it asks for no proxy.
    await exec(chromeBin, ['start'], {env: {...managed, SBX_PROXY_MODE: 'direct'}});
    // (5) restart from the mismatched state relaunches through the proxy.
    await exec(chromeBin, ['restart'], {env: managed});
    const r = await diagOf({...managed, SBX_PROXY_MODE: 'direct'});
    assert.notDeepEqual(r.pids, [pid]);
    assert.equal(r.proxyRunningBrowser.mode, 'proxy'); assert.equal(r.proxyRunningBrowser.caSha256, ca1.fingerprint);
    assert.equal(r.proxyCallerEnvironment.mode, 'direct');
    // (3) a compatible recorded launch is reused, by both modes of caller.
    for (const env of [managed, explicit]) {
      await exec(chromeBin, ['start'], {env});
      assert.deepEqual((await diagOf(managed)).pids, r.pids, 'compatible launch reused');
    }
    // Same CA, different route: a changed (valid or unreachable) endpoint or a
    // changed NO_PROXY is refused for explicit and auto callers, for start,
    // `sbx-chrome <URL>` and the MCP pre-attach; the same browser keeps running.
    const sessionPath = `${dir}/state/sbx-chromium/session.json`;
    const sealed = () => { const p = JSON.parse(fs.readFileSync(sessionPath, 'utf8')).proxy; routeSecrets.push(p.routeKey, p.routeHmac); return p; };
    assert.match(sealed().routeHmac, /^[0-9a-f]{64}$/);
    const via = endpoint => ({HTTP_PROXY: endpoint, HTTPS_PROXY: endpoint, http_proxy: endpoint, https_proxy: endpoint});
    const changed = {...managed, ...via(proxyUrl2)};
    const differentRoute = /launched with different proxy endpoints or NO_PROXY bypass rules.*sbx-chrome restart/;
    for (const env of [changed, {...changed, SBX_PROXY_MODE: 'proxy'}, {...managed, ...via('http://127.0.0.1:1'), SBX_PROXY_MODE: 'proxy'}]) {
      await refusedStart(env, differentRoute);
      await refusedStart(env, differentRoute, chromeBin, ['https://api-a.test/']);
      await refusedStart(env, differentRoute, `${PREFIX}/bin/sbx-browser-mcp`, []);
    }
    const noProxyChanged = {...managed, NO_PROXY: 'localhost,127.0.0.1,::1,api-a.test', no_proxy: 'localhost,127.0.0.1,::1,api-a.test'};
    await refusedStart(noProxyChanged, differentRoute);
    await refusedStart({...noProxyChanged, SBX_PROXY_MODE: 'proxy'}, differentRoute, chromeBin, ['https://api-a.test/']);
    assert.deepEqual((await diagOf(managed)).pids, r.pids, 'refusals left the browser running');
    // diag says only whether the records match; no endpoint, key or digest.
    for (const [env, expected] of [[managed, true], [changed, false], [noProxyChanged, false]]) {
      const text = (await exec(chromeBin, ['diag'], {env})).stdout;
      noLeak('diag', text);
      assert.equal(JSON.parse(text).proxyRunningBrowser.matchesCallerRoute, expected);
    }
    // The seal is over the exact NO_PROXY text Chromium receives: a different
    // spelling is refused, even one that might parse alike; the identical text
    // (with the same implicit loopback) is reused.
    for (const spelling of ['::1, LOCALHOST,127.0.0.1', '', 'localhost 127.0.0.1 ::1']) {
      await refusedStart({...managed, NO_PROXY: spelling, no_proxy: spelling, SBX_PROXY_MODE: 'proxy'}, differentRoute);
      assert.deepEqual((await diagOf(managed)).pids, r.pids);
    }
    await exec(chromeBin, ['start'], {env: {...managed, SBX_PROXY_MODE: 'proxy'}});
    assert.deepEqual((await diagOf(managed)).pids, r.pids, 'identical NO_PROXY text is the same route');
    // QC's pair: commas vs an internal space. Chromium routes them
    // differently, so they must seal differently. The space form is one odd
    // entry, so api-a.test still goes through the proxy; the comma form
    // bypasses it for api-a.test.
    const loop = 'localhost,127.0.0.1,::1';
    const spaced = {...managed, NO_PROXY: `${loop},api-a.test api-b.test`, no_proxy: `${loop},api-a.test api-b.test`, SBX_PROXY_MODE: 'proxy'};
    const commas = {...managed, NO_PROXY: `${loop},api-a.test,api-b.test`, no_proxy: `${loop},api-a.test,api-b.test`, SBX_PROXY_MODE: 'proxy'};
    const environOf = pid => Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map(e => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));
    const viaProxy = async () => {
      const before = proxyLog.length, client = await cdp('http://127.0.0.1:9333');
      const result = await (await client.page()).go('https://api-a.test/'); client.close();
      return {result, proxied: proxyLog.slice(before).some(l => l.host === 'api-a.test')};
    };
    await exec(chromeBin, ['restart'], {env: spaced});
    const spacedPid = (await diagOf(spaced)).pids;
    // The sealed bypass text is exactly what the browser process received.
    for (const k of ['no_proxy', 'NO_PROXY']) assert.equal(environOf(spacedPid[0])[k], trust.appliedNoProxy(spaced), k);
    const spacedRoute = await viaProxy();
    assert.equal(spacedRoute.result.text, 'api-a.test injected'); assert.ok(spacedRoute.proxied);
    await refusedStart(commas, differentRoute);
    await refusedStart(commas, differentRoute, chromeBin, ['https://api-a.test/']);
    await refusedStart(commas, differentRoute, `${PREFIX}/bin/sbx-browser-mcp`, []);
    assert.equal((await diagOf(commas)).proxyRunningBrowser.matchesCallerRoute, false);
    assert.deepEqual((await diagOf(spaced)).pids, spacedPid, 'refusal kept the space-form browser');
    // A deliberate restart applies the comma route: api-a.test now bypasses
    // the proxy (and, without a resolver for .test, cannot load directly).
    await exec(chromeBin, ['restart'], {env: commas});
    const commaPid = (await diagOf(commas)).pids;
    assert.notDeepEqual(commaPid, spacedPid);
    for (const k of ['no_proxy', 'NO_PROXY']) assert.equal(environOf(commaPid[0])[k], trust.appliedNoProxy(commas), k);
    assert.equal((await diagOf(commas)).proxyRunningBrowser.matchesCallerRoute, true);
    const commaRoute = await viaProxy();
    assert.ok(commaRoute.result.error, 'api-a.test loaded although the comma route bypasses the proxy'); assert.equal(commaRoute.proxied, false);
    await refusedStart(spaced, differentRoute);
    sealed();
    await exec(chromeBin, ['restart'], {env: managed});
    r.pids = (await diagOf(managed)).pids;
    // A deliberate restart takes the new endpoint, and traffic follows it.
    await exec(chromeBin, ['restart'], {env: changed});
    const moved = await diagOf(changed);
    assert.notDeepEqual(moved.pids, r.pids); assert.equal(moved.proxyRunningBrowser.matchesCallerRoute, true);
    sealed();
    const before2 = proxyLog.length;
    const movedClient = await cdp('http://127.0.0.1:9333');
    assert.equal((await (await movedClient.page()).go('https://api-a.test/')).text, 'api-a.test injected');
    movedClient.close();
    const routed = proxyLog.slice(before2).filter(l => l.host === 'api-a.test');
    assert.ok(routed.length && routed.every(l => l.via === 'second'), 'after restart the new endpoint carries the traffic');
    await refusedStart(managed, differentRoute);
    await exec(chromeBin, ['restart'], {env: managed});
    r.pids = (await diagOf(managed)).pids;
    sealed();
    noLeak('managed chrome.log', fs.readFileSync(`${dir}/state/sbx-chromium/chrome.log`, 'utf8'));
    noLeak('Chromium argv', chromiumArgv().join(' '));
    // The launch record that cannot be read is not "not recorded": an accurate
    // error, proxy reuse refused, same browser kept. A malformed record is
    // explicitly unknown. An injected unexpected error propagates as itself.
    {
      const recordPath = `${dir}/state/sbx-chromium/session.json`, saved = fs.readFileSync(recordPath);
      const restore = () => { fs.rmSync(recordPath, {recursive: true, force: true}); fs.writeFileSync(recordPath, saved, {mode: 0o600}); };
      try {
        fs.rmSync(recordPath); fs.mkdirSync(recordPath);  // EISDIR: a real read error even for root
        for (const env of [managed, explicit]) await refusedStart(env, /cannot read the launch record .*session\.json \(EISDIR\).*left running/);
        await refusedStart(managed, /cannot read the launch record/, `${PREFIX}/bin/sbx-browser-mcp`, []);
        let d = await diagOf(managed);
        assert.deepEqual(d.pids, r.pids); assert.equal(d.proxyRunningBrowser.mode, 'unknown');
        assert.equal(d.proxyRunningBrowser.source, 'launch record unreadable (EISDIR)');
        restore();
        if (process.getuid?.() !== 0) {
          fs.chmodSync(recordPath, 0o000);
          await refusedStart(managed, /cannot read the launch record .*\(EACCES\)/);
          fs.chmodSync(recordPath, 0o600);
        }
        fs.writeFileSync(recordPath, '{not json');
        await refusedStart(explicit, /launch record is malformed/);
        d = await diagOf(managed);
        assert.deepEqual(d.pids, r.pids); assert.equal(d.proxyRunningBrowser.source, 'launch record malformed');
        restore();
        const inject = `${dir}/inject-record.cjs`;
        fs.writeFileSync(inject, `const fs = require('node:fs'); const read = fs.readFileSync;
          fs.readFileSync = function(f, ...a) { if (String(f).endsWith('sbx-chromium/session.json')) throw new TypeError('synthetic unexpected record fault'); return read.call(this, f, ...a); };`);
        await refusedStart({...managed, NODE_OPTIONS: `--require=${inject}`}, /synthetic unexpected record fault/);
        await assert.rejects(exec(chromeBin, ['start'], {env: {...managed, NODE_OPTIONS: `--require=${inject}`}}), e => !/not recorded|cannot read the launch record/.test(e.stderr));
        assert.deepEqual((await diagOf(managed)).pids, r.pids);
      } finally { restore(); }
      await exec(chromeBin, ['start'], {env: managed});
      assert.deepEqual((await diagOf(managed)).pids, r.pids, 'a restored record is reusable again');
    }
    // Another sandbox CA than the one recorded: refused.
    await refusedStart({...managed, SBX_PROXY_CA_FILE: ca3.file}, /different sandbox CA/);
    // Unrecorded launch configuration: unknown in diag, refused for proxy use.
    const sessionFile = `${dir}/state/sbx-chromium/session.json`, session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    delete session.proxy; fs.writeFileSync(sessionFile, JSON.stringify(session));
    assert.equal((await diagOf(managed)).proxyRunningBrowser.mode, 'unknown');
    await refusedStart(explicit, /was not recorded/);
    await refusedStart(managed, /was not recorded/);
    assert.deepEqual((await diagOf(managed)).pids, r.pids);
  } finally {
    // (5) stop works from a mismatched or unknown state.
    await exec(chromeBin, ['stop'], {env: managed});
  }
  assert.equal((await diagOf(managed)).running, false);
  ok('route identity: direct/unknown/unreadable/malformed/other-CA/other-endpoint/other-NO_PROXY browsers refused for proxy use (start, URL and MCP attach), identical config reused, invalid config fails closed, stop/restart recover; diag separates running browser from caller and leaks no route material');

  // 3. Control: direct mode is explicit, and the traps do catch a bypass.
  const direct = await launch({...proxied, SBX_PROXY_MODE: 'direct'}, 'direct');
  try {
    const before = proxyLog.length;
    const tab = await direct.client.page();
    assert.equal((await tab.go(`http://denied.test:${port(trapHttp)}/`)).text, 'sbx-synthetic-trap');
    assert.equal(proxyLog.length, before);
    assert.ok(trapHits.length && trapHits.every(h => h.startsWith('denied.test')));
  } finally { await direct.stop(); }
  assert.match(fs.readFileSync(direct.log, 'utf8'), /SBX_PROXY_MODE=direct: bypassing the sandbox proxy/);
  trapHits.length = 0;
  ok('SBX_PROXY_MODE=direct bypasses the proxy only when chosen (control for the trap)');

  // 4. Rotation: a new sandbox CA replaces the old one in the NSS database.
  // SBX_PROXY_CA_FILE overrides the bundle/env sources still naming ca1.
  const rotated = await launch({...proxied, SBX_PROXY_CA_FILE: ca3.file}, 'rotated');
  try {
    const tab = await rotated.client.page();
    assert.match((await tab.go('https://api-a.test/')).error, /ERR_CERT_AUTHORITY_INVALID/, 'the previous CA is still trusted');
    mitmCa = 'ca3';
    assert.equal((await tab.go('https://api-a.test/')).text, 'api-a.test injected');
  } finally { await rotated.stop(); }
  const rotatedDiag = JSON.parse((await exec(`${PREFIX}/bin/sbx-chrome`, ['diag'], {env: {...proxied, SBX_PROXY_CA_FILE: ca3.file}})).stdout).proxyCallerEnvironment;
  assert.equal(rotatedDiag.nssDbHasCurrentCa, true); assert.equal(rotatedDiag.caSha256, ca3.fingerprint);
  assert.equal(JSON.parse((await exec(`${PREFIX}/bin/sbx-chrome`, ['diag'], {env: proxied})).stdout).proxyCallerEnvironment.nssDbHasCurrentCa, false);
  assert.equal(trapHits.length, 0);
  ok('CA rotation: old CA distrusted, new CA trusted');

  // 5. Fail closed for real: no CA, no browser, no direct fallback.
  const before = proxyLog.length;
  await assert.rejects(exec(`${PREFIX}/bin/sbx-chromium`, ['--headless', '--dump-dom', 'https://api-a.test/'], {env: {...proxied, PROXY_CA_CERT_B64: '', SSL_CERT_FILE: `${dir}/none`}}), e => {
    assert.equal(e.code, 1); assert.equal(e.stdout, ''); assert.match(e.stderr, /proxy setup failed: no sandbox proxy CA found/); noLeak('refusal', e.stderr); return true;
  });
  assert.equal(proxyLog.length, before); assert.equal(trapHits.length, 0);
  ok('missing CA refuses to start instead of going direct');
  console.log('proxy-ca: ok');
} finally {
  for (const s of [...servers, innerHttp, innerHttps]) { s.closeAllConnections?.(); s.close(); }
  fs.rmSync(dir, {recursive: true, force: true});
}
