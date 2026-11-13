// Local HTTP fixtures exercise the real parser, HTTP checks, age/architecture
// gates and file edits. No public services, Git mutations or GitHub mocks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {maintain,markdown,semver} from './maintain-pins.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maintenance-test-'));
const files=['chromium-display.yaml','chromium-display.dockerfile','tools/install-kit-tck.sh'];
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const oldDate='2026-10-01T00:00:00Z',mature='2026-11-01T00:00:00Z',young='2026-11-12T00:00:00Z';
const oldChrome='156.0.8078.79-1~deb13u1',nextChrome='156.0.8078.90-1~deb13u2';
const routes=new Map();let scenario={};let base;
function blob(obj) {
  const body=Buffer.from(JSON.stringify(obj)),digest=hash(body);
  return {body,digest};
}
function image(label,date,archs=['amd64','arm64']) {
  const platforms=archs.map(arch=>{
    const c=blob({created:scenario.armYoung && label==='new' && arch==='arm64'?young:date,architecture:arch,os:'linux',label});
    routes.set('/v2/IMAGE/blobs/'+c.digest,{body:c.body});
    const m=blob({schemaVersion:2,config:{digest:c.digest}});
    routes.set('/v2/IMAGE/manifests/'+m.digest,{body:m.body});
    return {platform:{os:'linux',architecture:arch},digest:m.digest};
  });
  const index=blob({schemaVersion:2,manifests:platforms});
  routes.set('/v2/IMAGE/manifests/'+index.digest,{body:index.body});
  return index;
}
const server=http.createServer((req,res)=>{
  const url=decodeURI(req.url);
  if(url.includes('/Packages.xz')) {
    const arch=url.includes('binary-amd64')?'amd64':'arm64';
    const versions=[...(scenario.vanished?[]:[oldChrome]),nextChrome,'157.0.1.1-1~deb13u1'];
    const text=versions.filter(v=>!(scenario.single && v===nextChrome && arch==='arm64') && !(v.startsWith('157') && arch==='arm64')).map(v=>
      'Package: chromium\nVersion: '+v+'\nArchitecture: '+arch+'\nFilename: pool/main/c/chromium/chromium_'+v+'_'+arch+'.deb\n').join('\n');
    res.end(execFileSync('xz',['-c'],{input:text}));return;
  }
  if(url.endsWith('.deb')) {
    const current=url.includes(oldChrome);
    if(current && scenario.missingDeb) {res.writeHead(404).end();return;}
    res.setHeader('Last-Modified',new Date(current?oldDate:scenario.young || scenario.armYoung && url.includes('arm64')?young:mature).toUTCString());
    res.end();return;
  }
  if(url==='/chrome-devtools-mcp') {
    const pkg=v=>({engines:{node:'^20.19.0 || ^22.12.0 || >=23'},bin:{'chrome-devtools-mcp':scenario.incompatible && v==='1.13.0'?'new/launcher.js':'build/src/bin/chrome-devtools-mcp.js'},dist:{tarball:base+'/tar/'+v}});
    res.end(JSON.stringify({versions:{'1.12.0':pkg('1.12.0'),'1.13.0':pkg('1.13.0')},time:{'1.12.0':oldDate,'1.13.0':scenario.young?young:mature}}));return;
  }
  if(url.startsWith('/tar/')) {res.end();return;}
  if(url.endsWith('/@v/list')) {res.end('v3.0.0-m.12\nv3.0.0-m.13\n');return;}
  if(url.endsWith('.info')) {res.end(JSON.stringify({Time:url.includes('m.12')?oldDate:scenario.young?young:mature}));return;}
  if(url.endsWith('.mod')) {res.end('module github.com/docker/sandbox-kit-spec/v3\ngo 1.26.0\n');return;}
  const key=url.replace(/\/v2\/(?:library\/debian|debian-base|node)\//,'/v2/IMAGE/');
  const r=routes.get(key);
  if(r) {res.end(r.body);return;}
  res.writeHead(404).end('missing fixture '+url);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
base='http://127.0.0.1:'+server.address().port;
const options={now:'2026-11-13T00:00:00Z',debianBase:base,npmBase:base,goBase:base,dockerBase:base,dhiBase:base};
function setup(config={}) {
  scenario=config;routes.clear();
  const old=image('old',oldDate);
  const next=image('new',config.young?young:mature,config.ociSingle?['amd64']:undefined);
  for(const tag of ['trixie','trixie-dev','24-debian13-dev']) routes.set('/v2/IMAGE/manifests/'+tag,{body:next.body});
  const root=fs.mkdtempSync(path.join(dir,'case-'));
  for(const f of files) {
    fs.mkdirSync(path.dirname(root+'/'+f),{recursive:true});
    let text=fs.readFileSync(repo+'/'+f,'utf8');
    if(f.endsWith('dockerfile')) text=text.replace(/@sha256:[a-f0-9]{64}/g,'@'+old.digest);
    fs.writeFileSync(root+'/'+f,text);
  }
  if(config.ociMissing) routes.delete('/v2/IMAGE/manifests/'+old.digest);
  return root;
}
const bytes=root=>files.map(f=>fs.readFileSync(root+'/'+f,'utf8'));
async function run(config={},extra={}) {
  const root=setup(config),before=bytes(root);
  const report=await maintain({...options,root,...extra});
  return {root,before,report};
}
try {
  assert.equal(semver('v3.0.0-m.12','v3.0.0-m.9'),1);
  assert.equal(semver('v3.0.0','v3.0.0-m.13'),1);
  let r=await run();
  assert.equal(r.report.outcome,'update',markdown(r.report));
  assert.deepEqual(bytes(r.root),r.before,'dry run leaves every pin file unchanged');
  assert.equal(r.report.changes.length,6);
  r=await run({}, {apply:true});
  assert.equal(r.report.outcome,'update',markdown(r.report));
  assert.match(bytes(r.root)[0],/default: "156.0.8078.90"/);
  assert.match(bytes(r.root)[0],/default: "1~deb13u2"/);
  assert.match(bytes(r.root)[0],/default: "1.13.0"/);
  assert.match(bytes(r.root)[2],/version=v3.0.0-m.13/);
  const basePins=bytes(r.root)[1].match(/dhi.io\/debian-base:trixie-dev@sha256:[a-f0-9]{64}/g);
  assert.equal(basePins.length,2);assert.equal(basePins[0],basePins[1]);
  assert.match(bytes(r.root)[1],/NPM_CONFIG_MIN_RELEASE_AGE=7/);

  r=await run({}, {now:'2026-11-08T00:00:00Z'});
  assert.equal(r.report.outcome,'update','exactly seven days is eligible');
  r=await run({}, {now:'2026-11-07T23:59:59Z'});
  assert.equal(r.report.outcome,'no-change','one second short of seven days is held');
  r=await run({young:true});
  assert.equal(r.report.outcome,'no-change',markdown(r.report));
  assert.match(markdown(r.report),/matures 2026-11-19/);
  r=await run({armYoung:true});
  assert.equal(r.report.outcome,'update',markdown(r.report));
  assert.ok(r.report.changes.every(c=>['devtoolsMcp','kit-tck'].includes(c.component)),'young arm64 blocks all shared artifact bumps');
  r=await run({single:true});
  assert.equal(r.report.outcome,'update');
  assert.ok(!r.report.changes.some(c=>c.component==='chromium'),'single arch candidate skipped');
  r=await run({vanished:true});
  assert.equal(r.report.outcome,'update',markdown(r.report));
  assert.match(markdown(r.report),/MIRROR DISAPPEARANCE/);
  r=await run({missingDeb:true});
  assert.equal(r.report.outcome,'update');assert.match(markdown(r.report),/MIRROR DISAPPEARANCE/);
  for(const config of [{vanished:true,young:true},{vanished:true,single:true},{ociSingle:true},{ociMissing:true,young:true}]) {
    r=await run(config,{apply:true});
    assert.equal(r.report.outcome,'failure',markdown(r.report));
    assert.deepEqual(bytes(r.root),r.before,'fail closed without partial edits');
  }
  r=await run({vanished:true,young:true},{urgentSecurityAllow:'chromium='+nextChrome,securityJustification:'DSA fixture: urgent fix',eventName:'workflow_dispatch'});
  assert.equal(r.report.outcome,'update',markdown(r.report));
  assert.ok(r.report.exceptions.length);assert.match(markdown(r.report),/URGENT SECURITY/);
  for(const extra of [
    {urgentSecurityAllow:'chromium='+nextChrome,eventName:'schedule',securityJustification:'DSA'},
    {urgentSecurityAllow:'chromium='+nextChrome},
    {urgentSecurityAllow:'devtoolsMcp=1.13.0',securityJustification:'DSA'},
    {urgentSecurityAllow:'chromium=wrong',securityJustification:'DSA'},
  ]) {
    r=await run({young:true},extra);assert.equal(r.report.outcome,'failure',markdown(r.report));
  }
  r=await run({incompatible:true});
  assert.equal(r.report.outcome,'update');
  assert.ok(!r.report.changes.some(c=>c.component==='devtoolsMcp'));
  assert.match(markdown(r.report),/incompatible/);

  // A transport failure produces a useful failure report and no partial writes.
  const root=setup(),before=bytes(root);
  const fail=await maintain({...options,root,npmBase:base+'/broken',apply:true});
  assert.equal(fail.outcome,'failure');assert.match(fail.error,/HTTP 404/);assert.deepEqual(bytes(root),before);
  // Workflow guards use real files and reject each prohibited convention.
  for(const body of [
    'on:\n  pull_request:\njobs:\n',
    'on: [pull_request_target]\njobs:\n',
    'on: push\njobs:\n  x:\n    steps:\n      - uses: actions/checkout@v4\n',
    'on: push\njobs:\n  x:\n    steps:\n      - run: node tools/test.mjs\n',
    'on: push\njobs:\n  x:\n    steps:\n      - run: gh pr merge --auto\n',
  ]) {
    const workflows=fs.mkdtempSync(path.join(dir,'workflow-'));fs.writeFileSync(workflows+'/bad.yml',body);
    assert.notEqual(spawnSync('python3',[repo+'/tools/check-workflows.py',workflows]).status,0,body);
  }
  // Run the actual installer from a different caller directory; a Go shim
  // verifies -o stays absolute after -C and creates the requested executable.
  const shim=dir+'/shim';fs.mkdirSync(shim);
  fs.writeFileSync(shim+'/go',`#!/bin/sh
case "$*" in
  'env GOMODCACHE') echo "${dir}/cache" ;;
  'mod download '*) ;;
  -C*) shift 2; test "$1" = build; shift 2; test "$1" = -o; shift
       case "$1" in /*) ;; *) exit 91 ;; esac
       printf '%s' fixture > "$1" ;;
  *) exit 92 ;;
esac
`,{mode:0o755});
  for(const out of ['kit-tck','./rel-bin/kit-tck','../parent-tck','existing-dir']) {
    const cwd=dir+'/caller';fs.mkdirSync(cwd,{recursive:true});fs.mkdirSync(cwd+'/existing-dir',{recursive:true});
    execFileSync('sh',[repo+'/tools/install-kit-tck.sh',out],{cwd,env:{...process.env,PATH:shim+':'+process.env.PATH}});
    const expected=out==='existing-dir'?cwd+'/existing-dir/kit-tck':path.resolve(cwd,out);
    assert.equal(fs.readFileSync(expected,'utf8'),'fixture');
  }
  console.log('maintenance: dry-run/no-change/update/failure, policy, workflow guards and relative installer fixtures passed');
} finally {
  await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});
}
