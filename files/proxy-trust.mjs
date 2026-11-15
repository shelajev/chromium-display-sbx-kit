// Proxy and CA trust for the kit's Chromium.
//
// Docker Sandboxes inject credentials and enforce HTTP rules only on the
// forward proxy named by HTTP(S)_PROXY, which re-signs TLS with the sandbox
// CA. Chromium on Linux reads proxy settings from the environment and trusts
// local CAs only through the user's NSS database, not the system PEM bundle.
// So the launcher keeps the proxy environment and imports the sandbox CA into
// $HOME/.pki/nssdb. Every failure is fatal: falling back to a direct
// connection would silently skip credential injection and HTTP policy.
//
// Nothing here prints proxy URLs, certificate material or environment values;
// messages name variables, paths and fingerprints of public certificates.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { X509Certificate, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const prefix = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Where SBX's install-ca-cert.sh writes the CA, and the bundle it appends to.
const SYSTEM_CA = '/usr/local/share/ca-certificates/proxy-ca.crt';
const SYSTEM_BUNDLE = '/etc/ssl/certs/ca-certificates.crt';
const BEGIN = '# BEGIN docker-sandboxes proxy-ca', END = '# END docker-sandboxes proxy-ca';
export const NICKNAME = 'sbx-proxy-ca';
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
// Flags that would override or disable the environment's proxy.
const PROXY_FLAGS = /^--(no-proxy-server|proxy-server|proxy-pac-url|proxy-auto-detect|proxy-bypass-list)(=|$)/;

export class ProxyError extends Error {}
// The canonical routing configuration a launch hands Chromium: mode, the
// effective per-protocol proxy endpoints, the bypass list after the launcher
// adds loopback, and the CA. Held under a non-enumerable symbol, so it never
// reaches JSON, spreads, diag or logs; it leaves this module only as a keyed
// digest (routeSeal/routeMatches).
const ROUTE = Symbol('route');
const withRoute = (result, route) => Object.defineProperty(result, ROUTE, {value: JSON.stringify(route)});
const fail = message => { throw new ProxyError(message); };
// Operational filesystem errors from reading a file. Everything else (a
// TypeError from a bad argument, a bug) is not an expected outcome and
// propagates.
const FS_ERRORS = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EISDIR', 'EIO', 'ELOOP', 'EMFILE', 'ENFILE', 'ENAMETOOLONG', 'EBUSY']);
export const isFsError = e => typeof e?.code === 'string' && FS_ERRORS.has(e.code) && typeof e.syscall === 'string';
// Absence of an optional file: it does not exist, or a path component is not a
// directory, so it cannot exist.
const isAbsent = e => isFsError(e) && (e.code === 'ENOENT' || e.code === 'ENOTDIR');
// OpenSSL's PEM/ASN.1/X.509 decode failures for certificate input.
const isCertDecodeError = e => typeof e?.code === 'string' && e.code.startsWith('ERR_OSSL_');
// true when the file exists, false when it is absent; an unreadable location
// is neither, and the caller is told what to fix.
function present(file, what) {
  try { fs.statSync(file); return true; }
  catch (e) {
    if (isAbsent(e)) return false;
    if (isFsError(e)) fail(`cannot check ${what} ${file} (${e.code}); fix its permissions so the sandbox proxy CA can be found`);
    throw e;
  }
}

function variable(env, upper) {
  const lower = upper.toLowerCase(), a = env[upper] || '', b = env[lower] || '';
  // Tools disagree on which spelling wins; a disagreement is a misconfiguration.
  if (a && b && a !== b) fail(`${upper} and ${lower} differ; set them to the same value`);
  return a || b;
}

function checkProxyUrl(name, value) {
  let url;
  try { url = new URL(value); }
  catch (e) { if (e instanceof TypeError && e.code === 'ERR_INVALID_URL') fail(`${name} is not a valid URL`); throw e; }
  if (!['http:', 'https:'].includes(url.protocol)) fail(`${name} must be an http:// or https:// proxy URL`);
  if (url.username || url.password) fail(`${name} carries credentials; Chromium cannot use proxy credentials from the environment`);
  if (!url.hostname || (url.pathname && url.pathname !== '/') || url.search || url.hash) fail(`${name} must name only a proxy host and port`);
}

function pemCertificates(text) {
  return text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
}

