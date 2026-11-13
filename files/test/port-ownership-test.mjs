// Real Chromium regression: two profiles sharing a port must never attach to,
// add tabs to, report healthy, or close one another's browser.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile), prefix=process.env.PREFIX;
const root=fs.mkdtempSync('/tmp/sbx-port-test-');
const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const envFor=name=>({...process.env,HOME:root,CODEX_HOME:`${root}/codex`,XDG_STATE_HOME:`${root}/state-${name}`,CHROME_USER_DATA_DIR:`${root}/profile-${name}`,CHROME_REMOTE_DEBUGGING_PORT:String(port),SBX_CHROME_HEADLESS:'1'});
const a=envFor('a'),b=envFor('b'),chrome=`${prefix}/bin/sbx-chrome`;
async function run(env,args) {try{return {code:0,...await exec(chrome,args,{env})};}catch(e){return {code:e.code,stderr:e.stderr,stdout:e.stdout};}}
async function ok(env,args){const r=await run(env,args);assert.equal(r.code,0,r.stderr);return r;}
const hasLock=env=>{try{fs.lstatSync(`${env.CHROME_USER_DATA_DIR}/SingletonLock`);return true;}catch{return false;}};
const targets=()=>new Promise((resolve,reject)=>http.get(`http://127.0.0.1:${port}/json/list`,res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve(JSON.parse(body)));}).on('error',reject));
let raw;
try {
  const raced=await Promise.all([run(a,['start']),run(b,['start'])]);
  assert.equal(raced.filter(r=>r.code===0).length,1,JSON.stringify(raced));
  const winner=raced[0].code===0?a:b,loser=winner===a?b:a;
  assert.match(raced.find(r=>r.code!==0).stderr,/occupied/);
  assert.equal(fs.existsSync(`${loser.XDG_STATE_HOME}/sbx-chromium/session.json`),false);
  const before=(await targets()).map(t=>t.id).sort();
  for (const args of [['start','data:text/html,foreign-tab'],['status'],['stop'],['restart','data:text/html,foreign-tab']]) {
    assert.notEqual((await run(loser,args)).code,0,`foreign ${args[0]} should refuse`);
    await ok(winner,['status']);
    assert.deepEqual((await targets()).map(t=>t.id).sort(),before);
  }
  let mcpRefused=false;
  try { await exec(`${prefix}/bin/sbx-browser-mcp`,[],{env:loser,timeout:5000}); }
  catch(e) {mcpRefused=e.code===1 && /occupied/.test(e.stderr);assert.equal(e.stdout,'');}
  assert.equal(mcpRefused,true,'foreign MCP launcher must refuse before attachment');
  const d=JSON.parse((await ok(loser,['diag'])).stdout);assert.equal(d.cdpHealthy,false);assert.equal(d.targetCount,null);
  // Canonical aliases must match the intended running browser/profile.
  fs.symlinkSync(winner.CHROME_USER_DATA_DIR,`${root}/alias`);
  await ok({...winner,CHROME_USER_DATA_DIR:`${root}/alias`},['status']);
  // A real second browser can stay alive after DevTools bind fails. Matching
  // its argv must not let it borrow the first browser's CDP endpoint.
  const fd=fs.openSync(`${root}/raw.log`,'w');
  raw=spawn(`${prefix}/bin/sbx-chromium`,[`--user-data-dir=${loser.CHROME_USER_DATA_DIR}`,`--remote-debugging-port=${port}`,'about:blank'],{env:loser,stdio:['ignore',fd,fd]});fs.closeSync(fd);
  let rawExit=false;raw.on('exit',()=>rawExit=true);
  for(let i=0;i<100;i++) {
    if(hasLock(loser))break;
    await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(rawExit,false);assert.ok(hasLock(loser));
  assert.notEqual((await run(loser,['status'])).code,0);
  for(const command of ['stop','restart']) {
    const r=await run(loser,[command]);assert.notEqual(r.code,0);assert.match(r.stderr,/ownership/);
    await ok(winner,['status']);process.kill(raw.pid,0);
  }
  const exited=new Promise(r=>raw.once('exit',r));raw.kill('SIGTERM');await exited;raw=null;
  await ok(winner,['restart']);await ok(winner,['status']);await ok(winner,['stop']);
  // A CDP-shaped foreign HTTP listener must not count as Chromium ownership.
  const foreign=http.createServer((req,res)=>res.end(JSON.stringify({Browser:'Chrome/156',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/browser/foreign`})));
  await new Promise(r=>foreign.listen(port,'127.0.0.1',r));
  try {assert.notEqual((await run(a,['status'])).code,0);assert.notEqual((await run(a,['stop'])).code,0);assert.equal(foreign.listening,true);}finally{await new Promise(r=>foreign.close(r));}
  console.log('cross-profile port race, listener ownership, alias, foreign stop/restart: ok');
} finally {
  if(raw){const exited=new Promise(r=>raw.once('exit',r));raw.kill('SIGTERM');await exited;}
  await run(a,['stop']);await run(b,['stop']);
  fs.rmSync(root,{recursive:true,force:true});
}
