// Official-source maintenance. No Git/GitHub mutations here; --apply writes only
// the three pin files after every source and policy check succeeds.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync, execFile, spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const exec = promisify(execFile);
const week = 7 * 86400000;
const arches = ['amd64','arm64'];
const sha = b => 'sha256:'+createHash('sha256').update(b).digest('hex');
export function semver(a,b) {
  const parse = v => v.replace(/^v/,'').split(/[.+-]/);
  const x=parse(a), y=parse(b);
  for(let i=0;i<3;i++) if(+x[i] !== +y[i]) return +x[i] > +y[i] ? 1 : -1;
  if(x.length===3 || y.length===3) return (x.length===3)-(y.length===3);
  for(let i=3;i<Math.max(x.length,y.length);i++) {
    if(x[i]===y[i]) continue;
    if(x[i]===undefined || y[i]===undefined) return x[i]===undefined ? -1:1;
    const numeric = /^\d+$/;
    if(numeric.test(x[i]) && numeric.test(y[i])) return +x[i] > +y[i] ? 1:-1;
    if(numeric.test(x[i]) !== numeric.test(y[i])) return numeric.test(x[i]) ? -1:1;
    return x[i]>y[i]?1:-1;
  }
  return 0;
}
function debianCompare(a,b) {
  for(const [op,result] of [['gt',1],['lt',-1]]) {
    const compared=spawnSync('dpkg',['--compare-versions',a,op,b]);
    if(compared.error || ![0,1].includes(compared.status)) throw new Error('dpkg version comparison failed');
    if(compared.status===0) return result;
  }
  return 0;
}
async function request(url,{method='GET',headers={},missing=false}={}) {
  // curl honors normal HTTPS proxy/CA settings in SBX and on hosted runners.
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pin-http-'));
  try {
    const args=['--disable','--silent','--show-error','--location','--max-time','90','--retry','2','--dump-header',dir+'/headers','--output',dir+'/body','--write-out','%{http_code}'];
    if(method==='HEAD') args.push('--head');
    for(const [k,v] of Object.entries(headers)) args.push('--header',k+': '+v);
    args.push(url);
    let stdout;
    try {({stdout}=await exec('curl',args,{maxBuffer:1024*1024}));}
    catch {throw new Error(new URL(url).origin+new URL(url).pathname+': transport request failed (raw diagnostics suppressed)');}
    const status=Number(stdout);
    const raw=fs.readFileSync(dir+'/headers','utf8').trim().split(/\r?\n\r?\n/).at(-1);
    const h=Object.fromEntries(raw.split(/\r?\n/).slice(1).map(l=>{const i=l.indexOf(':');return [l.slice(0,i).toLowerCase(),l.slice(i+1).trim()];}));
    if(status===404 && missing) return null;
    if(status!==200) throw new Error(new URL(url).origin+new URL(url).pathname+': HTTP '+status+' (response body suppressed)');
    return {body:fs.readFileSync(dir+'/body'),headers:h};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
const json = async (u,o) => {const r=await request(u,o);return r && JSON.parse(r.body);};
export async function maintain(options={}) {
  const root=options.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const now=Date.parse(options.now || new Date().toISOString());
  const report={outcome:'failure',now:new Date(now).toISOString(),changes:[],notes:[],exceptions:[],sources:[]};
  const texts=new Map(['chromium-display.yaml','chromium-display.dockerfile','tools/install-kit-tck.sh'].map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
  const original=new Map(texts);
  const allow=new Set((options.urgentSecurityAllow || '').split(',').map(s=>s.trim()).filter(Boolean));
  const used=new Set();
  const eligible=(component,pin,date,exception=true) => {
    const stamp=Date.parse(date);
    if(!Number.isFinite(stamp) || stamp>now) throw new Error(component+' '+pin+': missing/invalid/future release timestamp '+date);
    if(now-stamp >= week) return true;
    const maturity=new Date(stamp+week).toISOString();
    const key=component+'='+pin;
    if(allow.has(key)) {
      if(!exception) throw new Error(key+': npm build-time seven-day guard forbids this exception');
      used.add(key);report.exceptions.push({target:key,justification:options.securityJustification,date,maturity});return true;
    }
    report.notes.push(component+' '+pin+': cooldown; age '+((now-stamp)/86400000).toFixed(2)+' days; matures '+maturity);
    return false;
  };
  const change=(component,from,to) => {if(from!==to) report.changes.push({component,from,to});};
  const replace=(file,from,to) => {if(!texts.get(file).includes(from)) throw new Error('pin not found: '+from);texts.set(file,texts.get(file).replaceAll(from,to));};
  try {
    if(!['schedule','workflow_dispatch'].includes(options.eventName || 'workflow_dispatch')) throw new Error('invalid event name');
    if(allow.size && ((options.eventName || 'workflow_dispatch')!=='workflow_dispatch' || !options.securityJustification?.trim()))
      throw new Error('Urgent exceptions require workflow_dispatch, exact component=pin and a security justification');
    for(const entry of allow) if(!/^(chromium|devtoolsMcp|kit-tck|debian|debian-base|node)=\S+$/.test(entry)) throw new Error('invalid exact security target: '+entry);
    const yaml=texts.get('chromium-display.yaml');
    const readArg=name=>yaml.match(new RegExp('  '+name+':\\n    default: "([^"]+)"'))?.[1];
    const current=readArg('chromium')+'-'+readArg('chromiumDebianRevision');
    const deb=options.debianBase || 'https://deb.debian.org';
    const records=new Map(arches.map(a=>[a,new Map()]));
    for(const [repo,suite] of [['debian-security','trixie-security'],['debian','trixie-updates'],['debian','trixie']]) {
      for(const arch of arches) {
        const url=deb+'/'+repo+'/dists/'+suite+'/main/binary-'+arch+'/Packages.xz';
        report.sources.push(url);
        const r=await request(url);
        const data=execFileSync('xz',['-dc'],{input:r.body,maxBuffer:100*1024*1024}).toString();
        for(const stanza of data.split(/\n\n/)) {
          if(!/^Package: chromium$/m.test(stanza)) continue;
          const fields=Object.fromEntries(stanza.split('\n').filter(l=>/^[A-Za-z-]+: /.test(l)).map(l=>[l.slice(0,l.indexOf(':')),l.slice(l.indexOf(':')+2)]));
          if(fields.Architecture!==arch || !/^\d+(?:\.\d+){3}-[0-9A-Za-z.+~]+$/.test(fields.Version) || +fields.Version.split('.')[0]<150) continue;
          if(!/^pool\/(?:updates\/)?main\/c\/chromium\/[^/]+\.deb$/.test(fields.Filename)) throw new Error('invalid Debian Filename');
          if(!records.get(arch).has(fields.Version)) records.get(arch).set(fields.Version,deb+'/'+repo+'/'+fields.Filename);
        }
      }
    }
    for(const arch of arches) {
      for(const v of records.get(arch).keys()) if(debianCompare(v,current)>0 && !records.get(arches.find(a=>a!==arch)).has(v))
        report.notes.push('Chromium '+v+': unavailable on '+arches.find(a=>a!==arch)+'; common pin required');
    }
    const common=[...records.get('amd64').keys()].filter(v=>records.get('arm64').has(v)).sort((a,b)=>debianCompare(b,a));
    let present=arches.every(a=>records.get(a).has(current));
    for(const arch of arches) {
      const url=records.get(arch).get(current);
      if(url && !await request(url,{method:'HEAD',missing:true})) present=false;
    }
    if(!present) report.notes.push('MIRROR DISAPPEARANCE: current Chromium '+current+' no longer installable from configured apt indices on both architectures');
    let selected=null;
    for(const v of common.filter(v=>debianCompare(v,current)>=0)) {
      const dates=[];
      for(const arch of arches) {
        const r=await request(records.get(arch).get(v),{method:'HEAD',missing:true});
        if(!r) break;
        dates.push(r.headers['last-modified']);
      }
      if(dates.length!==2) {report.notes.push('Chromium '+v+': artifact missing on at least one architecture');continue;}
      // Existing shipped pins need no renewed age exception; new pins check both dates.
      const mature=v===current || dates.map(d=>eligible('chromium',v,d)).every(Boolean);
      if(mature) {selected=v;break;}
    }
    if(!selected) throw new Error('No eligible common Chromium replacement for '+current+(present?'':' (mirror disappearance)')+'. See cooldown maturity times; retry after seven days or manually dispatch urgent_security_allow=chromium=<exact-version-revision> with justification.');
    change('chromium',current,selected);
    const split=selected.lastIndexOf('-');
    replace('chromium-display.yaml','default: "'+readArg('chromium')+'"','default: "'+selected.slice(0,split)+'"');
    replace('chromium-display.yaml','default: "'+readArg('chromiumDebianRevision')+'"','default: "'+selected.slice(split+1)+'"');

    const npm=options.npmBase || 'https://registry.npmjs.org';
    const npmUrl=npm+'/chrome-devtools-mcp';report.sources.push(npmUrl);
    const meta=await json(npmUrl);const mcp=readArg('devtoolsMcp');
    if(!meta.versions?.[mcp]) throw new Error('current MCP pin disappeared: '+mcp);
    // Validate only the launcher/Node range actually supported by this build.
    const compatible=m=>!m.deprecated && Object.keys(m.dependencies || {}).length===0 &&
      (typeof m.bin==='object' && Object.values(m.bin).includes('build/src/bin/chrome-devtools-mcp.js')) &&
      ['>=20.19.0','>=20.19','>=22.12.0','>=22','>=20','>=18','>=24','^20.19.0 || ^22.12.0 || >=23'].includes(m.engines?.node);
    const candidates=Object.keys(meta.versions).filter(v=>/^\d+\.\d+\.\d+$/.test(v) && semver(v,mcp)>=0).sort((a,b)=>semver(b,a));
    let mcpNext=null;
    for(const v of candidates) {
      if(v!==mcp && !eligible('devtoolsMcp',v,meta.time?.[v],false)) continue;
      const m=meta.versions[v];
      if(!compatible(m)) {report.notes.push('MCP '+v+': incompatible dependencies, bin path, deprecation or Node engine '+m.engines?.node);continue;}
      const r=await request(m.dist.tarball,{method:'HEAD',missing:true});
      if(!r) {if(v===mcp) throw new Error('current MCP tarball disappeared');continue;}
      mcpNext=v;break;
    }
    // Current artifact must resolve even if a replacement exists.
    if(!await request(meta.versions[mcp].dist.tarball,{method:'HEAD',missing:true})) report.notes.push('MIRROR DISAPPEARANCE: current MCP tarball '+mcp);
    if(!mcpNext) throw new Error('No compatible mature MCP release (review engine/bin/dependency changes)');
    change('devtoolsMcp',mcp,mcpNext);replace('chromium-display.yaml','default: "'+mcp+'"','default: "'+mcpNext+'"');

    const go=options.goBase || 'https://proxy.golang.org';
    const goUrl=go+'/github.com/docker/sandbox-kit-spec/v3/@v';report.sources.push(goUrl);
    const tck=texts.get('tools/install-kit-tck.sh').match(/^version=(\S+)$/m)[1];
    const list=(await request(goUrl+'/list')).body.toString().trim().split('\n');
    const goVersions=[...new Set([tck,...list])].filter(v=>/^v3\.\d+\.\d+(?:-m\.\d+)?$/.test(v) && semver(v,tck)>=0).sort((a,b)=>semver(b,a));
    if(!await request(goUrl+'/'+tck+'.info',{missing:true})) report.notes.push('MIRROR DISAPPEARANCE: current kit-tck '+tck);
    let tckNext=null;
    for(const v of goVersions) {
      const info=await json(goUrl+'/'+v+'.info',{missing:true});if(!info) continue;
      if(v!==tck && !eligible('kit-tck',v,info.Time)) continue;
      const mod=(await request(goUrl+'/'+v+'.mod')).body.toString();
      const required=mod.match(/^go (\d+)\.(\d+)/m);
      if(!required) throw new Error('kit-tck missing Go directive');
      report.notes.push('kit-tck '+v+' requires Go '+required[1]+'.'+required[2]+'; CI uses setup-go stable');
      tckNext=v;break;
    }
    if(!tckNext) throw new Error('No mature kit-tck available');
    change('kit-tck',tck,tckNext);replace('tools/install-kit-tck.sh','version='+tck,'version='+tckNext);

    report.notes.push('OCI metadata resolver: docker buildx imagetools inspect (immutable index/config resolution)');
    for(const [component,image,tag] of [['debian','library/debian','trixie'],['debian-base','debian-base','trixie-dev'],['node','node','24-debian13-dev']]) {
      const registry=component==='debian' ? (options.dockerBase || 'https://registry-1.docker.io') : (options.dhiBase || 'https://dhi.io');
      const ref=(component==='debian'?'debian': 'dhi.io/'+image)+':'+tag;
      const old=texts.get('chromium-display.dockerfile').match(new RegExp(ref+'@(sha256:[a-f0-9]{64})'))?.[1];
      if(!old) throw new Error('Missing OCI pin '+ref);
      report.sources.push(registry+'/v2/'+image+'/manifests/'+tag);
      // Use the existing Docker/Buildx metadata resolver, including its registry
      // challenges, redirects and configured authentication. Never read Docker
      // credential files or construct/log registry tokens in this tool.
      const repository=(component==='debian' ? (options.dockerBase ? new URL(options.dockerBase).host : 'docker.io') : (options.dhiBase ? new URL(options.dhiBase).host : 'dhi.io'))+'/'+image;
      const inspect=async pin=>{
        const target=repository+(pin.startsWith('sha256:')?'@':':')+pin;
        const invoke=async args=>{
          try {return (await exec('docker',['buildx','imagetools','inspect',target,...args],{encoding:'buffer',maxBuffer:10*1024*1024,timeout:90000})).stdout;}
          catch(e) {
            // Registry/CLI stderr may contain bearer tokens or signed redirect
            // URLs. Classify it privately; never copy it into a report.
            const diagnostic=String(e.stderr || '');
            const denied=/401|403|unauthorized|denied|forbidden/i.test(diagnostic);
            if(!denied && /: not found\b|manifest unknown/i.test(diagnostic) && pin.startsWith('sha256:')) return null;
            const reason=denied?'authentication denied':e.code==='ENOENT'?'Docker/Buildx unavailable':'metadata request failed';
            throw new Error('OCI resolver '+reason+' for '+target+'. Verify the existing Docker/Buildx pull route on this runner. DHI Community requires registry authentication; successful native builds or SBX checks do not establish updater access. No pin checks were skipped.');
          }
        };
        const body=await invoke(['--raw']);if(!body) return null;
        const digest=sha(body);
        if(pin.startsWith('sha256:') && digest!==pin) throw new Error(ref+': digest mismatch');
        let index;
        try {index=JSON.parse(body);} catch {throw new Error(ref+': invalid OCI index JSON');}
        for(const arch of arches) {
          const p=index.manifests?.find(m=>m.platform?.os==='linux' && m.platform.architecture===arch);
          if(!p || !/^sha256:[a-f0-9]{64}$/.test(p.digest)) throw new Error(ref+' '+pin+': missing linux/'+arch+' manifest');
        }
        // Resolve configs from the immutable index, never from the moving tag.
        // Buildx's loader verifies platform/config blobs against descriptors.
        const configTarget=repository+'@'+digest;
        let configs;
        try {
          const r=await exec('docker',['buildx','imagetools','inspect',configTarget,'--format','{{json .Image}}'],{maxBuffer:10*1024*1024,timeout:90000});
          configs=JSON.parse(r.stdout);
        } catch {
          throw new Error('OCI config resolution failed for '+configTarget+'. Verify Docker/Buildx registry access and content digests; raw diagnostics suppressed. No pin checks were skipped.');
        }
        const dates=arches.map(arch=>{
          const config=configs['linux/'+arch];
          if(!config || config.os!=='linux' || config.architecture!==arch) throw new Error(ref+': missing verified linux/'+arch+' config');
          return config.created;
        });
        return {digest,dates};
      };
      const currentImage=await inspect(old);
      if(!currentImage) report.notes.push('MIRROR DISAPPEARANCE: '+ref+'@'+old);
      const latest=await inspect(tag);
      if(!latest) throw new Error(ref+': tag disappeared');
      const mature=latest.digest===old || latest.dates.map(d=>eligible(component,latest.digest,d)).every(Boolean);
      if(!mature && !currentImage) throw new Error(ref+': current digest vanished and replacement is in cooldown');
      if(mature) {change(component,old,latest.digest);replace('chromium-display.dockerfile',ref+'@'+old,ref+'@'+latest.digest);}
    }
    for(const target of allow) if(!used.has(target)) throw new Error('Unused security exception (must name an exact younger selected pin): '+target);
    report.outcome=report.changes.length?'update':'no-change';
    if(options.apply) for(const [file,text] of texts) if(text!==original.get(file)) fs.writeFileSync(path.join(root,file),text);
  } catch(e) {report.error=e.message;}
  return report;
}
export function markdown(r) {
  return '# Weekly maintenance: '+r.outcome+'\n\n'+
    (r.error?'**Failure:** '+r.error+'\n\n':'')+
    r.changes.map(c=>'- '+c.component+': '+c.from+' → '+c.to).join('\n')+'\n\n'+
    (r.exceptions.length?'**URGENT SECURITY EXCEPTIONS**\n'+r.exceptions.map(e=>'- '+e.target+': '+e.justification).join('\n')+'\n\n':'')+
    r.notes.map(n=>'- '+n).join('\n')+'\n\nPrimary source metadata checked at '+r.now+':\n'+r.sources.map(s=>'- '+s).join('\n')+'\n';
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const options={};
  const flags={'--debian-base':'debianBase','--npm-base':'npmBase','--go-base':'goBase','--docker-base':'dockerBase','--dhi-base':'dhiBase','--root':'root','--now':'now','--event-name':'eventName','--urgent-security-allow':'urgentSecurityAllow','--security-justification':'securityJustification','--json-out':'jsonOut','--summary-out':'summaryOut'};
  let argumentError;
  for(let i=2;i<process.argv.length;i++) {
    const a=process.argv[i];
    if(a==='--apply') options.apply=true;
    else if(a==='--dry-run') options.dryRun=true;
    // Empty optional strings are how schedule/default workflow inputs arrive.
    else if(flags[a] && i+1<process.argv.length && !process.argv[i+1].startsWith('--')) options[flags[a]]=process.argv[++i];
    else argumentError ||= 'unknown/missing option '+a;
  }
  let report;
  try {
    if(argumentError) throw new Error(argumentError);
    if(options.apply && options.dryRun) throw new Error('choose --apply or --dry-run');
    report=await maintain(options);
  } catch(e) {
    // Preserve reports even for usage/setup failures before maintain's source checks.
    report={outcome:'failure',now:new Date().toISOString(),changes:[],notes:[],exceptions:[],sources:[],error:e.message};
  }
  if(options.jsonOut) fs.writeFileSync(options.jsonOut,JSON.stringify(report,null,2)+'\n');
  const summary=markdown(report);
  if(options.summaryOut) fs.writeFileSync(options.summaryOut,summary);
  console.log(summary);
  process.exitCode=report.outcome==='failure'?1:0;
}