function caSources(env) {
  if (env.SBX_PROXY_CA_FILE) return [{name: env.SBX_PROXY_CA_FILE, read: () => fs.readFileSync(env.SBX_PROXY_CA_FILE, 'utf8')}];
  const sources = [];
  if (present(SYSTEM_CA, 'the sandbox proxy CA file')) sources.push({name: SYSTEM_CA, read: () => fs.readFileSync(SYSTEM_CA, 'utf8')});
  for (const bundle of new Set([env.SSL_CERT_FILE, SYSTEM_BUNDLE].filter(Boolean))) {
    // A bundle that does not exist is simply absent. One that exists but cannot
    // be read might hold the only SBX CA marker, so it is never taken as absent:
    // that would turn the CA-without-proxy refusal into a direct launch.
    let text;
    try { text = fs.readFileSync(bundle, 'utf8'); }
    catch (e) {
      if (isAbsent(e)) continue;
      if (isFsError(e)) fail(`cannot read the CA bundle ${bundle} (${e.code}) to look for the sandbox proxy CA; fix its permissions or point SSL_CERT_FILE at a readable bundle`);
      throw e;
    }
    const start = text.indexOf(BEGIN), end = text.indexOf(END, start);
    if (start >= 0) sources.push({name: `${bundle} (${BEGIN.slice(2)} block)`, read: () => end > start ? text.slice(start, end) : ''});
  }
  if (env.PROXY_CA_CERT_B64) sources.push({name: 'PROXY_CA_CERT_B64', read: () => Buffer.from(env.PROXY_CA_CERT_B64, 'base64').toString('utf8')});
  return sources;
}

function loadCa(env) {
  const sources = caSources(env);
  if (!sources.length) fail('no sandbox proxy CA found (SBX_PROXY_CA_FILE, ' + SYSTEM_CA + ', the SBX block in the CA bundle, or PROXY_CA_CERT_B64)');
  let chosen;
  for (const source of sources) {
    let text;
    try { text = source.read(); }
    catch (e) { if (isFsError(e)) fail(`cannot read proxy CA ${source.name} (${e.code}); fix its permissions or set SBX_PROXY_CA_FILE to a readable copy`); throw e; }
    const pems = pemCertificates(text);
    if (pems.length !== 1) fail(`proxy CA ${source.name} must hold exactly one PEM certificate`);
    let cert;
    try { cert = new X509Certificate(pems[0]); }
    catch (e) { if (isCertDecodeError(e)) fail(`proxy CA ${source.name} is not a valid X.509 certificate`); throw e; }
    if (!cert.ca) fail(`proxy CA ${source.name} is not a CA certificate`);
    const now = Date.now();
    if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) fail(`proxy CA ${source.name} is outside its validity period`);
    const fingerprint = cert.fingerprint256;
    if (chosen && chosen.fingerprint !== fingerprint) fail(`proxy CA sources disagree (${chosen.source} vs ${source.name}); refusing to guess which is current`);
    chosen ??= {pem: pems[0] + '\n', fingerprint, source: source.name};
  }
  return chosen;
}

// The routing decision, without touching the NSS database. Throws ProxyError.
export function plan(env, argv = []) {
  const mode = env.SBX_PROXY_MODE || 'auto';
  if (!['auto', 'proxy', 'direct'].includes(mode)) fail('SBX_PROXY_MODE must be auto, proxy or direct');
  // Direct is an explicit choice; the launcher then unsets every proxy variable.
  if (mode === 'direct') return withRoute({mode: 'direct'}, {mode: 'direct'});
  const http = variable(env, 'HTTP_PROXY'), https = variable(env, 'HTTPS_PROXY'), all = variable(env, 'ALL_PROXY');
  const noProxy = variable(env, 'NO_PROXY');
  const caPresent = caSources(env).length > 0;
  const summary = {mode, http: !!http, https: !!https, all: !!all, noProxyLoopback: LOOPBACK.every(h => noProxy.split(/[\s,]+/).includes(h))};
  if (!http && !https && !all) {
    if (mode === 'proxy') fail('SBX_PROXY_MODE=proxy but none of HTTP_PROXY, HTTPS_PROXY, ALL_PROXY is set');
    if (caPresent) fail('a sandbox proxy CA is present but no proxy variable reached the browser; pass HTTP_PROXY/HTTPS_PROXY through, or set SBX_PROXY_MODE=direct to bypass the proxy deliberately');
    return withRoute({...summary, mode: 'none'}, {mode: 'none'});
  }
  for (const [name, value] of [['HTTP_PROXY', http], ['HTTPS_PROXY', https], ['ALL_PROXY', all]]) if (value) checkProxyUrl(name, value);
  if (!(http || all)) fail('HTTPS_PROXY is set without HTTP_PROXY; http:// and ws:// traffic would bypass the proxy');
  if (!(https || all)) fail('HTTP_PROXY is set without HTTPS_PROXY; https:// and wss:// traffic would bypass the proxy');
  if (noProxy.split(/[\s,]+/).includes('*')) fail('NO_PROXY=* would bypass the proxy for every host; set SBX_PROXY_MODE=direct to do that deliberately');
  const flag = argv.find(a => PROXY_FLAGS.test(a));
  if (flag) fail(`${flag.split('=')[0]} conflicts with the sandbox proxy; set SBX_PROXY_MODE=direct to bypass it deliberately`);
  const ca = loadCa(env);
  const endpoint = value => { if (!value) return null; const u = new URL(value); return `${u.protocol}//${u.host}`; };
  // The bypass list is sealed as the exact text Chromium receives, not as a
  // parsed set: any textual difference is a different route.
  return withRoute({...summary, mode: 'proxy', ca},
    {mode: 'proxy', http: endpoint(http), https: endpoint(https), all: endpoint(all), noProxy: appliedNoProxy(env), ca: ca.fingerprint});
}

