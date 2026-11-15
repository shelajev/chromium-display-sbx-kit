// Protocol fixtures exercise the shipped detector; lifecycle fixtures never
// touch the caller's HOME, Chromium profile, or live CDP listener.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec = promisify(execFile);
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync('/tmp/sbx-display-test-');
const prefix = path.join(dir, 'kit');
for (const d of ['bin', 'libexec', 'node/bin', 'chromium']) fs.mkdirSync(`${prefix}/${d}`, {recursive: true});
const installed = !!process.env.PREFIX;
for (const f of ['display.sh', 'wayland-probe.mjs', 'lifecycle.mjs']) fs.copyFileSync(`${installed ? process.env.PREFIX+'/libexec' : source}/${f}`, `${prefix}/libexec/${f}`);
// The proxy helper's SBX system paths point into this fixture, so the machine
// running the test (possibly an SBX guest) never supplies a CA.
const systemCa = `${dir}/system/proxy-ca.crt`, systemBundle = `${dir}/system/ca-certificates.crt`;
fs.mkdirSync(`${dir}/system`);
fs.writeFileSync(`${prefix}/libexec/proxy-trust.mjs`, fs.readFileSync(`${installed ? process.env.PREFIX+'/libexec' : source}/proxy-trust.mjs`, 'utf8')
  .replace("'/usr/local/share/ca-certificates/proxy-ca.crt'", JSON.stringify(systemCa))
  .replace("'/etc/ssl/certs/ca-certificates.crt'", JSON.stringify(systemBundle)));
