// Mock minimal layanan Google Apps Script supaya kode server Kas Eunoia bisa
// dijalankan di Node (untuk tes & preview UI). Bukan implementasi lengkap.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function pad(n) { return String(n).padStart(2, '0'); }

function makeSheet(name) {
  const data = []; // array of rows
  const sh = {
    name,
    getName: () => name,
    getLastRow: () => { for (let i = data.length - 1; i >= 0; i--) if (data[i] && data[i].some(c => c !== '')) return i + 1; return 0; },
    getMaxColumns: () => Math.max(26, ...data.map(r => (r || []).length)),
    getMaxRows: () => 1000,
    getDataRange: () => ({ getValues: () => {
      const last = sh.getLastRow(); const w = Math.max(0, ...data.slice(0, last).map(r => (r || []).length));
      return data.slice(0, last).map(r => Array.from({ length: w }, (_, i) => (r && r[i] !== undefined ? r[i] : '')));
    } }),
    getRange: (r, c, nr = 1, nc = 1) => ({
      setValues: vals => { vals.forEach((row, i) => { data[r - 1 + i] = data[r - 1 + i] || []; row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; }); }); return sh._range; },
      clearContent: () => { for (let i = 0; i < nr; i++) if (data[r - 1 + i]) for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = ''; },
      setNumberFormat: () => sh._range, setFontWeight: () => sh._range
    }),
    deleteRow: r => { data.splice(r - 1, 1); },
    setFrozenRows: () => {},
    clear: () => { data.length = 0; },
    _data: data
  };
  sh._range = { setFontWeight: () => sh._range, setNumberFormat: () => sh._range };
  return sh;
}

function createGas(opts = {}) {
  const sheets = {};
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: s => { delete sheets[s.name]; }
  };
  const props = {}; const cache = {};
  const files = {};
  const sent = [];
  const fixedNow = opts.now ? new Date(opts.now) : null;
  const RealDate = Date;
  const ctx = {
    console,
    SpreadsheetApp: { getActive: () => ss, getUi: () => { throw new Error('no ui'); }, openById: () => { throw new Error('openById not mocked'); } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'bendahara@example.com' }) },
    MailApp: { sendEmail: (to, subj, body) => sent.push({ to, subj, body }) },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/DEMO/exec' }),
      getProjectTriggers: () => [], deleteTrigger: () => {},
      newTrigger: () => { const b = { timeBased: () => b, everyDays: () => b, atHour: () => b, inTimezone: () => b, create: () => ({}) }; return b; }
    },
    CalendarApp: { getDefaultCalendar: () => { throw new Error('calendar not mocked'); } },
    DriveApp: {
      createFolder: n => ({ getId: () => 'folder1', getName: () => n }),
      getFolderById: () => ({
        createFile: (a, b, c) => { const id = 'f' + Object.keys(files).length; files[id] = typeof a === 'string' ? b : a; return { getUrl: () => 'https://drive.google.com/file/d/' + id, getId: () => id, setSharing: () => {} }; },
        getFilesByName: () => ({ hasNext: () => false })
      }),
      getFileById: id => ({ getBlob: () => ({ getDataAsString: () => files[id] }), setTrashed: () => {} }),
      Access: {}, Permission: {}
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const t = new RealDate(d.getTime() + 7 * 3600e3);
        const map = { yyyy: t.getUTCFullYear(), MM: pad(t.getUTCMonth() + 1), dd: pad(t.getUTCDate()), HH: pad(t.getUTCHours()), mm: pad(t.getUTCMinutes()), ss: pad(t.getUTCSeconds()) };
        return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, k => map[k]);
      },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      base64Encode: data => (typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.map(b => (b + 256) % 256))).toString('base64'),
      base64Decode: s => Array.from(Buffer.from(s, 'base64')),
      newBlob: (data, mime, name) => ({ data, mime, name, getAs: () => ({ setName: () => ({}) }), setName() { return this; } }),
      sleep: () => {},
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }
    },
    HtmlService: {
      createTemplateFromFile: n => ({ getRawContent: () => fs.readFileSync(path.join(__dirname, '..', 'apps-script', n + '.html'), 'utf8') })
    },
    ContentService: { createTextOutput: s => ({ setMimeType: () => s }), MimeType: {} },
    UrlFetchApp: { fetch: () => { throw new Error('network disabled in mock'); } }
  };
  if (fixedNow) {
    ctx.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixedNow.getTime()])); } static now() { return fixedNow.getTime(); } };
  }
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'apps-script');
  for (const f of ['Engine.gs', 'Db.gs', 'Setup.gs', 'Import.gs', 'Api.gs', 'Reports.gs', 'Hero.gs']) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }
  ctx.__sheets = sheets; ctx.__sent = sent; ctx.__props = props;
  return ctx;
}

module.exports = { createGas };
