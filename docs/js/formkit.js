/* FormKit: renders the dynamic project form from the server-side form definition. */
'use strict';

const FormKit = (() => {
  let uid = 0;
  const MIME_BY_EXT = { pdf: '.pdf', doc: '.doc', docx: '.docx', ppt: '.ppt', pptx: '.pptx', zip: '.zip', png: '.png', jpg: '.jpg,.jpeg' };

  function category(form, id) { return form.categories.find(c => c.id === id) || null; }
  function categoryLabel(form, id) { const c = category(form, id); return c ? c.label : id; }
  function fieldsFor(form, catId) { const c = category(form, catId); return c ? form.commonFields.concat(c.fields) : form.commonFields.slice(); }
  function isVisible(f, values) {
    if (!f.showIf || !f.showIf.field) return true;
    const v = values[f.showIf.field];
    return String(v === undefined || v === null ? '' : v) === String(f.showIf.equals);
  }
  function isEmpty(v) { return v === '' || v === null || v === undefined || (typeof v === 'object' && !v.name); }

  function displayValue(f, v) {
    if (v === undefined || v === null || v === '') return '—';
    if (typeof v === 'object') return v.name ? (v.name + ' (' + v.department + ')' + (v.other ? ' · not in list' : '')) : '—';
    if (f && f.type === 'date') return fmtDate(v);
    if (f && f.id === 'stipend') return fmtINR(v);
    return String(v);
  }

  function labelEl(f, forId) {
    return h('label', { class: 'field-label', attrs: { for: forId } }, f.label, f.required ? h('span', { class: 'req', attrs: { 'aria-hidden': 'true' }, text: ' *' }) : null);
  }

  function makeControl(f, value, existingFile, ctx, onChange) {
    const id = 'f_' + f.id + '_' + (++uid);
    const wide = f.type === 'textarea' || f.type === 'file' || f.type === 'faculty' || f.id === 'title';
    const err = h('div', { class: 'field-error', attrs: { 'aria-live': 'polite' } });
    const wrap = h('div', { class: 'field' + (wide ? ' span-2' : '') });
    let get, setError = (m) => { err.textContent = m || ''; wrap.classList.toggle('has-error', !!m); };
    let control;

    switch (f.type) {
      case 'textarea': {
        const max = f.maxLength || 5000;
        const ta = h('textarea', { id, rows: 5, maxLength: max, placeholder: f.placeholder || '', value: value || '', oninput: () => { cnt.textContent = ta.value.length + ' / ' + max; onChange(); } });
        const cnt = h('div', { class: 'counter', text: (value || '').length + ' / ' + max });
        control = h('div', {}, ta, cnt);
        get = () => ta.value.trim();
        break;
      }
      case 'select':
      case 'department': {
        const opts = f.type === 'department' ? ctx.departments : (f.options || []);
        const sel = h('select', { id, onchange: onChange },
          h('option', { value: '', text: '— Select —' }),
          opts.map(o => h('option', { value: o, text: o, selected: o === value })));
        if (value && opts.indexOf(value) < 0) sel.appendChild(h('option', { value, text: value + ' (no longer listed)', selected: true }));
        control = sel; get = () => sel.value;
        break;
      }
      case 'radio': {
        const name = id;
        control = h('div', { class: 'radio-row', attrs: { role: 'radiogroup', 'aria-labelledby': id + '_l' } },
          (f.options || []).map((o, i) => h('label', { class: 'radio' },
            h('input', { type: 'radio', name, value: o, checked: o === value, id: i === 0 ? id : undefined, onchange: onChange }), h('span', { text: o }))));
        get = () => { const c = control.querySelector('input:checked'); return c ? c.value : ''; };
        break;
      }
      case 'faculty': {
        const v = (value && typeof value === 'object') ? value : {};
        const OTHER = '__other__';
        const dSel = h('select', { id, attrs: { 'aria-label': f.label + ' – department' } },
          h('option', { value: '', text: '— Department —' }), ctx.departments.map(d => h('option', { value: d, text: d, selected: d === v.department })));
        const nSel = h('select', { attrs: { 'aria-label': f.label + ' – faculty name' } });
        const other = h('input', { type: 'text', maxLength: 120, placeholder: 'Type faculty name', value: v.other ? (v.name || '') : '', hidden: !v.other, attrs: { 'aria-label': f.label + ' – other name' } });
        const fillNames = () => {
          clear(nSel);
          const list = ctx.faculty.filter(x => x.department === dSel.value);
          nSel.appendChild(h('option', { value: '', text: dSel.value ? (list.length ? '— Faculty —' : '— No faculty listed —') : '— Choose department first —' }));
          list.forEach(x => nSel.appendChild(h('option', { value: x.name, text: x.name + (x.designation ? ', ' + x.designation : '') })));
          if (f.allowOther && dSel.value) nSel.appendChild(h('option', { value: OTHER, text: 'Other (not in list)…' }));
          nSel.disabled = !dSel.value;
        };
        fillNames();
        if (v.department && v.name) {
          if (v.other) nSel.value = OTHER;
          else if ([...nSel.options].some(o => o.value === v.name)) nSel.value = v.name;
          else nSel.appendChild(h('option', { value: v.name, text: v.name + ' (no longer listed)', selected: true }));
        }
        dSel.addEventListener('change', () => { fillNames(); other.hidden = true; onChange(); });
        nSel.addEventListener('change', () => { other.hidden = nSel.value !== OTHER; if (!other.hidden) other.focus(); onChange(); });
        control = h('div', { class: 'faculty-pick' }, dSel, nSel, other);
        get = () => {
          if (!dSel.value && !nSel.value) return '';
          if (nSel.value === OTHER) return other.value.trim() ? { department: dSel.value, name: other.value.trim(), other: true } : { department: dSel.value, name: '' };
          return { department: dSel.value, name: nSel.value, other: false };
        };
        break;
      }
      case 'file': {
        const exts = (ctx.allowedFileTypes || ['pdf']);
        const accept = exts.map(e => MIME_BY_EXT[e] || ('.' + e)).join(',');
        const inp = h('input', { id, type: 'file', accept });
        const info = h('div', { class: 'file-info' });
        const showExisting = () => {
          clear(info);
          if (existingFile) info.appendChild(h('span', {}, '📎 Current file: ', h('strong', { text: existingFile.name }), ' (' + fmtSize(existingFile.size) + ') — choose a new file to replace it.'));
          info.appendChild(h('div', { class: 'muted small', text: 'Allowed: ' + exts.join(', ').toUpperCase() + ' · max ' + ctx.maxFileMB + ' MB' }));
        };
        showExisting();
        inp.addEventListener('change', () => {
          setError('');
          const file = inp.files[0];
          if (file && file.size > ctx.maxFileMB * 1048576) { setError('File is larger than ' + ctx.maxFileMB + ' MB'); inp.value = ''; }
        });
        control = h('div', { class: 'file-pick' }, inp, info);
        get = () => inp.files[0] || null;
        wrap._hasExisting = !!existingFile;
        break;
      }
      default: {
        const type = { number: 'number', date: 'date', url: 'url' }[f.type] || 'text';
        const inp = h('input', {
          id, type, value: value === undefined || value === null ? '' : value, placeholder: f.placeholder || '',
          maxLength: type === 'text' || type === 'url' ? (f.maxLength || (type === 'url' ? 500 : 300)) : undefined,
          min: f.min, max: f.max, step: type === 'number' ? 'any' : undefined, oninput: onChange, onchange: onChange
        });
        control = inp; get = () => inp.value.trim();
      }
    }
    const lab = labelEl(f, id); lab.id = id + '_l';
    wrap.addEventListener('input', () => setError(''));
    wrap.addEventListener('change', () => { if (f.type !== 'file') setError(''); });
    appendTo(wrap, lab, control, f.help ? h('div', { class: 'help', text: f.help }) : null, err);
    return { wrap, get, setError, field: f, visible: true };
  }

  /**
   * Build an editable form for a category.
   * Returns { el, collect() -> {ok, data, files:{fieldId: File}} }
   */
  function build(form, ctx, catId, initial = {}) {
    const data = initial.data || {}, existingFiles = initial.files || {};
    const cat = category(form, catId);
    const controls = {};
    const fields = fieldsFor(form, catId);
    const refresh = () => {
      const vals = values();
      fields.forEach(f => { const c = controls[f.id]; c.visible = isVisible(f, vals); c.wrap.hidden = !c.visible; });
    };
    const onChange = () => refresh();
    fields.forEach(f => { controls[f.id] = makeControl(f, data[f.id], existingFiles[f.id], ctx, onChange); });
    function values() { const v = {}; fields.forEach(f => { if (f.type !== 'file') v[f.id] = controls[f.id].get(); }); return v; }

    const general = h('section', { class: 'card form-card' },
      h('div', { class: 'card-head' }, h('span', { class: 'step', text: '2' }), h('h3', { text: 'General details' })),
      h('div', { class: 'form-grid' }, form.commonFields.map(f => controls[f.id].wrap)));
    const details = cat && cat.fields.length ? h('section', { class: 'card form-card' },
      h('div', { class: 'card-head' }, h('span', { class: 'step', text: '3' }), h('h3', { text: cat.label + ' details' })),
      h('div', { class: 'form-grid' }, cat.fields.map(f => controls[f.id].wrap))) : null;
    refresh();

    function collect() {
      const vals = values();
      const files = {};
      let firstBad = null;
      fields.forEach(f => {
        const c = controls[f.id];
        c.setError('');
        if (!c.visible) { delete vals[f.id]; return; }
        if (f.type === 'file') {
          const file = c.get();
          if (file) files[f.id] = file;
          else if (f.required && !c.wrap._hasExisting) { c.setError('Please upload a file'); firstBad = firstBad || c; }
          return;
        }
        const v = vals[f.id];
        if (f.type === 'faculty' && v && typeof v === 'object' && (!v.department || !v.name)) { c.setError('Choose both department and faculty'); firstBad = firstBad || c; return; }
        if (f.required && isEmpty(v)) { c.setError('This field is required'); firstBad = firstBad || c; return; }
        if (f.type === 'url' && v && !/^https?:\/\/\S+$/i.test(v)) { c.setError('Enter a link starting with https://'); firstBad = firstBad || c; }
        if (f.type === 'number' && v !== '' && !isFinite(Number(v))) { c.setError('Enter a number'); firstBad = firstBad || c; }
      });
      if (vals.start_date && vals.end_date && vals.end_date < vals.start_date && controls.end_date) {
        controls.end_date.setError('End date cannot be before start date'); firstBad = firstBad || controls.end_date;
      }
      if (firstBad) { firstBad.wrap.scrollIntoView({ behavior: 'smooth', block: 'center' }); return { ok: false }; }
      fields.forEach(f => { if (f.type === 'number' && vals[f.id] !== '' && vals[f.id] !== undefined) vals[f.id] = Number(vals[f.id]); });
      return { ok: true, data: vals, files };
    }
    return { el: h('div', { class: 'form-stack' }, general, details), collect };
  }

  /** Read-only definition list of a record's answers. */
  function details(form, rec, { showFileLinks = false } = {}) {
    const fields = fieldsFor(form, rec.category);
    const known = new Set(fields.map(f => f.id));
    const rows = [];
    fields.forEach(f => {
      if (f.type === 'file') {
        const file = rec.files && rec.files[f.id];
        if (!file) return;
        rows.push([f.label, showFileLinks && file.url && /^https:\/\/drive\.google\.com\//.test(file.url)
          ? h('a', { href: file.url, target: '_blank', rel: 'noopener noreferrer', text: '📎 ' + file.name + ' (' + fmtSize(file.size) + ')' })
          : h('span', { text: '📎 ' + file.name + ' (' + fmtSize(file.size) + ')' })]);
        return;
      }
      if (!(f.id in (rec.data || {}))) return;
      const v = rec.data[f.id];
      const node = f.type === 'url' && v && /^https?:\/\//i.test(v)
        ? h('a', { href: v, target: '_blank', rel: 'noopener noreferrer nofollow', text: v })
        : h('span', { class: f.type === 'textarea' ? 'pre-line' : '', text: displayValue(f, v) });
      rows.push([f.label, node]);
    });
    // Answers to fields that were later removed from the form are still shown
    Object.keys(rec.data || {}).forEach(k => { if (!known.has(k)) rows.push([k + ' (archived field)', h('span', { text: displayValue(null, rec.data[k]) })]); });
    return h('dl', { class: 'dl' }, rows.map(([k, v]) => [h('dt', { text: k }), h('dd', {}, v)]));
  }

  return { build, details, displayValue, fieldsFor, category, categoryLabel, isVisible };
})();