for (const f of ['sbx-chrome', 'sbx-chromium', 'sbx-browser-mcp']) fs.writeFileSync(`${prefix}/bin/${f}`, fs.readFileSync(`${installed ? process.env.PREFIX+'/bin' : source}/${f}`, 'utf8').replaceAll(installed ? process.env.PREFIX : '@PREFIX@', prefix), {mode: 0o755});
fs.symlinkSync(process.execPath, `${prefix}/node/bin/node`);
// Fake browser only for safe failure paths and one-shot argument verification.
fs.writeFileSync(`${prefix}/chromium/chromium`, '#!/bin/sh\nprintf "proxy-env=[%s]\\n" "${HTTP_PROXY:+H}${http_proxy:+h}${HTTPS_PROXY:+S}${https_proxy:+s}${ALL_PROXY:+A}${all_proxy:+a}"\nprintf "no-proxy=[%s]\\nNO-PROXY=[%s]\\n" "${no_proxy-unset}" "${NO_PROXY-unset}"\nprintf "%s\\n" "$@"\nexit 1\n', {mode: 0o755});
const runtime = `${dir}/runtime`, display = `${dir}/display`;
fs.mkdirSync(runtime); fs.mkdirSync(display);
const ambient = {...process.env};
for (const k of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','PROXY_CA_CERT_B64','SBX_PROXY_CA_FILE','SBX_PROXY_MODE','SSL_CERT_FILE']) { delete ambient[k]; delete ambient[k.toLowerCase()]; }
const env = {...ambient, HOME: dir, CODEX_HOME: `${dir}/.codex`, XDG_STATE_HOME: `${dir}/state`, XDG_RUNTIME_DIR: runtime, WAYLAND_DISPLAY: 'wayland-0', DISPLAY: '', SBX_WAYLAND_SOCKET: '', SBX_CHROME_HEADLESS: '', SBX_DISPLAY_RUNTIME_DIRS: `${runtime}:${display}`, PREFIX: prefix, CHROME_USER_DATA_DIR: `${dir}/profile`, SBX_CHROME_START_TIMEOUT: '3'};
const servers = [];
const le = os.endianness() === 'LE';
const put = (b,v,n) => le ? b.writeUInt32LE(v,n) : b.writeUInt32BE(v,n);
async function wayland(file, globals) {
  const server = net.createServer(socket => {
    socket.on('error', () => {});
    if (!globals) return;
    socket.once('data', () => {
      let id = 1;
      for (const name of globals) {
        const str = Buffer.from(name+'\0'), b = Buffer.alloc(20+Math.ceil(str.length/4)*4);
        put(b,2,0);put(b,b.length<<16,4);put(b,id++,8);put(b,str.length,12);str.copy(b,16);put(b,1,b.length-4);socket.write(b);
      }
      const sync=Buffer.alloc(12);put(sync,3,0);put(sync,12<<16,4);socket.write(sync);
    });
  });
  await new Promise(r => server.listen(file,r)); servers.push(server); return server;
}
const compositor = ['wl_compositor','wl_shm','xdg_wm_base'];
async function detect(extra={}) {
  try { const r = await exec('/bin/sh',['-c','. "$PREFIX/libexec/display.sh"; sbx_detect_display || exit; printf "%s:%s" "$SBX_OZONE" "${SBX_DISPLAY_SOCKET:-}"'],{env:{...env,...extra}});return {code:0,...r}; }
  catch(e) { return {code:e.code,stdout:e.stdout,stderr:e.stderr}; }
}
async function chrome(args, extra={}) {
  try { return {code:0,...await exec(`${prefix}/bin/sbx-chrome`, args, {env:{...env,...extra}})}; }
  catch(e) { return {code:e.code,stdout:e.stdout,stderr:e.stderr}; }
}
try {
  for (const port of ['0','09222','0x2406','9222.0','9.222e3','+9222','-1',' 9222','65536','999999999999999999999','abc','9222/path']) {
    for (const bin of ['sbx-chrome','sbx-browser-mcp']) {
      await assert.rejects(exec(`${prefix}/bin/${bin}`, ['diag'], {env:{...env,CHROME_REMOTE_DEBUGGING_PORT:port}}), e =>
        e.code === 1 && e.stdout === '' && /CHROME_REMOTE_DEBUGGING_PORT/.test(e.stderr));
    }
  }
  for (const port of ['1','9222','65535','']) {
    const r = await chrome(['diag'], {CHROME_REMOTE_DEBUGGING_PORT:port});
    assert.equal(r.code,0); assert.equal(JSON.parse(r.stdout).port,Number(port || 9222));
  }
  const xenv={SBX_X11_UNIX_DIR:display,WAYLAND_DISPLAY:'',SBX_DISPLAY_RUNTIME_DIRS:dir+'/empty'};
  for (const kind of ['absent','file','socket']) {
    if (kind === 'file') fs.writeFileSync(display+'/X0','');
    if (kind === 'socket') { fs.unlinkSync(display+'/X0'); await wayland(display+'/X0',null); }
    for (const value of [':0',':0.0','unix:0','unix:0.0','unix/:0','unix/:0.0']) {
      assert.equal((await detect({...xenv,DISPLAY:value})).stdout,kind === 'socket' ? 'x11:' : 'headless:',value);
    }
  }
  assert.equal((await detect({...xenv,DISPLAY:'127.0.0.1:0'})).stdout,'x11:');
  await wayland(`${runtime}/wayland-0`, ['wl_seat','zwlr_data_control_manager_v1']);
  assert.equal((await detect()).stdout, 'headless:');
  assert.equal((await chrome(['--if-display'])).code, 0);
  await wayland(`${display}/wayland-0`,compositor);
  assert.equal((await detect()).stdout, `wayland:${display}/wayland-0`);
  fs.symlinkSync(`${display}/wayland-0`,`${runtime}/wayland-alias`);
  assert.equal((await detect()).code,0);
  await wayland(`${runtime}/wayland-hung`,null);
  assert.equal((await detect()).code,0);
  const stalePath = `${runtime}/wayland-stale`;
  const staleChild = spawn(process.execPath, ['-e', "require('node:net').createServer().listen(process.argv[1],()=>process.stdout.write('ready'))", stalePath]);
  await new Promise(r => staleChild.stdout.once('data',r));
  staleChild.kill('SIGKILL');await new Promise(r=>staleChild.once('exit',r));
  assert.equal(fs.statSync(stalePath).isSocket(),true);
  const selected = (await detect()).stdout.replace('wayland:', '');
  assert.equal(fs.statSync(selected).ino, fs.statSync(`${display}/wayland-0`).ino);
  for (const value of ['missing','wayland-0','wayland-stale','wayland-hung']) {
    const r=await detect({SBX_WAYLAND_SOCKET:value});assert.notEqual(r.code,0,value);assert.match(r.stderr,/SBX_WAYLAND_SOCKET/);
  }
  fs.unlinkSync(`${runtime}/wayland-alias`);
  await wayland(`${runtime}/wayland-1`,compositor);
  const ambiguous=await detect(); assert.notEqual(ambiguous.code,0); assert.match(ambiguous.stderr,/ambiguous/);
  assert.equal((await detect({WAYLAND_DISPLAY:'wayland-1'})).stdout,`wayland:${runtime}/wayland-1`);
  assert.equal((await detect({SBX_WAYLAND_SOCKET:`${display}/wayland-0`})).stdout,`wayland:${display}/wayland-0`);
  assert.equal((await detect({SBX_CHROME_HEADLESS:'1',SBX_WAYLAND_SOCKET:'missing'})).stdout,'headless:');
  try { await exec(`${prefix}/bin/sbx-chromium`,['--headless'],{env}); } catch(e) {assert.match(e.stdout,/--ozone-platform=headless/);assert.equal(e.stderr,'');}
  try { await exec(`${prefix}/bin/sbx-chromium`,['--version'],{env}); } catch(e) {assert.match(e.stdout,/--version/);assert.equal(e.stderr,'');}
  // Probe must receive private libraries before the wrapper exports them.
  // A sentinel bundled-node loader catches reliance on this machine's libs.
  const nodePath = `${prefix}/node/bin/node`;
  fs.unlinkSync(nodePath);
  fs.writeFileSync(nodePath, `#!/bin/sh
case \"$LD_LIBRARY_PATH\" in \"${prefix}/lib\"*) ;; *) exit 92 ;; esac
exec \"${process.execPath}\" \"$@\"
`, {mode:0o755});
  assert.equal((await detect({SBX_WAYLAND_SOCKET:`${display}/wayland-0`,LD_LIBRARY_PATH:''})).code,0);
  try { await exec(`${prefix}/bin/sbx-chromium`, ['--dump-dom','about:blank'], {env:{...env,LD_LIBRARY_PATH:'',SBX_WAYLAND_SOCKET:`${display}/wayland-0`}}); }
  catch(e) { assert.equal(e.code,1);assert.match(e.stdout,/--ozone-platform=wayland/);assert.equal(e.stderr,''); }
  fs.unlinkSync(nodePath);fs.symlinkSync(process.execPath,nodePath);
  // GPU policy: no mode forces software rendering by default; Chromium
  // negotiates. SBX_CHROME_DISABLE_GPU=1 forces it everywhere; caller flags
  // pass through untouched.
  const launch = async (args, extra) => {
    const e = await exec(`${prefix}/bin/sbx-chromium`, args, {env:{...env,...extra}}).then(() => assert.fail('fake browser exits 1'), e => e);
    assert.equal(e.code,1); assert.equal(e.stderr,''); return e.stdout.trim().split('\n');
  };
  const count = (argv, flag) => argv.filter(a => a === flag).length;
  const modes = {wayland:[[], {SBX_WAYLAND_SOCKET:`${display}/wayland-0`}], x11:[[], {...xenv,DISPLAY:':0'}], headless:[[], {SBX_CHROME_HEADLESS:'1'}], 'headless-arg':[['--headless'], {}]};
  for (const [mode, [args, extra]] of Object.entries(modes)) {
    const ozone = `--ozone-platform=${mode.replace('-arg','')}`;
    for (const value of [undefined, '', '0', 'true', '1']) {
      const argv = await launch([...args, 'about:blank'], value === undefined ? extra : {...extra, SBX_CHROME_DISABLE_GPU:value});
      const forced = value === '1' ? 1 : 0;
      assert.equal(count(argv,ozone),1,`${mode} ${value}`);
      assert.equal(count(argv,'--disable-gpu'),forced,`${mode} ${value}`);
      assert.equal(count(argv,'--disable-gpu-compositing'),forced,`${mode} ${value}`);
      assert.equal(count(argv,'--no-proxy-server'),1); assert.equal(count(argv,'--enable-features=WebMCP'),1);
      assert.equal(argv.at(-1),'about:blank');
    }
    const caller = await launch([...args, '--disable-gpu', '--enable-features=Foo', '--use-angle=swiftshader', 'about:blank'], extra);
    assert.equal(count(caller,'--disable-gpu'),1); assert.equal(count(caller,'--disable-gpu-compositing'),0);
    assert.equal(count(caller,'--use-angle=swiftshader'),1);
    assert.deepEqual(caller.filter(a => a.startsWith('--enable-features=')),['--enable-features=WebMCP,Foo']);
  }
  // sbx-chrome forwards the caller's override to the browser it launches.
  for (const [value, forced] of [['1',true],[undefined,false]]) {
    const r = await chrome(['start'], {SBX_CHROME_HEADLESS:'1', ...(value ? {SBX_CHROME_DISABLE_GPU:value} : {})});
    assert.match(r.stderr,/exited before CDP readiness/); // fake browser
    const logged = fs.readFileSync(`${env.XDG_STATE_HOME}/sbx-chromium/chrome.log`,'utf8').split('\n');
    assert.equal(logged.includes('--disable-gpu') && logged.includes('--disable-gpu-compositing'),forced);
    assert.ok(logged.includes('--ozone-platform=headless'));
  }
  fs.mkdirSync(env.CHROME_USER_DATA_DIR,{recursive:true});
  for (const owner of ['old-container-999999',`${os.hostname()}-999999`]) {
    fs.symlinkSync(owner,`${env.CHROME_USER_DATA_DIR}/SingletonLock`);
    assert.notEqual((await chrome(['start'],{SBX_CHROME_HEADLESS:'1'})).code,0);
    assert.throws(()=>fs.readlinkSync(`${env.CHROME_USER_DATA_DIR}/SingletonLock`));
  }
  // A same-host stale lock can name a PID reused by a live non-Chromium
  // process. Recover the lock, attempt launch, and leave that process alive.
  const lockPath = `${env.CHROME_USER_DATA_DIR}/SingletonLock`;
  fs.symlinkSync(`${os.hostname()}-${process.pid}`,lockPath);
  const recovered = await chrome(['start'],{SBX_CHROME_HEADLESS:'1'});
  assert.match(recovered.stderr,/exited before CDP readiness/); // fake browser
  assert.throws(()=>fs.readlinkSync(lockPath));
  process.kill(process.pid,0);
  // Simulate the proc permission boundary without changing guest privileges.
  // Missing/inaccessible metadata must not be mistaken for a non-browser.
  for (const code of ['EACCES', 'EPERM']) {
    const preload = `${dir}/deny-proc.cjs`;
    fs.writeFileSync(preload, `const fs = require('node:fs'); const readlink = fs.readlinkSync;
      fs.readlinkSync = function(file, ...args) {
        if (file === '/proc/${process.pid}/exe') throw Object.assign(new Error('denied'), {code:'${code}'});
        return readlink.call(this, file, ...args);
      };`);
    fs.symlinkSync(`${os.hostname()}-${process.pid}`,lockPath);
    const denied = await chrome(['start'], {SBX_CHROME_HEADLESS:'1', NODE_OPTIONS:`--require=${preload}`});
    assert.match(denied.stderr,/live owner/);
    assert.equal(fs.readlinkSync(lockPath),`${os.hostname()}-${process.pid}`);
    process.kill(process.pid,0);
    fs.unlinkSync(lockPath);
  }
  // Chromium-looking argv must remain protected even when exe is different.
  const owner = spawn(process.execPath,['-e',"process.stdout.write('ready');setInterval(()=>{},1000)"],{argv0:`${prefix}/chromium/chromium`});
  await new Promise(r=>owner.stdout.once('data',r));
  try {
    fs.symlinkSync(`${os.hostname()}-${owner.pid}`,lockPath);
    const refused = await chrome(['start'],{SBX_CHROME_HEADLESS:'1'});
    assert.match(refused.stderr,/live owner/);
    assert.equal(fs.readlinkSync(lockPath),`${os.hostname()}-${owner.pid}`);
    process.kill(owner.pid,0);
  } finally {
    owner.kill('SIGTERM'); await new Promise(r=>owner.once('exit',r));
  }
  const listener = net.createServer(s=>s.end());await new Promise(r=>listener.listen(0,'127.0.0.1',r));servers.push(listener);
  const conflict=await chrome(['start'],{CHROME_REMOTE_DEBUGGING_PORT:String(listener.address().port)});
  assert.match(conflict.stderr,/occupied/);assert.equal(listener.listening,true);
  const diag=JSON.parse((await chrome(['diag'])).stdout);assert.equal(diag.singleton,'present');assert.equal(diag.cdpHealthy,false);assert.ok(diag.displayCandidates.length);
  // Exercise valid MCP URL construction without starting a browser/server.
  fs.writeFileSync(prefix+'/bin/sbx-chrome','#!/bin/sh\nexit 0\n',{mode:0o755});
  const launcher=prefix+'/chrome-devtools-mcp/build/src/bin';fs.mkdirSync(launcher,{recursive:true});
  fs.writeFileSync(launcher+'/chrome-devtools-mcp.js','console.log(JSON.stringify(process.argv.slice(2)))');
  for (const port of ['1','9222','65535','']) {
    const result=await exec(prefix+'/bin/sbx-browser-mcp',[],{env:{...env,CHROME_REMOTE_DEBUGGING_PORT:port}});
    const args=JSON.parse(result.stdout);
    assert.equal(args[args.indexOf('--browserUrl')+1],'http://127.0.0.1:'+(port || '9222'));
  }
  // Proxy routing fails closed. A fake chromium proves the browser never runs;
  // the synthetic proxy host and secret must never reach any output.
  fs.writeFileSync(prefix+'/bin/sbx-chrome', fs.readFileSync(`${installed ? process.env.PREFIX+'/bin' : source}/sbx-chrome`, 'utf8').replaceAll(installed ? process.env.PREFIX : '@PREFIX@', prefix), {mode: 0o755});
  const openssl = (...a) => exec('openssl', a, {cwd: dir});
  await openssl('req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout','ca.key','-out','ca.pem','-days','2','-subj','/CN=sbx synthetic unit CA','-addext','basicConstraints=critical,CA:TRUE');
  await openssl('req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout','ca2.key','-out','ca2.pem','-days','2','-subj','/CN=sbx synthetic other CA','-addext','basicConstraints=critical,CA:TRUE');
  await openssl('req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout','leaf.key','-out','leaf.pem','-days','2','-subj','/CN=leaf.test','-addext','basicConstraints=critical,CA:FALSE');
  const caPem = fs.readFileSync(`${dir}/ca.pem`, 'utf8');
  const proxyUrl = 'http://proxy.sbx-synthetic.test:3128';
  const proxied = {HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl, NO_PROXY: 'internal.example', SBX_CHROME_HEADLESS: '1'};
  const leak = /sbx-synthetic|synthetic-secret|BEGIN CERTIFICATE/;
  const proxyLaunch = async (extra, args = ['--headless', 'about:blank']) => {
    try { return {code: 0, ...await exec(`${prefix}/bin/sbx-chromium`, args, {env: {...env, ...extra}})}; }
    catch (e) { return {code: e.code, stdout: e.stdout, stderr: e.stderr}; }
  };
  const refused = async (extra, pattern, args) => {
    const r = await proxyLaunch(extra, args);
    assert.equal(r.code, 1, pattern.source); assert.equal(r.stdout, '', pattern.source);
    assert.match(r.stderr, /proxy setup failed/); assert.match(r.stderr, pattern); assert.doesNotMatch(r.stderr, leak);
    return r;
  };
  const caFile = {SBX_PROXY_CA_FILE: `${dir}/ca.pem`};
  await refused({...proxied}, /no sandbox proxy CA found/);
  await refused({...proxied, HTTP_PROXY: 'not a url', http_proxy: ''}, /HTTP_PROXY is not a valid URL/);
  await refused({...proxied, HTTPS_PROXY: 'socks5://proxy.sbx-synthetic.test:1080', https_proxy: ''}, /HTTPS_PROXY must be an http/);
  await refused({...proxied, HTTP_PROXY: 'http://user:synthetic-secret@proxy.sbx-synthetic.test:3128', http_proxy: ''}, /carries credentials/);
  await refused({...proxied, https_proxy: 'http://other.sbx-synthetic.test:3128'}, /HTTPS_PROXY and https_proxy differ/);
  await refused({...proxied, HTTPS_PROXY: '', https_proxy: '', ...caFile}, /without HTTPS_PROXY/);
  await refused({...proxied, HTTP_PROXY: '', http_proxy: '', ...caFile}, /without HTTP_PROXY/);
  await refused({...proxied, ...caFile, NO_PROXY: 'a.example,*'}, /NO_PROXY=\*/);
  await refused({...proxied, ...caFile}, /--no-proxy-server conflicts/, ['--headless', '--no-proxy-server']);
  await refused({...proxied, ...caFile}, /--proxy-server conflicts/, ['--headless', '--proxy-server=direct://']);
  await refused({...proxied, SBX_PROXY_CA_FILE: `${dir}/missing.pem`}, /cannot read proxy CA/);
  fs.writeFileSync(`${dir}/garbage.pem`, '-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydA==\n-----END CERTIFICATE-----\n');
  await refused({...proxied, SBX_PROXY_CA_FILE: `${dir}/garbage.pem`}, /not a valid X\.509/);
  fs.writeFileSync(`${dir}/empty.pem`, '');
  await refused({...proxied, SBX_PROXY_CA_FILE: `${dir}/empty.pem`}, /exactly one PEM/);
  await refused({...proxied, SBX_PROXY_CA_FILE: `${dir}/leaf.pem`}, /not a CA certificate/);
  await refused({...proxied, PROXY_CA_CERT_B64: Buffer.from(caPem).toString('base64'), SSL_CERT_FILE: `${dir}/bundle.pem`}, /certutil is missing/);
  fs.writeFileSync(`${dir}/bundle.pem`, `public roots\n# BEGIN docker-sandboxes proxy-ca\n${fs.readFileSync(`${dir}/ca2.pem`, 'utf8')}# END docker-sandboxes proxy-ca\n`);
  await refused({...proxied, PROXY_CA_CERT_B64: Buffer.from(caPem).toString('base64'), SSL_CERT_FILE: `${dir}/bundle.pem`}, /sources disagree/);
  // A CA from SBX without proxy variables means the proxy was lost on the way.
  await refused({SBX_CHROME_HEADLESS: '1', SSL_CERT_FILE: `${dir}/bundle.pem`}, /no proxy variable reached the browser/);
  await refused({SBX_CHROME_HEADLESS: '1', PROXY_CA_CERT_B64: 'eA=='}, /no proxy variable reached the browser/);
  fs.copyFileSync(`${dir}/ca.pem`, systemCa);
  await refused({SBX_CHROME_HEADLESS: '1'}, /no proxy variable reached the browser/);
  await refused({SBX_CHROME_HEADLESS: '1', SBX_PROXY_MODE: 'proxy'}, /SBX_PROXY_MODE=proxy but none/);
  await refused({...proxied, SBX_PROXY_MODE: 'bypass'}, /SBX_PROXY_MODE must be/);
  // The system CA alone is a source; certutil is the next gate.
  await refused({...proxied}, /certutil is missing/);
  // Explicit direct mode: no proxy variables reach Chromium, --no-proxy-server does.
  for (const args of [['--headless'], ['--headless', '--no-proxy-server']]) {
    const direct = await proxyLaunch({...proxied, SBX_PROXY_MODE: 'direct'}, args);
    assert.equal(direct.code, 1); assert.match(direct.stdout, /^--no-proxy-server$/m); assert.match(direct.stdout, /^proxy-env=\[\]$/m);
    assert.match(direct.stderr, /SBX_PROXY_MODE=direct: bypassing the sandbox proxy/); assert.doesNotMatch(direct.stderr, leak);
  }
  fs.rmSync(systemCa);
  // No proxy and no sandbox CA: unchanged unproxied behaviour.
  const plain = await proxyLaunch({SBX_CHROME_HEADLESS: '1'});
  assert.match(plain.stdout, /^--no-proxy-server$/m); assert.equal(plain.stderr, '');
  // Version-only queries never need the proxy; version text anywhere else
  // (a URL, a value, a version flag beside browsing work) does not exempt.
  assert.match((await proxyLaunch({...proxied}, ['--version'])).stdout, /^--version$/m);
  assert.match((await proxyLaunch({...proxied}, ['--product-version', '--version'])).stdout, /^--product-version$/m);
  const invalid = {...proxied, HTTP_PROXY: 'invalid', HTTPS_PROXY: 'invalid', http_proxy: '', https_proxy: '', SBX_PROXY_CA_FILE: `${dir}/missing.pem`};
  for (const args of [['--headless', '--dump-dom', 'data:text/html, --version '], ['--headless', '--dump-dom', 'data:text/html, --product-version '],
      ['--headless', '--version', '--dump-dom', 'about:blank'], ['--dump-dom', 'about:blank', '--version'], ['--headless', ' --version ']]) {
    await refused(invalid, /HTTP_PROXY is not a valid URL/, args);
  }
  // The lifecycle refuses before spawning, with the same reason.
  const lifecycle = await chrome(['start'], {...proxied});
  assert.equal(lifecycle.code, 1); assert.match(lifecycle.stderr, /proxy setup failed: no sandbox proxy CA found/); assert.doesNotMatch(lifecycle.stderr, leak);
  // diag reports booleans, paths and a public fingerprint only.
  const fullDiag = JSON.parse((await chrome(['diag'], {...proxied, ...caFile})).stdout);
  assert.equal(fullDiag.running, false); assert.equal(fullDiag.proxyRunningBrowser, null, 'no browser, so nothing claimed about one');
  const proxyDiag = fullDiag.proxyCallerEnvironment;
  // No certutil in this fixture: the NSS state is unknown, not "not trusted".
  assert.deepEqual({mode: proxyDiag.mode, http: proxyDiag.http, https: proxyDiag.https, all: proxyDiag.all, noProxyLoopback: proxyDiag.noProxyLoopback, nssDbHasCurrentCa: proxyDiag.nssDbHasCurrentCa, error: proxyDiag.error},
    {mode: 'proxy', http: true, https: true, all: false, noProxyLoopback: false, nssDbHasCurrentCa: 'unknown', error: null});
  assert.match(proxyDiag.nssProbeError, /^certutil is missing at /);
  assert.match(proxyDiag.caSha256, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  const failedDiag = await chrome(['diag'], {...proxied});
  assert.equal(failedDiag.code, 0); assert.deepEqual(JSON.parse(failedDiag.stdout).proxyCallerEnvironment, {mode: 'error', error: 'no sandbox proxy CA found (SBX_PROXY_CA_FILE, ' + systemCa + ', the SBX block in the CA bundle, or PROXY_CA_CERT_B64)'});
  assert.doesNotMatch(failedDiag.stdout + (await chrome(['diag'], {...proxied, ...caFile})).stdout, leak);
  // The NO_PROXY text sbx-chromium exports must be exactly appliedNoProxy(),
  // which the route identity seals. A stand-in certutil lets the fake browser
  // be reached in proxy mode; it is removed afterwards.
  const {appliedNoProxy} = await import(`${prefix}/libexec/proxy-trust.mjs`);
  fs.writeFileSync(`${prefix}/libexec/certutil`, `#!/bin/sh
db=; nick=; mode=
while [ $# -gt 0 ]; do case "$1" in -d) db=$2; shift ;; -n) nick=$2; shift ;; -A) mode=add ;; -L) mode=list ;; -D) exit 1 ;; esac; shift; done
dir=\${db#sql:}
case "$mode" in
  add) cat > "$dir/fake-ca.pem" ;;
  list) [ -f "$dir/fake-ca.pem" ] || exit 0
        if [ -n "$nick" ]; then cat "$dir/fake-ca.pem"; else echo 'sbx-proxy-ca   C,,'; fi ;;
  *) touch "$dir/cert9.db" ;;
esac
`, {mode: 0o755});
  for (const [upper, lower] of [['', ''], ['a.test b.test', ''], ['a.test,b.test', ''], ['', 'a.test b.test'], ['x,', 'x,'], [',,localhost', ''],
      ['::1,127.0.0.1', ''], ['localhost 127.0.0.1', ''], ['LOCALHOST', ''], ['  a.test , b.test ', ''], ['127.0.0.1:9222', ''], ['a;b', '']]) {
    const extra = {...proxied, ...caFile, NO_PROXY: upper, no_proxy: lower};
    const r = await proxyLaunch(extra);
    assert.equal(r.code, 1, `${upper}|${lower}: ${r.stderr}`);
    const shown = name => r.stdout.match(new RegExp(`^${name}=\\[(.*)\\]$`, 'm'))[1];
    assert.equal(shown('no-proxy'), appliedNoProxy(extra), `no_proxy for ${JSON.stringify([upper, lower])}`);
    assert.equal(shown('NO-PROXY'), appliedNoProxy(extra), `NO_PROXY for ${JSON.stringify([upper, lower])}`);
  }
  fs.rmSync(`${prefix}/libexec/certutil`);
  // Error handling: unreadable is not absent, and unexpected errors propagate.
  // A CA bundle that exists but cannot be read may hold the only SBX marker:
  // never none/direct. EISDIR is a real read error even for root; EACCES is
  // exercised too when not running as root.
  const marked = `public roots\n# BEGIN docker-sandboxes proxy-ca\n${caPem}# END docker-sandboxes proxy-ca\n`;
  fs.mkdirSync(`${dir}/bundle-dir`);
  await refused({SBX_CHROME_HEADLESS: '1', SSL_CERT_FILE: `${dir}/bundle-dir`}, /cannot read the CA bundle .*bundle-dir \(EISDIR\)/);
  fs.mkdirSync(systemBundle);
  await refused({SBX_CHROME_HEADLESS: '1'}, /cannot read the CA bundle .*ca-certificates\.crt \(EISDIR\)/);
  fs.rmdirSync(systemBundle);
  const root = process.getuid?.() === 0;
  if (!root) {
    fs.writeFileSync(`${dir}/locked.pem`, marked); fs.chmodSync(`${dir}/locked.pem`, 0o000);
    await refused({SBX_CHROME_HEADLESS: '1', SSL_CERT_FILE: `${dir}/locked.pem`}, /cannot read the CA bundle .*locked\.pem \(EACCES\)/);
    await refused({...proxied, SBX_PROXY_CA_FILE: `${dir}/locked.pem`}, /cannot read proxy CA .*locked\.pem \(EACCES\)/);
    fs.chmodSync(`${dir}/system`, 0o000);
    await refused({SBX_CHROME_HEADLESS: '1'}, /cannot check the sandbox proxy CA file .*\(EACCES\)/);
    fs.chmodSync(`${dir}/system`, 0o755);
  }
  // An injected unexpected error (a TypeError while reading the bundle) is
  // not relabelled as absence or as a refusal: it propagates, and the
  // launcher still never starts the browser.
  const injectTypeError = (match, message) => {
    const file = `${dir}/inject-${message.replace(/\W/g, '')}.cjs`;
    fs.writeFileSync(file, `const fs = require('node:fs'); const read = fs.readFileSync;
      fs.readFileSync = function(f, ...a) { if (String(f).endsWith(${JSON.stringify(match)})) throw new TypeError(${JSON.stringify(message)}); return read.call(this, f, ...a); };`);
    return `--require=${file}`;
  };
  fs.writeFileSync(`${dir}/marked.pem`, marked);
  const injected = await proxyLaunch({SBX_CHROME_HEADLESS: '1', SSL_CERT_FILE: `${dir}/marked.pem`, NODE_OPTIONS: injectTypeError('marked.pem', 'synthetic unexpected bundle fault')});
  assert.notEqual(injected.code, 0); assert.equal(injected.stdout, '', 'the browser must not start');
  assert.match(injected.stderr, /TypeError: synthetic unexpected bundle fault/); assert.doesNotMatch(injected.stderr, /proxy setup failed/);
  // NSS probe unavailable: certutil exists but cannot be executed. That is
  // unknown with a reason, not "the database lacks the CA".
  fs.mkdirSync(`${dir}/.pki/nssdb`, {recursive: true}); fs.writeFileSync(`${dir}/.pki/nssdb/cert9.db`, '');
  fs.writeFileSync(`${prefix}/libexec/certutil`, '#!/bin/sh\nexit 0\n', {mode: 0o644});
  const probeDiag = JSON.parse((await chrome(['diag'], {...proxied, ...caFile})).stdout).proxyCallerEnvironment;
  assert.equal(probeDiag.nssDbHasCurrentCa, 'unknown'); assert.match(probeDiag.nssProbeError, /^certutil could not run \(EACCES\)$/);
  fs.rmSync(`${prefix}/libexec/certutil`); fs.rmSync(`${dir}/.pki`, {recursive: true});
  console.log('proxy error handling (unreadable CA inputs refuse, unexpected errors propagate, NSS probe unknown): ok');
  console.log('proxy fail-closed, direct opt-in and diag: ok');
  console.log('display/lifecycle: ok');
} finally {
  for(const server of servers) server.close();
  fs.rmSync(dir,{recursive:true,force:true});
}
