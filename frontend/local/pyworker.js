/* Kshetralekha "phone server": the real FastAPI backend (backend/*.py) running under Pyodide in a Web Worker,
   for the GitHub Pages build where there is no server. The page sends each /api request here (local/pyhost.js);
   it is passed straight to the ASGI app, so the logic is exactly the server's. Data (SQLite + files) lives in
   IndexedDB through Emscripten's IDBFS, so it survives reloads and stays on this device. */

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
// a module worker (see pyhost.js): import works with CORS everywhere, where importScripts from a CDN can fail
const { loadPyodide } = await import(PYODIDE + 'pyodide.mjs');

const HERE = new URL('./', self.location.href);
const say = (text) => postMessage({ type: 'progress', text });
let py = null;
let handle = null;
let syncTimer = null;
let syncing = Promise.resolve();

function persist() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncing = syncing.then(() => new Promise((resolve) => py.FS.syncfs(false, () => resolve())));
  }, 300);
}

async function start() {
  say('Loading Python');
  py = await loadPyodide({ indexURL: PYODIDE });
  say('Loading FastAPI, Pillow and SQLite');
  await py.loadPackage(['fastapi', 'pillow', 'micropip', 'charset-normalizer']);
  const manifest = await (await fetch(new URL('manifest.json', HERE))).json();
  say('Installing ReportLab');
  py.globals.set('WHEELS', py.toPy(manifest.wheels.map((w) => new URL('wheels/' + w, HERE).href)));
  await py.runPythonAsync('import micropip\nawait micropip.install(list(WHEELS), deps=False)');
  say('Loading the Kshetralekha server');
  py.FS.mkdirTree('/kl/backend');
  py.FS.mkdirTree('/kl/frontend');
  py.FS.mkdirTree('/kl/data');
  for (const name of manifest.backend) {
    const text = await (await fetch(new URL((manifest.backendBase || 'backend/') + name, HERE), { cache: 'no-cache' })).text();
    py.FS.writeFile('/kl/backend/' + name, text);
  }
  py.FS.mount(py.FS.filesystems.IDBFS, {}, '/kl/data');
  await new Promise((resolve, reject) => py.FS.syncfs(true, (err) => (err ? reject(err) : resolve())));
  // Demo data from an older layout is rebuilt (new sites, people and registers would be missing otherwise).
  const DATA_VERSION = '0.4';
  const verPath = '/kl/data/.data-version';
  const oldVer = py.FS.analyzePath(verPath).exists ? py.FS.readFile(verPath, { encoding: 'utf8' }) : '';
  if (oldVer !== DATA_VERSION) {
    const wipe = (dir) => { for (const n of py.FS.readdir(dir)) { if (n === '.' || n === '..') continue; const p = `${dir}/${n}`; if (py.FS.isDir(py.FS.stat(p).mode)) { wipe(p); py.FS.rmdir(p); } else py.FS.unlink(p); } };
    wipe('/kl/data');
    py.FS.writeFile(verPath, DATA_VERSION);
  }
  const fresh = !py.FS.analyzePath('/kl/data/kshetralekha.sqlite').exists;
  say(fresh ? 'Building the demo data (first time only, about a minute)' : 'Opening your data');
  await py.runPythonAsync(`
import os, sys, json
os.environ.update(KL_DATA_DIR='/kl/data', KL_JOURNAL='DELETE', KL_DEMO='1', KL_PBKDF2_ITER='3000')
sys.path.insert(0, '/kl/backend')

# No threads in the browser: run "thread pool" work inline (FastAPI sync routes, FileResponse reads).
import anyio.to_thread
async def _run_sync(func, *args, abandon_on_cancel=False, cancellable=None, limiter=None):
    return func(*args)
anyio.to_thread.run_sync = _run_sync

import app as _kl

async def handle(method, path, query, headers_json, body):
    raw = body.to_bytes() if hasattr(body, 'to_bytes') else b''  # JS null arrives as JsNull, not None
    hdrs = [(k.lower().encode('latin-1'), str(v).encode('latin-1')) for k, v in json.loads(headers_json).items()]
    hdrs.append((b'content-length', str(len(raw)).encode()))
    scope = {'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1', 'method': method, 'scheme': 'https',
             'path': path, 'raw_path': path.encode(), 'query_string': query.encode(), 'root_path': '',
             'headers': hdrs, 'client': ('127.0.0.1', 0), 'server': ('localhost', 443)}
    sent = [False]
    async def receive():
        if not sent[0]:
            sent[0] = True
            return {'type': 'http.request', 'body': raw, 'more_body': False}
        return {'type': 'http.disconnect'}
    out = {'status': 500, 'headers': [], 'body': bytearray()}
    async def send(msg):
        if msg['type'] == 'http.response.start':
            out['status'] = msg['status']
            out['headers'] = [[k.decode('latin-1'), v.decode('latin-1')] for k, v in msg.get('headers', [])]
        elif msg['type'] == 'http.response.body':
            out['body'].extend(msg.get('body', b''))
    await _kl.app(scope, receive, send)
    return [out['status'], out['headers'], bytes(out['body'])]
`);
  handle = py.globals.get('handle');
  persist();
  const tz = py.runPython('from datetime import datetime\nstr(datetime.now().astimezone().utcoffset())');
  postMessage({ type: 'ready', tz });
}

const ready = start().catch((e) => {
  postMessage({ type: 'failed', error: String(e && e.message ? e.message : e).slice(0, 600) });
  throw e;
});

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type !== 'request') return;
  try {
    await ready;
    await syncing; // never read the store half way through a save
    const body = m.body ? new Uint8Array(m.body) : undefined;
    const r = await handle(m.method, m.path, m.query, JSON.stringify(m.headers || {}), body);
    const [status, headers, bytes] = r.toJs();
    r.destroy();
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    if (m.method !== 'GET' && status < 400) persist();
    postMessage({ type: 'response', id: m.id, status, headers, body: buf }, [buf]);
  } catch (err) {
    const msg = new TextEncoder().encode(JSON.stringify({ detail: 'Phone server error: ' + String(err && err.message ? err.message : err).slice(0, 300) })).buffer;
    postMessage({ type: 'response', id: m.id, status: 500, headers: [['content-type', 'application/json']], body: msg }, [msg]);
  }
};
