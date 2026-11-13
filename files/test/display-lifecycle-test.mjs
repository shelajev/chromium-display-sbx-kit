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
for (const f of ['sbx-chrome', 'sbx-chromium']) fs.writeFileSync(`${prefix}/bin/${f}`, fs.readFileSync(`${installed ? process.env.PREFIX+'/bin' : source}/${f}`, 'utf8').replaceAll(installed ? process.env.PREFIX : '@PREFIX@', prefix), {mode: 0o755});
fs.symlinkSync(process.execPath, `${prefix}/node/bin/node`);
// Fake browser only for safe failure paths and one-shot argument verification.
fs.writeFileSync(`${prefix}/chromium/chromium`, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 1\n', {mode: 0o755});
const runtime = `${dir}/runtime`, display = `${dir}/display`;
fs.mkdirSync(runtime); fs.mkdirSync(display);
const env = {...process.env, HOME: dir, CODEX_HOME: `${dir}/.codex`, XDG_STATE_HOME: `${dir}/state`, XDG_RUNTIME_DIR: runtime, WAYLAND_DISPLAY: 'wayland-0', DISPLAY: '', SBX_WAYLAND_SOCKET: '', SBX_CHROME_HEADLESS: '', SBX_DISPLAY_RUNTIME_DIRS: `${runtime}:${display}`, PREFIX: prefix, CHROME_USER_DATA_DIR: `${dir}/profile`, SBX_CHROME_START_TIMEOUT: '3'};
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
  fs.mkdirSync(env.CHROME_USER_DATA_DIR,{recursive:true});
  for (const owner of ['old-container-999999',`${os.hostname()}-999999`]) {
    fs.symlinkSync(owner,`${env.CHROME_USER_DATA_DIR}/SingletonLock`);
    assert.notEqual((await chrome(['start'],{SBX_CHROME_HEADLESS:'1'})).code,0);
    assert.throws(()=>fs.readlinkSync(`${env.CHROME_USER_DATA_DIR}/SingletonLock`));
  }
  // Live owner is intentionally a different process: fail closed even if
  // metadata is unavailable or an unexpected invocation owns the profile.
  fs.symlinkSync(`${os.hostname()}-${process.pid}`,`${env.CHROME_USER_DATA_DIR}/SingletonLock`);
  const r=await chrome(['start'],{SBX_CHROME_HEADLESS:'1'});assert.match(r.stderr,/live owner/);
  assert.equal(fs.readlinkSync(`${env.CHROME_USER_DATA_DIR}/SingletonLock`),`${os.hostname()}-${process.pid}`);
  const listener = net.createServer(s=>s.end());await new Promise(r=>listener.listen(0,'127.0.0.1',r));servers.push(listener);
  const conflict=await chrome(['start'],{CHROME_REMOTE_DEBUGGING_PORT:String(listener.address().port)});
  assert.match(conflict.stderr,/occupied/);assert.equal(listener.listening,true);
  const diag=JSON.parse((await chrome(['diag'])).stdout);assert.equal(diag.singleton,'present');assert.equal(diag.cdpHealthy,false);assert.ok(diag.displayCandidates.length);
  console.log('display/lifecycle: ok');
} finally {
  for(const server of servers) server.close();
  fs.rmSync(dir,{recursive:true,force:true});
}