// Byte for byte what sbx-chromium exports as no_proxy/NO_PROXY in proxy mode:
// the lowercase spelling (else the uppercase one), then each loopback entry
// not already present as a comma-delimited item appended with a comma.
export function appliedNoProxy(env) {
  let value = env.no_proxy || env.NO_PROXY || '';
  for (const host of LOOPBACK) if (!`,${value},`.includes(`,${host},`)) value = value ? `${value},${host}` : host;
  return value;
}

function certutil(args, input) {
  const bin = `${prefix}/libexec/certutil`;
  if (!fs.existsSync(bin)) fail(`certutil is missing at ${bin}; cannot install the proxy CA`);
  const r = spawnSync(bin, args, {input, encoding: 'utf8', timeout: 20000,
    env: {PATH: '/usr/bin:/bin', LD_LIBRARY_PATH: `${prefix}/lib`}});
  return r;
}

// What certutil reports for NICKNAME, or {probe: reason} when certutil could
// not be run or could not list the database: that is "unknown", never "absent".
function nssState(db) {
  const listed = certutil(['-L', '-d', db]);
  if (listed.error) return {probe: `certutil could not run (${listed.error.code || listed.error.name})`};
  if (listed.status !== 0) return {probe: `certutil could not list the NSS database (exit ${listed.status ?? listed.signal})`};
  const trust = listed.stdout.split('\n').map(l => new RegExp(`^${NICKNAME}\\s+(\\S*),\\S*,\\S*\\s*$`).exec(l)).filter(Boolean).map(m => m[1]);
  const exported = certutil(['-L', '-d', db, '-n', NICKNAME, '-a']);
  if (exported.error) return {probe: `certutil could not run (${exported.error.code || exported.error.name})`};
  const fingerprint = p => {
    try { return new X509Certificate(p).fingerprint256; }
    catch (e) { if (isCertDecodeError(e)) return null; throw e; }  // an undecodable entry is not our CA
  };
  // A nickname that is not present makes the export exit non-zero: no certificates.
  const fingerprints = exported.status === 0 ? pemCertificates(exported.stdout).map(fingerprint) : [];
  return {trust, fingerprints};
}

function trusted(state, fingerprint) {
  return !state.probe && state.fingerprints.length === 1 && state.fingerprints[0] === fingerprint &&
    state.trust.length === 1 && state.trust[0].includes('C');
}

export function nssDir(env) { return path.join(env.HOME || '/nonexistent', '.pki', 'nssdb'); }

// Read-only: is this CA the one trusted under our nickname? {value, probe}:
// value true/false when certutil answered (no database means false), or
// 'unknown' with the reason when it could not be asked.
export function nssTrusted(env, fingerprint) {
  const dir = nssDir(env), bin = `${prefix}/libexec/certutil`;
  if (!present(bin, 'certutil')) return {value: 'unknown', probe: `certutil is missing at ${bin}`};
  if (!present(`${dir}/cert9.db`, 'the NSS database')) return {value: false, probe: null};
  const state = nssState(`sql:${dir}`);
  return state.probe ? {value: 'unknown', probe: state.probe} : {value: trusted(state, fingerprint), probe: null};
}

async function withLock(key, fn) {
  const name = '\0sbx-chromium-nss-' + createHash('sha256').update(key).digest('hex');
  const deadline = Date.now() + 30000;
  for (;;) {
    const server = net.createServer(s => s.destroy());
    const ok = await new Promise((resolve, reject) => {
      server.once('error', e => e.code === 'EADDRINUSE' ? resolve(false) : reject(e));
      server.listen(name, () => resolve(true));
    });
    if (ok) { try { return fn(); } finally { server.close(); } }
    if (Date.now() > deadline) fail('timed out waiting for another launcher to update the NSS database');
    await new Promise(r => setTimeout(r, 100));
  }
}

