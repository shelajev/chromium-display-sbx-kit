// Optional real Ozone/Wayland integration. Requires weston on PATH and a
// writable /run/display owned by the test user. Never proves host visibility.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const exec=promisify(execFile), prefix=process.env.PREFIX || '/opt/sbx-chromium';
const root=fs.mkdtempSync('/tmp/real-wayland-');
const runtime=`${root}/runtime`;fs.mkdirSync(runtime,{mode:0o700});
const le=os.endianness()==='LE';const put=(b,v,n)=>le?b.writeUInt32LE(v,n):b.writeUInt32BE(v,n);
const clipboard=net.createServer(socket=>{
 socket.on('error',()=>{}); socket.once('data',()=>{
  for (const [i,name] of ['wl_seat','zwlr_data_control_manager_v1'].entries()) {
   const str=Buffer.from(name+'\0'), b=Buffer.alloc(20+Math.ceil(str.length/4)*4);
   put(b,2,0);put(b,b.length<<16,4);put(b,i+1,8);put(b,str.length,12);str.copy(b,16);put(b,1,b.length-4);socket.write(b);
  }
  const b=Buffer.alloc(12);put(b,3,0);put(b,12<<16,4);socket.write(b);
 });
});
await new Promise(r=>clipboard.listen(`${runtime}/wayland-0`,r));
let weston;
const env={...process.env, HOME:root, CODEX_HOME:`${root}/codex`, XDG_STATE_HOME:`${root}/state`, XDG_RUNTIME_DIR:runtime, WAYLAND_DISPLAY:'wayland-0', DISPLAY:'', SBX_CHROME_HEADLESS:'', SBX_WAYLAND_SOCKET:'', SBX_DISPLAY_RUNTIME_DIRS:`${runtime}:/run/display`};
const chrome=(args)=>exec(`${prefix}/bin/sbx-chrome`,args,{env});
try {
 for(const socket of [`${runtime}/wayland-1`,'/run/display/wayland-0']) {
  fs.chmodSync('/run/display',0o755);
  weston=spawn('weston',['--backend=headless-backend.so','--use-pixman',`--socket=${socket}`,'--idle-time=0'],{env,stdio:['ignore','ignore','inherit']});
  for(let i=0;i<100 && !fs.existsSync(socket);i++) await new Promise(r=>setTimeout(r,100));
  assert.ok(fs.existsSync(socket),'weston socket not ready');
  if(socket.startsWith('/run/display')) fs.chmodSync('/run/display',0o555);
  await chrome(['start']);
  const d=JSON.parse((await chrome(['diag'])).stdout);
  assert.equal(d.mode,'wayland');assert.equal(d.displaySocket,socket);assert.equal(d.pids.length,1);assert.equal(d.cdpHealthy,true);
  assert.equal(d.displayCandidates.find(c=>c.path===`${runtime}/wayland-0`).kind,'clipboard-only');
  await exec(process.execPath,[path.join(path.dirname(fileURLToPath(import.meta.url)),'mcp-test.mjs'),`${prefix}/bin/sbx-browser-mcp`],{env,maxBuffer:1024*1024});
  await chrome(['stop']);
  // GPU policy on a real compositor with no render device: default
  // negotiation and the explicit software override both render.
  const gpu=path.join(path.dirname(fileURLToPath(import.meta.url)),'gpu-fallback-test.mjs');
  for (const [policy,extra] of [['default',{}],['software',{SBX_CHROME_DISABLE_GPU:'1'}]])
   console.log((await exec(process.execPath,[gpu,`${prefix}/bin/sbx-chrome`,policy,'wayland'],{env:{...env,...extra}})).stdout.trim());
  weston.kill('SIGTERM');await new Promise(r=>weston.once('exit',r));weston=null;
  console.log(`real Ozone Wayland + CDP/MCP/WebMCP/restart: ok (${socket.startsWith('/run/display')?'read-only forwarded directory':'wayland-1'})`);
 }
} finally {
 try { await chrome(['stop']); } catch {}
 if(weston) weston.kill('SIGTERM');
 clipboard.close();fs.chmodSync('/run/display',0o755);fs.rmSync(root,{recursive:true,force:true});
}
