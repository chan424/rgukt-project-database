/* Core helpers: safe DOM builder, API client, session, toasts, modals. */
'use strict';

const CFG = window.APP_CONFIG;

/**
 * Safe element builder. Never uses innerHTML, so user data cannot inject markup.
 * h('div', {class:'x', onclick: fn, attrs:{'aria-label':'y'}}, 'text', childNode, [more])
 */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'attrs') for (const [a, b] of Object.entries(v)) { if (b !== undefined && b !== null && b !== false) el.setAttribute(a, b === true ? '' : b); }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
  }
  appendKids(el, children);
  return el;
}
function appendKids(el, kids) {
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendKids(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
/** Like el.append() but skips null/undefined/false (native append would print "null"). */
function appendTo(el, ...kids) { appendKids(el, kids); return el; }
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
const $ = (sel, root = document) => root.querySelector(sel);

/* ---------------- Session ---------------- */
const Session = {
  KEY: 'rop_session',
  get() { try { return JSON.parse(sessionStorage.getItem(this.KEY) || 'null'); } catch (e) { return null; } },
  set(s) { sessionStorage.setItem(this.KEY, JSON.stringify(s)); },
  clear() { sessionStorage.removeItem(this.KEY); },
  token() { const s = this.get(); return s ? s.session : null; }
};

/* ---------------- API ---------------- */
class ApiError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

async function api(action, payload = {}, opts = {}) {
  const body = JSON.stringify({ action, session: Session.token(), payload });
  let res;
  try {
    // text/plain keeps this a "simple" CORS request (no preflight), which Apps Script requires.
    res = await fetch(CFG.API_URL, {
      method: 'POST', redirect: 'follow', cache: 'no-store', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body
    });
  } catch (e) {
    throw new ApiError('Cannot reach the server. Check your internet connection.', 0);
  }
  let j;
  try { j = await res.json(); } catch (e) { throw new ApiError('Unexpected server response (' + res.status + ').', res.status); }
  if (!j.ok) {
    if (j.code === 401 && action !== 'auth.login' && !opts.noAuthRedirect) {
      Session.clear();
      toast(j.error || 'Session expired', 'warn');
      window.App && window.App.showLogin();
    }
    throw new ApiError(j.error || 'Request failed', j.code);
  }
  return j.data;
}

/* ---------------- Busy overlay ---------------- */
let busyCount = 0;
function busy(on, text) {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  const b = $('#busy');
  if (text) $('#busy-text').textContent = text;
  b.hidden = busyCount === 0;
}
async function withBusy(text, fn) {
  busy(true, text);
  try { return await fn(); } finally { busy(false); }
}

/* ---------------- Toasts ---------------- */
function toast(msg, kind = 'ok', ms = 4200) {
  const t = h('div', { class: 'toast toast-' + kind, attrs: { role: kind === 'error' ? 'alert' : 'status' } },
    h('span', { class: 'toast-msg', text: msg }),
    h('button', { class: 'toast-x', attrs: { 'aria-label': 'Dismiss' }, text: '×', onclick: () => t.remove() }));
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? Math.max(ms, 9000) : ms);
}
function toastError(e) { toast(e && e.message ? e.message : String(e), 'error'); }

/* ---------------- Modal ---------------- */
function openModal(title, bodyNode, { wide = false, actions = [] } = {}) {
  const root = $('#modal-root');
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal' + (wide ? ' modal-wide' : ''), attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } },
      h('div', { class: 'modal-head' },
        h('h3', { text: title }),
        h('button', { class: 'icon-btn', attrs: { 'aria-label': 'Close' }, text: '×', onclick: close })),
      h('div', { class: 'modal-body' }, bodyNode),
      actions.length ? h('div', { class: 'modal-foot' }, actions.map(a =>
        h('button', { class: 'btn ' + (a.class || ''), text: a.label, onclick: () => a.onClick(close) }))) : null));
  root.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  const f = overlay.querySelector('input,select,textarea,button.btn');
  if (f) setTimeout(() => f.focus(), 30);
  return close;
}
function confirmBox(title, message, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const close = openModal(title, h('p', { class: 'pre-line', text: message }), {
      actions: [
        { label: 'Cancel', class: 'btn-ghost', onClick: (c) => { done = true; c(); resolve(false); } },
        { label: okLabel, class: danger ? 'btn-danger' : 'btn-primary', onClick: (c) => { done = true; c(); resolve(true); } }
      ]
    });
    void close; void done;
  });
}

/* ---------------- Formatting ---------------- */
const fmtDate = (iso) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };
const fmtDateTime = (iso) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const fmtINR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

function statusPill(status) {
  const cls = { 'Submitted': 'pill-info', 'Verified': 'pill-good', 'Needs Correction': 'pill-warn', 'Rejected': 'pill-bad' }[status] || 'pill-muted';
  const icon = { 'Submitted': '●', 'Verified': '✓', 'Needs Correction': '!', 'Rejected': '✕' }[status] || '•';
  return h('span', { class: 'pill ' + cls }, h('span', { attrs: { 'aria-hidden': 'true' }, text: icon + ' ' }), status);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read ' + file.name));
    r.readAsDataURL(file);
  });
}

/** CSV with protection against spreadsheet formula injection. */
function toCSV(rows) {
  return rows.map(r => r.map(v => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}
function downloadText(name, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Tabs widget. tabs: [{id,label,render(container)}] */
function tabBar(tabs, activeId, onChange) {
  return h('nav', { class: 'tabs', attrs: { role: 'tablist' } }, tabs.map(t =>
    h('button', {
      class: 'tab' + (t.id === activeId ? ' active' : ''), attrs: { role: 'tab', 'aria-selected': String(t.id === activeId) },
      onclick: () => onChange(t.id)
    }, t.label, t.badge !== undefined ? h('span', { class: 'tab-badge', text: String(t.badge) }) : null)));
}

function emptyState(title, text) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon', attrs: { 'aria-hidden': 'true' }, text: '📂' }),
    h('h3', { text: title }), text ? h('p', { text }) : null);
}

function uniqSorted(arr) { return [...new Set(arr.filter(v => v !== '' && v !== null && v !== undefined))].sort(); }
