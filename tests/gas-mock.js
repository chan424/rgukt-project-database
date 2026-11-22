// Minimal in-memory mocks of the Apps Script services used by Code.gs, then loads Code.gs in a VM.
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

function createEnv(codePath, { clientId = 'TEST_CLIENT_ID' } = {}) {
  const props = { CLIENT_ID: clientId };
  const cache = new Map();
  const drive = { folders: new Map(), files: new Map(), seq: 0 };
  const sheetsById = new Map();
  const newId = (p) => p + (++drive.seq).toString(36) + crypto.randomBytes(3).toString('hex');

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) { const row = this.sh.rows[this.r - 1 + i] || []; const o = []; for (let j = 0; j < this.nc; j++) o.push(row[this.c - 1 + j] ?? ''); out.push(o); }
      return out;
    }
    setValues(v) {
      if (v.length !== this.nr || v[0].length !== this.nc) throw new Error('setValues dimension mismatch ' + v.length + 'x' + v[0].length + ' vs ' + this.nr + 'x' + this.nc);
      for (let i = 0; i < this.nr; i++) { const idx = this.r - 1 + i; while (this.sh.rows.length <= idx) this.sh.rows.push([]); for (let j = 0; j < this.nc; j++) this.sh.rows[idx][this.c - 1 + j] = textify(v[i][j]); }
      return this;
    }
    clearContent() { for (let i = 0; i < this.nr; i++) { const row = this.sh.rows[this.r - 1 + i]; if (row) for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = ''; } return this; }
    setFontWeight() { return this; }
    setNumberFormat() { return this; }
  }
  // Sheets formatted as plain text: everything is stored as a string; a leading apostrophe is consumed.
  function textify(v) { if (v === null || v === undefined) return ''; let s = v instanceof Date ? v.toString() : String(v); if (s.startsWith("'")) s = s.slice(1); return s; }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    getLastRow() { for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some(v => v !== '' && v !== undefined)) return i + 1; return 0; }
    getRange(r, c, nr = 1, nc = 1) { if (typeof r === 'string') return new Range(this, 1, 1, 1, 1); return new Range(this, r, c, nr, nc); }
    appendRow(a) { const at = this.getLastRow(); this.rows.splice(at, 0, a.map(textify)); }
    deleteRow(r) { this.rows.splice(r - 1, 1); }
    setFrozenRows() {}
    getName() { return this.name; }
  }
  class Spreadsheet {
    constructor(name) { this.id = newId('ss'); this.name = name; this.sheets = [new Sheet('Sheet1')]; sheetsById.set(this.id, this); drive.files.set(this.id, mkFile(this.id, name, 0, 'sheet')); }
    getId() { return this.id; } getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
    insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
    getSheets() { return this.sheets; } deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  }
  function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }
  function mkFile(id, name, size, mime, parent) {
    return { id, name, size, mime, parent, trashed: false, viewers: [],
      getId() { return id; }, getName() { return name; }, getSize() { return size; }, getUrl() { return 'https://drive.google.com/file/d/' + id; },
      setTrashed(t) { this.trashed = t; }, moveTo(f) { this.parent = f.id; }, addViewer(e) { this.viewers.push(e); }, removeViewer(e) { this.viewers = this.viewers.filter(x => x !== e); },
      sharing: 'PRIVATE', setSharing(a) { this.sharing = a; }, getSharingAccess() { return this.sharing; }, setDescription(d) { this.description = d; } };
  }
  function mkFolder(name, parent) {
    const id = newId('fo');
    const f = { id, name, parent, viewers: [],
      getId() { return id; }, getName() { return name; }, getUrl() { return 'https://drive.google.com/drive/folders/' + id; },
      createFolder(n) { return mkFolder(n, id); },
      getFoldersByName(n) { return iter([...drive.folders.values()].filter(x => x.parent === id && x.name === n)); },
      createFile(blob) { const fid = newId('fi'); const file = mkFile(fid, blob.name, blob.bytes.length, blob.mime, id); file.bytes = blob.bytes; drive.files.set(fid, file); return file; },
      addViewer(e) { this.viewers.push(e); }, removeViewer(e) { this.viewers = this.viewers.filter(x => x !== e); },
      sharing: 'PRIVATE', setSharing(a) { this.sharing = a; }, getSharingAccess() { return this.sharing; }, isTrashed() { return false; } };
    drive.folders.set(id, f);
    return f;
  }
  const lockState = { held: false, acquisitions: 0 };
  const tokenLog = [];

  const globals = {
    console,
    Logger: { log: (m) => (globals.__log = (globals.__log || []).concat(m)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => { const e = cache.get(k); if (!e) return null; if (e.exp < Date.now()) { cache.delete(k); return null; } return e.v; },
      put: (k, v, s) => { if (String(v).length > 100000) throw new Error('cache value too big'); cache.set(k, { v: String(v), exp: Date.now() + (s || 600) * 1000 }); },
      remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { if (lockState.held) throw new Error('lock contention'); lockState.held = true; lockState.acquisitions++; }, releaseLock: () => { lockState.held = false; } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, text) => [...crypto.createHash(alg).update(String(text), 'utf8').digest()].map(b => b > 127 ? b - 256 : b),
      computeHmacSha256Signature: (text, key) => [...crypto.createHmac('sha256', String(key)).update(String(text), 'utf8').digest()].map(b => b > 127 ? b - 256 : b),
      base64Decode: (s) => { if (!/^[A-Za-z0-9+/=\s]*$/.test(s)) throw new Error('bad b64'); return [...Buffer.from(s, 'base64')].map(b => b > 127 ? b - 256 : b); },
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
      formatDate: (d, tz, fmt) => {
        const ist = new Date(d.getTime() + 330 * 60000);
        const p = (n, l = 2) => String(n).padStart(l, '0');
        const Y = ist.getUTCFullYear(), M = p(ist.getUTCMonth() + 1), D = p(ist.getUTCDate()), H = p(ist.getUTCHours()), m = p(ist.getUTCMinutes()), S = p(ist.getUTCSeconds());
        if (fmt === 'yyMMdd') return String(Y).slice(2) + M + D;
        return `${Y}-${M}-${D}T${H}:${m}:${S}+05:30`;
      }
    },
    UrlFetchApp: { fetch: (url) => {
      // Fake tokeninfo: token format TEST~email~hd~aud~exp~verified
      const tok = decodeURIComponent(url.split('id_token=')[1] || '');
      tokenLog.push(tok);
      const parts = tok.split('~');
      if (parts[0] !== 'TEST') return { getResponseCode: () => 400, getContentText: () => '{"error":"invalid_token"}' };
      const [, email, hd, aud, exp, verified] = parts;
      const body = { iss: 'https://accounts.google.com', aud, email, email_verified: verified || 'true', exp: exp || String(Math.floor(Date.now() / 1000) + 3600), name: email.split('@')[0].toUpperCase() + ' Test', picture: '' };
      if (hd) body.hd = hd;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }) },
    SpreadsheetApp: { create: (n) => new Spreadsheet(n), openById: (id) => { const s = sheetsById.get(id); if (!s) throw new Error('no ss'); return s; } },
    DriveApp: {
      Access: { PRIVATE: 'PRIVATE', ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { NONE: 'NONE', VIEW: 'VIEW' },
      createFolder: (n) => mkFolder(n, 'root'),
      getFoldersByName: (n) => iter([...drive.folders.values()].filter(x => x.parent === 'root' && x.name === n)),
      getFolderById: (id) => { const f = drive.folders.get(id); if (!f) throw new Error('no folder'); return f; },
      getFileById: (id) => { const f = drive.files.get(id); if (!f) throw new Error('no file'); return f; }
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'dataongole@gmail.com' }), getScriptTimeZone: () => 'Asia/Kolkata' }
  };
  const context = vm.createContext(globals);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), context, { filename: 'Code.gs' });

  function call(bodyObj) {
    // Each web-app request is a fresh execution: reset per-execution memo caches
    vm.runInContext('_ss = null; _settings = null;', context);
    const out = context.doPost({ postData: { contents: typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj) } });
    return JSON.parse(out.content);
  }
  return { context, call, props, drive, sheetsById, cache, tokenLog, lockState, setup: () => context.setup() };
}

module.exports = { createEnv };