// Make $HOME/.pki/nssdb trust exactly the current sandbox CA under NICKNAME.
export async function installCa(env, ca) {
  const dir = nssDir(env), db = `sql:${dir}`;
  return withLock(fs.existsSync(dir) ? fs.realpathSync(dir) : dir, () => {
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    if (!fs.existsSync(`${dir}/cert9.db`)) {
      const created = certutil(['-N', '-d', db, '--empty-password']);
      if (created.status !== 0) fail(`cannot create the NSS database in ${dir}`);
    }
    if (trusted(nssState(db), ca.fingerprint)) return;
    // Rotation: drop every certificate we installed before, then add the current one.
    for (let i = 0; i < 16 && certutil(['-D', '-d', db, '-n', NICKNAME]).status === 0; i++);
    const added = certutil(['-A', '-d', db, '-n', NICKNAME, '-t', 'C,,', '-a'], ca.pem);
    const after = nssState(db);
    if (added.error || added.status !== 0 || !trusted(after, ca.fingerprint))
      fail(`cannot install the proxy CA into ${dir} (${added.error ? `certutil could not run (${added.error.code})` : after.probe || 'a password-protected NSS database is not supported'})`);
  });
}

// What a launch from this environment would be configured with: booleans and
// a public fingerprint only. sbx-chrome records it in session.json at start.
export function launchRecord(p) {
  return {mode: p.mode, http: !!p.http, https: !!p.https, all: !!p.all,
    noProxyLoopback: p.noProxyLoopback ?? null, caSha256: p.ca?.fingerprint ?? null};
}

// A per-launch random key and an HMAC of the route under it, stored only in the
// 0600 session record: equal routes can be recognised, but guessable
// host:port values cannot be tested against the stored value without the key.
const hmac = (key, route) => createHmac('sha256', key).update(route).digest();
export function routeSeal(p) {
  const key = randomBytes(32);
  return {routeKey: key.toString('hex'), routeHmac: hmac(key, p[ROUTE]).toString('hex')};
}
// true / false, or null when there is no sealed record to compare with.
export function routeMatches(record, p) {
  if (!/^[0-9a-f]{64}$/.test(record?.routeKey || '') || !/^[0-9a-f]{64}$/.test(record?.routeHmac || '')) return null;
  return timingSafeEqual(hmac(Buffer.from(record.routeKey, 'hex'), p[ROUTE]), Buffer.from(record.routeHmac, 'hex'));
}

// Non-secret metadata for `sbx-chrome diag` about the CALLER's environment:
// what a start from here would use, not what a running browser uses.
// nssDbHasCurrentCa only says the NSS database holds the CA this environment
// names; it is not evidence about any browser's live connections.
export function describe(env) {
  try {
    const p = plan(env);
    const {ca, ...rest} = p;
    const nss = ca ? nssTrusted(env, ca.fingerprint) : {value: null, probe: null};
    return {...rest, caSource: ca?.source ?? null, caSha256: ca?.fingerprint ?? null,
      nssDb: nssDir(env), nssDbHasCurrentCa: nss.value, nssProbeError: nss.probe, error: null};
  } catch (e) {
    if (!(e instanceof ProxyError)) throw e;
    return {mode: 'error', error: e.message};
  }
}

// `node proxy-trust.mjs prepare [chromium args…]` prints none, direct or proxy.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...argv] = process.argv.slice(2);
  try {
    if (command !== 'prepare') fail('usage: proxy-trust.mjs prepare [chromium args...]');
    const p = plan(process.env, argv);
    if (p.mode === 'proxy') await installCa(process.env, p.ca);
    if (p.mode === 'direct') console.error('sbx-chromium: SBX_PROXY_MODE=direct: bypassing the sandbox proxy; credential injection and HTTP policy rules do not apply');
    console.log(p.mode);
  } catch (e) {
    // Only configuration/trust refusals are expected here. Anything else
    // propagates: Node exits non-zero with no mode on stdout, which
    // sbx-chromium already treats as a refusal (it never launches without a
    // mode). URL-bearing parse errors are converted to ProxyError where they
    // occur, so a propagated error carries no proxy URL.
    if (!(e instanceof ProxyError)) throw e;
    console.error(`sbx-chromium: proxy setup failed: ${e.message}; not starting the browser`);
    process.exitCode = 1;
  }
}
