// Only registry metadata is read; no input, clipboard, or surface is requested.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const le = os.endianness() === 'LE';
const get = (b, n) => le ? b.readUInt32LE(n) : b.readUInt32BE(n);
const put = (b, v, n) => le ? b.writeUInt32LE(v, n) : b.writeUInt32BE(v, n);
export async function probe(socketPath) {
  return new Promise(resolve => {
    const globals = new Set(); let buf = Buffer.alloc(0), done = false;
    const socket = net.createConnection(socketPath);
    const finish = kind => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve({path: socketPath, kind, globals: [...globals].sort()}); };
    const timer = setTimeout(() => finish('unresponsive'), 750);
    socket.on('error', e => finish(['ENOENT', 'ECONNREFUSED'].includes(e.code) ? 'stale' : 'invalid'));
    socket.on('end', () => finish('invalid'));
    socket.on('connect', () => {
      const b = Buffer.alloc(24);
      put(b, 1, 0); put(b, (12 << 16) | 1, 4); put(b, 2, 8); // registry id=2
      put(b, 1, 12); put(b, 12 << 16, 16); put(b, 3, 20); // sync callback id=3
      socket.write(b);
    });
    socket.on('data', data => {
      buf = Buffer.concat([buf, data]);
      while (buf.length >= 8) {
        const id = get(buf, 0), word = get(buf, 4), size = word >>> 16, op = word & 65535;
        if (size < 8 || size % 4 || buf.length > 1024 * 1024) return finish('invalid');
        if (buf.length < size) return;
        const msg = buf.subarray(0, size); buf = buf.subarray(size);
        if (id === 1 && op === 0) return finish('invalid');
        if (id === 2 && op === 0) {
          if (size < 24) return finish('invalid');
          const len = get(msg, 12);
          if (len < 1 || 16 + Math.ceil(len / 4) * 4 + 4 !== size || msg[16 + len - 1] !== 0) return finish('invalid');
          globals.add(msg.toString('utf8', 16, 16 + len - 1));
        }
        if (id === 3 && op === 0) return finish(globals.has('wl_compositor') && globals.has('xdg_wm_base') ? 'compositor' : 'clipboard-only');
      }
    });
  });
}
function identity(p) { try { const s = fs.statSync(p); return s.isSocket() ? `${s.dev}:${s.ino}` : null; } catch { return null; } }
export async function discover(env = process.env) {
  const ambient = env.WAYLAND_DISPLAY ? path.resolve(env.XDG_RUNTIME_DIR || '/run/display', env.WAYLAND_DISPLAY) : null;
  const explicit = env.SBX_WAYLAND_SOCKET ? path.resolve(env.XDG_RUNTIME_DIR || '/run/display', env.SBX_WAYLAND_SOCKET) : null;
  const dirs = env.SBX_DISPLAY_RUNTIME_DIRS !== undefined ? env.SBX_DISPLAY_RUNTIME_DIRS.split(':') : [env.XDG_RUNTIME_DIR, '/run/display', `/run/user/${process.getuid()}`];
  const paths = new Set([explicit, ambient].filter(Boolean));
  if (!explicit) for (const dir of dirs.filter(Boolean)) {
    try { for (const name of fs.readdirSync(dir)) if (name.startsWith('wayland-') && !name.endsWith('.lock')) paths.add(path.join(dir, name)); } catch {}
  }
  const seen = new Set(), candidates = [];
  for (const p of paths) { const key = identity(p); if (key && seen.has(key)) continue; if (key) seen.add(key); candidates.push(p); }
  const results = await Promise.all(candidates.map(probe));
  const live = results.filter(r => r.kind === 'compositor');
  let selected;
  if (explicit) selected = live.find(r => identity(r.path) === identity(explicit));
  else if (live.length === 1) selected = live[0];
  else if (live.length > 1 && ambient && identity(ambient)) selected = live.find(r => identity(r.path) === identity(ambient));
  return {results, selected: selected?.path, error: explicit && !selected ? 'SBX_WAYLAND_SOCKET is not a responsive compositor' : live.length > 1 && !selected ? `ambiguous compositors: ${live.map(r => r.path).join(', ')}; set SBX_WAYLAND_SOCKET=<path> or SBX_CHROME_HEADLESS=1` : null};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await discover();
  if (process.argv.includes('--diag')) console.log(JSON.stringify(r));
  else if (r.error) { console.error(`sbx-chrome: ${r.error}`); process.exitCode = 1; }
  else if (r.selected) console.log(r.selected);
}
