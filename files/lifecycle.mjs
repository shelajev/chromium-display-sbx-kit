import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discover } from './wayland-probe.mjs';
const prefix = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || 9222);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid CDP port');
const profile = path.resolve(process.env.CHROME_USER_DATA_DIR || `${process.env.HOME}/.config/sbx-chromium/profile`);
const state = path.resolve(process.env.XDG_STATE_HOME || `${process.env.HOME}/.local/state`, 'sbx-chromium');
const endpoint = `http://127.0.0.1:${port}`;
const delay = ms => new Promise(r => setTimeout(r, ms));
function args(pid) { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch { return []; } }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function chromium(a) { return a[0] === `${prefix}/chromium/chromium` && !a.some(x => x.startsWith('--type=')); }
function canonical(file) { try { return fs.realpathSync(file); } catch { return path.resolve(file); } }
function matchesProfile(a, pid) {
  const dir = a.find(x => x.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
  if (!dir) return false;
  try { return canonical(path.resolve(fs.readlinkSync(`/proc/${pid}/cwd`), dir)) === canonical(profile); } catch { return false; }
}
function browserPids() {
  return fs.readdirSync('/proc').filter(x => /^\d+$/.test(x)).map(Number).filter(pid => {
    const a = args(pid);
    if (!chromium(a) || !matchesProfile(a, pid) || !a.includes(`--remote-debugging-port=${port}`)) return false;
    try {
      const actual = fs.statSync(`/proc/${pid}/exe`), expected = fs.statSync(`${prefix}/chromium/chromium`);
      return actual.dev === expected.dev && actual.ino === expected.ino;
    } catch { return false; }
  });
}
// A CDP-shaped JSON response and matching argv do not prove ownership. Check
// the kernel listener inode and the browser's open FDs before using the port.
function listenerInodes() {
  const ipv4 = new Set(), ipv6 = new Set();
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let rows;
    try { rows = fs.readFileSync(table, 'utf8').trim().split('\n').slice(1); }
    catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    for (const row of rows) {
      const fields = row.trim().split(/\s+/);
      const [address, hexPort] = fields[1].split(':');
      // Include wildcard listeners too: they can serve our loopback endpoint.
      if (fields[3] === '0A' && parseInt(hexPort, 16) === port &&
          ['0100007F', '00000000', '00000000000000000000000000000000', '0000000000000000FFFF00000100007F'].includes(address)) (table.endsWith('tcp') ? ipv4 : ipv6).add(fields[9]);
    }
  }
  // The endpoint is IPv4 127.0.0.1. An independent ::1-only listener cannot
  // answer it. Prefer IPv4 listeners; only consider v4-capable IPv6 fallback
  // when no IPv4 listener exists (never accept an ::1 listener as ownership).
  return ipv4.size ? ipv4 : ipv6;
}
function ownedListener(expectedPid) {
  try {
    const pids = browserPids();
    if (pids.length !== 1 || (expectedPid && pids[0] !== expectedPid)) return null;
    const pid = pids[0], listeners = listenerInodes();
    if (!listeners.size) return null;
    const owned = new Set();
    for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
      try { const match = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(`/proc/${pid}/fd/${fd}`)); if (match) owned.add(match[1]); } catch {}
    }
    // Ambiguous/foreign listeners, including SO_REUSEPORT, fail closed.
    return [...listeners].every(inode => owned.has(inode)) ? pid : null;
  } catch { return null; }
}
function assertOwner(pid) {
  const current = ownedListener(pid);
  if (!current) throw new Error('CDP listener ownership is unverified; leaving other sessions intact');
  return current;
}
function json(resource) {
  return new Promise(resolve => {
    const req = http.get(`${endpoint}${resource}`, {timeout: 1500}, res => {
      let text = ''; res.on('data', d => { text += d; if (text.length > 1024 * 1024) req.destroy(); });
      res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(text) : null); } catch { resolve(null); } });
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(null));
  });
}
async function probe() { const pid = ownedListener(); if (!pid) return null; const v = await json('/json/version'); return ownedListener(pid) && v && /^\w*Chrome\//.test(v.Browser || '') && typeof v.webSocketDebuggerUrl === 'string' && v.webSocketDebuggerUrl.startsWith(`ws://127.0.0.1:${port}/devtools/browser/`) ? v : null; }
async function occupied() {
  return new Promise(resolve => {
    const socket = net.createConnection({host: '127.0.0.1', port});
    const finish = v => { socket.destroy(); resolve(v); };
    socket.setTimeout(1000, () => finish(true)); socket.on('connect', () => finish(true)); socket.on('error', e => finish(e.code !== 'ECONNREFUSED'));
  });
}
// Linux abstract Unix sockets are kernel-owned locks: process death releases
// them automatically, without stale files or unsafe stale-lock reclamation.
async function lock() {
  fs.mkdirSync(state, {recursive: true, mode: 0o700});
  fs.mkdirSync(profile, {recursive: true, mode: 0o700});
  const names = [`profile:${canonical(profile)}`, `port:127.0.0.1:${port}`].sort();
  const acquired = [];
  const deadline = Date.now() + (Number(process.env.SBX_CHROME_START_TIMEOUT || 30) + 25) * 1000;
  try {
    for (const key of names) {
      const name = '\0sbx-chromium-' + createHash('sha256').update(key).digest('hex');
      while (true) {
        const server = net.createServer(socket => socket.destroy());
        const success = await new Promise((resolve, reject) => {
          server.once('error', e => e.code === 'EADDRINUSE' ? resolve(false) : reject(e));
          server.listen(name, () => resolve(true));
        });
        if (success) { acquired.push(server); break; }
        if (Date.now() > deadline) throw new Error('lifecycle busy; retry after the active operation finishes');
        await delay(100);
      }
    }
    return () => { for (const server of acquired.reverse()) server.close(); };
  } catch (e) { for (const server of acquired.reverse()) server.close(); throw e; }
}
// A persistent same-host lock can name an unrelated PID reused after reboot.
// Only clear it when readable, stable proc metadata proves a non-browser.
// Treat Chromium under another path/argv spelling and inaccessible metadata
// conservatively; never signal the process named by a SingletonLock.
function liveChromiumOwner(pid) {
  if (!alive(pid)) return false;
  try {
    const proc = `/proc/${pid}`;
    const generation = () => {
      const stat = fs.readFileSync(`${proc}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]; // starttime
    };
    const before = generation();
    const executable = fs.readlinkSync(`${proc}/exe`).replace(/ \(deleted\)$/, '');
    const identity = fs.statSync(`${proc}/exe`);
    const argv = fs.readFileSync(`${proc}/cmdline`, 'utf8').split('\0').filter(Boolean);
    const after = fs.statSync(`${proc}/exe`);
    if (!before || before !== generation() || !argv.length ||
        identity.dev !== after.dev || identity.ino !== after.ino) return true;
    const browserName = value => /^(chromium(-browser)?|chrome|google-chrome(-stable|-beta|-unstable)?|headless_shell)$/.test(path.basename(value));
    const bundled = fs.statSync(`${prefix}/chromium/chromium`);
    return browserName(executable) || browserName(argv[0]) ||
      (identity.dev === bundled.dev && identity.ino === bundled.ino);
  } catch {
    // Includes EPERM/EACCES, missing exe for a live process, and exec races.
    // A process that disappeared meanwhile no longer owns a productive session.
    return alive(pid);
  }
}
function recoverProfile() {
  const file = `${profile}/SingletonLock`; let target;
  try { target = fs.readlinkSync(file); } catch (e) { if (e.code === 'ENOENT') return; throw new Error('unrecognized profile lock; leaving it intact'); }
  const match = /^(.*)-(\d+)$/.exec(target);
  if (!match) throw new Error('unrecognized profile lock; leaving it intact');
  if (match[1] === os.hostname() && liveChromiumOwner(Number(match[2]))) {
    throw new Error('profile has a live owner; leaving browser and SingletonLock intact (check profile/port)');
  }
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(`${profile}/${name}`, {force: true});
}
async function openUrl(url) {
  if (!url) return;
  const pid = assertOwner();
  const version = await probe();
  if (!version) throw new Error('CDP is unavailable');
  // JSON preserves URL escapes, query strings and fragments without routing
  // a user's URL through the /json/new query-string parser.
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error('CDP tab timeout')); }, 5000);
    ws.addEventListener('open', () => {
      try { assertOwner(pid); ws.send(JSON.stringify({id: 1, method: 'Target.createTarget', params: {url}})); }
      catch (e) { clearTimeout(timer); ws.close(); reject(e); }
    });
    ws.addEventListener('message', event => {
      clearTimeout(timer); ws.close();
      try { const result = JSON.parse(event.data); result.error ? reject(new Error('CDP could not open tab')) : resolve(); }
      catch { reject(new Error('invalid CDP response')); }
    }, {once: true});
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP tab connection failed')); }, {once: true});
  });
}
async function start(url) {
  let pids = browserPids();
  if (pids.length > 1) throw new Error('multiple managed browser processes; leaving sessions intact for inspection');
  if (pids.length) {
    if (!await probe()) throw new Error('managed browser exists but CDP is unhealthy; leaving session intact');
    await openUrl(url); return;
  }
  if (await occupied()) throw new Error(`CDP port ${port} is occupied by another session; leaving it intact`);
  fs.mkdirSync(profile, {recursive: true, mode: 0o700});
  recoverProfile();
  // Ask the same sourced detector used by the plain Chromium launcher.
  const display = spawnSync('/bin/sh', ['-c', '. "$1/libexec/display.sh"; sbx_detect_display || exit; printf "%s\\n%s\\n" "$SBX_OZONE" "${SBX_DISPLAY_SOCKET:-}"', 'display', prefix], {env: {...process.env, PREFIX: prefix}, encoding: 'utf8'});
  if (display.status !== 0) throw new Error(display.stderr.trim() || 'display selection failed');
  const [mode, displaySocket] = display.stdout.trimEnd().split('\n');
  const fd = fs.openSync(`${state}/chrome.log`, 'w', 0o600);
  const child = spawn(`${prefix}/bin/sbx-chromium`, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, url || 'about:blank'], {env: {...process.env, ...(mode === 'headless' ? {SBX_CHROME_HEADLESS: '1'} : mode === 'wayland' ? {SBX_WAYLAND_SOCKET: displaySocket} : {})}, detached: true, stdio: ['ignore', fd, fd]});
  fs.closeSync(fd); child.unref();
  let exited = false; child.on('exit', () => { exited = true; }); child.on('error', () => { exited = true; });
  const deadline = Date.now() + Number(process.env.SBX_CHROME_START_TIMEOUT || 30) * 1000;
  while (Date.now() < deadline) {
    pids = browserPids();
    if (pids.length === 1 && await probe()) {
      fs.writeFileSync(`${state}/session.json`, JSON.stringify({mode, displaySocket: displaySocket || null, port, pid: pids[0]}), {mode: 0o600});
      console.error(`sbx-chrome: Chromium (${mode}) ready at ${endpoint}`); return;
    }
    if (exited && !pids.length) throw new Error(`Chromium exited before CDP readiness; inspect local ${state}/chrome.log (may contain browsing data)`);
    await delay(250);
  }
  throw new Error('Chromium readiness timed out; session left intact for inspection');
}
async function stop() {
  const pids = browserPids();
  if (!pids.length) {
    if (await occupied()) throw new Error('CDP port belongs to another session; leaving it intact');
    return;
  }
  const pid = assertOwner();
  const version = await probe();
  if (version) {
    // SIGTERM can exit before Chromium flushes recently written cookies.
    // Browser.close follows Chromium's normal profile shutdown sequence.
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(version.webSocketDebuggerUrl);
      const timer = setTimeout(() => { ws.close(); reject(new Error('CDP close timed out; session left intact')); }, 5000);
      const finish = () => { clearTimeout(timer); ws.close(); resolve(); };
      ws.addEventListener('open', () => {
        try { assertOwner(pid); ws.send(JSON.stringify({id: 1, method: 'Browser.close'})); }
        catch (e) { clearTimeout(timer); ws.close(); reject(e); }
      });
      ws.addEventListener('message', finish, {once: true});
      ws.addEventListener('close', finish, {once: true});
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP close failed; session left intact')); }, {once: true});
    });
  } else {
    for (const pid of pids) {
      if (ownedListener(pid)) try { process.kill(pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    }
  }
  for (let i = 0; i < 80; i++) { if (!browserPids().length) { fs.rmSync(`${state}/session.json`, {force: true}); return; } await delay(250); }
  throw new Error('browser did not stop gracefully; no forced kill attempted');
}
async function diag() {
  const pids = browserPids(); const version = await probe();
  let session = {}; try { session = JSON.parse(fs.readFileSync(`${state}/session.json`)); } catch {}
  if (session.pid !== pids[0] || session.port !== port) session = {};
  let singleton = 'absent'; try { fs.lstatSync(`${profile}/SingletonLock`); singleton = 'present'; } catch {}
  const displays = await discover();
  console.log(JSON.stringify({running: !!pids.length, pids, mode: pids.length ? session.mode || 'unknown' : 'stopped', displaySocket: pids.length ? session.displaySocket : null, port, cdpHealthy: !!version && !!pids.length, targetCount: version && ownedListener() ? (await json('/json/list'))?.length ?? null : null, profile, singleton, proxy: 'direct / --no-proxy-server', displayCandidates: displays.results.map(({path, kind, globals}) => ({path, kind, globals}))}, null, 2));
}
const [command = 'start', ...rest] = process.argv.slice(2);
try {
  if (['--help', '-h'].includes(command)) console.log('sbx-chrome [start [URL] | URL | stop | restart [URL] | status | diag]');
  else {
    const release = await lock();
    try {
      if (command === 'status') {
        const v = await probe();
        if (!v) throw new Error('not running with healthy managed CDP listener');
        console.log(JSON.stringify(v));
      } else if (['diag', 'doctor'].includes(command)) await diag();
      else if (command === 'stop') await stop();
      else if (command === 'restart') { await stop(); await start(rest[0]); }
      else if (command === '--if-display') {
        const r = spawnSync('/bin/sh', ['-c', '. "$1/libexec/display.sh"; sbx_detect_display || exit; test "$SBX_OZONE" != headless', 'display', prefix], {env: {...process.env, PREFIX: prefix}, encoding: 'utf8'});
        if (r.stderr) process.stderr.write(r.stderr);
        if (r.status === 0) await start();
        else if (r.stderr) throw new Error('display selection failed');
      } else await start(command === 'start' ? rest[0] : command);
    } finally { release(); }
  }
} catch (e) { console.error(`sbx-chrome: ${e.message}`); process.exitCode = 1; }
