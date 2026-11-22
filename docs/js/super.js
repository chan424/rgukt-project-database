/* Super-admin tools (dataongole@gmail.com): form builder, faculty list, users & access, settings, audit log. */
'use strict';

const SuperView = (() => {
  const TYPE_LABELS = { text: 'Short text', textarea: 'Long text', number: 'Number', date: 'Date', select: 'Drop-down',
    radio: 'Choice buttons', url: 'Web link', department: 'Department list', faculty: 'Faculty (dept → name)', file: 'File upload' };
  let ctx, hooks;
  let draft = null, dirty = false, selSection = '__common__', openField = null, savedIds = new Set();
  let faculty = null, facDirty = false, facFilter = { dept: '', q: '' };

  function tabs() {
    return [
      { id: 'form', label: 'Form Builder' },
      { id: 'faculty', label: 'Faculty' },
      { id: 'users', label: 'Users & Access' },
      { id: 'settings', label: 'Settings & Drive' },
      { id: 'audit', label: 'Audit Log' }
    ];
  }

  function render(tab, panel, context, h0) {
    ctx = context; hooks = h0;
    if (tab === 'form') renderForm(panel);
    else if (tab === 'faculty') renderFaculty(panel);
    else if (tab === 'users') renderUsers(panel);
    else if (tab === 'settings') renderSettings(panel);
    else if (tab === 'audit') renderAudit(panel);
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40) || 'field';

  /* =================== FORM BUILDER =================== */
  function resetDraft() {
    draft = clone(ctx.form); dirty = false; openField = null;
    savedIds = new Set();
    draft.commonFields.forEach(f => savedIds.add(f.id));
    draft.categories.forEach(c => { savedIds.add('cat:' + c.id); c.fields.forEach(f => savedIds.add(c.id + ':' + f.id)); });
  }
  function sectionFields() { return selSection === '__common__' ? draft.commonFields : (draft.categories.find(c => c.id === selSection) || { fields: [] }).fields; }
  function isSaved(f) { return selSection === '__common__' ? savedIds.has(f.id) : savedIds.has(selSection + ':' + f.id); }
  function isSystem(f) { return ctx.systemFields.indexOf(f.id) >= 0 && isSaved(f); }
  let bar = {};
  function markDirty() {
    dirty = true;
    if (bar.save) { bar.save.disabled = false; bar.discard.disabled = false; bar.pill.hidden = false; }
  }

  function renderForm(panel) {
    if (!draft) resetDraft();
    const host = h('div');
    const draw = () => {
      clear(host);
      if (!draft.categories.find(c => c.id === selSection)) selSection = selSection === '__common__' ? selSection : '__common__';
      appendTo(host, 
        h('div', { class: 'toolbar sticky-bar' },
          h('div', {}, h('strong', { text: 'Form version ' + (ctx.form.version || 1) }),
            h('span', { class: 'muted', text: ctx.form.updatedAt ? ' · last saved ' + fmtDateTime(ctx.form.updatedAt) : '' }),
            bar.pill = h('span', { class: 'pill pill-warn', text: '● Unsaved changes', hidden: !dirty })),
          h('div', { class: 'toolbar-right' },
            h('button', { class: 'btn btn-ghost btn-sm', text: 'Preview as student', onclick: preview }),
            h('button', { class: 'btn btn-ghost btn-sm', text: 'Restore default form', onclick: restoreDefault }),
            bar.discard = h('button', { class: 'btn btn-ghost btn-sm', text: 'Discard changes', disabled: !dirty, onclick: () => { resetDraft(); draw(); } }),
            bar.save = h('button', { class: 'btn btn-primary btn-sm', text: 'Save form', disabled: !dirty, onclick: () => saveForm(draw) }))),
        h('div', { class: 'builder' },
          h('aside', { class: 'builder-nav' },
            h('div', { class: 'muted small', text: 'SECTIONS' }),
            navBtn('__common__', 'General details', 'Shown for every type', draw),
            h('div', { class: 'muted small mt', text: 'PROJECT TYPES (first drop-down)' }),
            draft.categories.map((c, i) => navBtn(c.id, c.label, c.fields.length + ' fields', draw, i)),
            h('button', { class: 'btn btn-secondary btn-sm full', text: '+ Add project type', onclick: () => addCategory(draw) })),
          h('section', { class: 'builder-main' }, sectionEditor(draw))));
    };
    panel.appendChild(host);
    draw();
  }

  function navBtn(id, label, sub, draw, idx) {
    const cat = idx !== undefined;
    return h('div', { class: 'nav-item' + (selSection === id ? ' active' : '') },
      h('button', { class: 'nav-main', onclick: () => { selSection = id; openField = null; draw(); } },
        h('div', { class: 'nav-label', text: label }), h('div', { class: 'nav-sub', text: sub })),
      cat ? h('div', { class: 'nav-move' },
        h('button', { class: 'icon-btn sm', text: '↑', attrs: { 'aria-label': 'Move up' }, disabled: idx === 0, onclick: () => { move(draft.categories, idx, -1); markDirty(); draw(); } }),
        h('button', { class: 'icon-btn sm', text: '↓', attrs: { 'aria-label': 'Move down' }, disabled: idx === draft.categories.length - 1, onclick: () => { move(draft.categories, idx, 1); markDirty(); draw(); } })) : null);
  }
  function move(arr, i, d) { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; }

  function sectionEditor(draw) {
    const cat = draft.categories.find(c => c.id === selSection);
    const fields = sectionFields();
    const head = cat
      ? h('div', { class: 'card' },
          h('div', { class: 'form-grid' },
            h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Project type name (shown in first drop-down)' }),
              h('input', { type: 'text', value: cat.label, maxLength: 80, oninput: (e) => {
                cat.label = e.target.value; markDirty();
                const nl = document.querySelector('.nav-item.active .nav-label'); if (nl) nl.textContent = cat.label;
              } })),
            h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Internal id' }),
              h('input', { type: 'text', value: cat.id, disabled: savedIds.has('cat:' + cat.id), maxLength: 40,
                onchange: (e) => { const v = slug(e.target.value); if (draft.categories.some(c => c !== cat && c.id === v)) { toast('That id is already used', 'warn'); draw(); return; } cat.id = v; selSection = v; markDirty(); draw(); } }),
              h('span', { class: 'help', text: savedIds.has('cat:' + cat.id) ? 'Locked: existing records use this id.' : 'Lower-case letters, digits and _' }))),
          h('div', { class: 'row-end' }, h('button', { class: 'btn btn-danger-ghost btn-sm', text: 'Delete this project type', disabled: draft.categories.length <= 1,
            onclick: async () => {
              if (!(await confirmBox('Delete project type?', 'Remove “' + cat.label + '” from the form? Existing records of this type are kept but students will no longer be able to choose it.', 'Delete', true))) return;
              draft.categories = draft.categories.filter(c => c !== cat); selSection = '__common__'; markDirty(); draw();
            } })))
      : h('div', { class: 'banner banner-info', text: 'General details are asked for every project type. Title, Department and Academic Year are system fields used by the dashboard; they can be relabelled but not removed.' });

    const list = h('div', { class: 'field-list' }, fields.map((f, i) => fieldRow(f, i, fields, draw)));
    return h('div', {}, head, h('h3', { class: 'section-title', text: (cat ? cat.label : 'General details') + ' — fields' }), list,
      h('button', { class: 'btn btn-secondary', text: '+ Add field', onclick: () => {
        const base = 'new_field'; let id = base, n = 1;
        const used = new Set(draft.commonFields.map(x => x.id).concat(cat ? cat.fields.map(x => x.id) : [].concat(...draft.categories.map(c => c.fields.map(x => x.id)))));
        while (used.has(id)) id = base + '_' + (++n);
        fields.push({ id, label: 'New field', type: 'text', required: false });
        openField = id; markDirty(); draw();
      } }));
  }

  function fieldRow(f, i, fields, draw) {
    const sys = isSystem(f), saved = isSaved(f), open = openField === f.id;
    const tags = [h('span', { class: 'tag', text: TYPE_LABELS[f.type] || f.type })];
    if (f.required) tags.push(h('span', { class: 'tag tag-req', text: 'Required' }));
    if (f.showIf && f.showIf.field) tags.push(h('span', { class: 'tag tag-cond', text: 'Only if ' + f.showIf.field + ' = ' + f.showIf.equals }));
    if (sys) tags.push(h('span', { class: 'tag tag-sys', text: 'System' }));
    const row = h('div', { class: 'field-row' + (open ? ' open' : '') },
      h('div', { class: 'field-row-head' },
        h('div', { class: 'nav-move' },
          h('button', { class: 'icon-btn sm', text: '↑', attrs: { 'aria-label': 'Move up' }, disabled: i === 0, onclick: () => { move(fields, i, -1); markDirty(); draw(); } }),
          h('button', { class: 'icon-btn sm', text: '↓', attrs: { 'aria-label': 'Move down' }, disabled: i === fields.length - 1, onclick: () => { move(fields, i, 1); markDirty(); draw(); } })),
        h('button', { class: 'field-row-title', onclick: () => { openField = open ? null : f.id; draw(); } },
          h('div', { class: 'strong js-flabel', text: f.label }), h('div', { class: 'muted small mono js-fid', text: f.id }), h('div', { class: 'tags' }, tags)),
        h('button', { class: 'btn btn-ghost btn-sm', text: open ? 'Close' : 'Edit', onclick: () => { openField = open ? null : f.id; draw(); } }),
        h('button', { class: 'btn btn-danger-ghost btn-sm', text: 'Delete', disabled: sys, attrs: { title: sys ? 'System field — cannot be deleted' : '' },
          onclick: async () => {
            if (!(await confirmBox('Delete field?', 'Remove “' + f.label + '”? Answers already submitted are kept in the database and in CSV exports.', 'Delete', true))) return;
            fields.splice(i, 1); markDirty(); draw();
          } })),
      open ? fieldEditor(f, i, fields, sys, saved, draw) : null);
    return row;
  }

  function fieldEditor(f, i, fields, sys, saved, draw) {
    const set = (k, v) => { if (v === '' || v === undefined) delete f[k]; else f[k] = v; markDirty(); };
    const g = h('div', { class: 'form-grid field-editor' });
    const idInp = h('input', { type: 'text', value: f.id, disabled: saved, maxLength: 40, onchange: (e) => { f.id = uniqueId(slug(e.target.value), fields, f); openField = f.id; markDirty(); draw(); } });
    appendTo(g, 
      fld('Label (question shown to students)', h('input', { type: 'text', value: f.label, maxLength: 120,
        oninput: (e) => {
          f.label = e.target.value;
          if (!saved) { f.id = uniqueId(slug(e.target.value), fields, f); openField = f.id; idInp.value = f.id; }
          const row = e.target.closest('.field-row');
          row.querySelector('.js-flabel').textContent = f.label; row.querySelector('.js-fid').textContent = f.id;
          markDirty();
        } })),
      fld('Field id', idInp, saved ? 'Locked: existing answers are stored under this id.' : 'Generated from the label.'),
      fld('Answer type', h('select', { disabled: sys, onchange: (e) => { f.type = e.target.value; if ((f.type === 'select' || f.type === 'radio') && !f.options) f.options = ['Option 1', 'Option 2']; markDirty(); draw(); } },
        ctx.fieldTypes.map(t => h('option', { value: t, text: TYPE_LABELS[t] || t, selected: t === f.type })))),
      fld('Required?', h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!f.required, onchange: (e) => { f.required = e.target.checked; markDirty(); draw(); } }), h('span', { text: f.required ? 'Required' : 'Optional' }))),
      fld('Help text (optional)', h('input', { type: 'text', value: f.help || '', maxLength: 300, oninput: (e) => set('help', e.target.value) }), null, true));
    if (['text', 'textarea', 'url', 'number'].includes(f.type)) appendTo(g, fld('Placeholder (optional)', h('input', { type: 'text', value: f.placeholder || '', maxLength: 120, oninput: (e) => set('placeholder', e.target.value) })));
    if (f.type === 'text' || f.type === 'textarea') appendTo(g, fld('Max characters', h('input', { type: 'number', min: 10, value: f.maxLength || '', placeholder: f.type === 'text' ? '300' : '5000', oninput: (e) => set('maxLength', e.target.value ? Number(e.target.value) : '') })));
    if (f.type === 'number') appendTo(g, 
      fld('Minimum', h('input', { type: 'number', value: f.min ?? '', oninput: (e) => set('min', e.target.value === '' ? '' : Number(e.target.value)) })),
      fld('Maximum', h('input', { type: 'number', value: f.max ?? '', oninput: (e) => set('max', e.target.value === '' ? '' : Number(e.target.value)) })));
    if (f.type === 'select' || f.type === 'radio') appendTo(g, fld('Options (one per line)',
      h('textarea', { rows: Math.min(10, Math.max(3, (f.options || []).length + 1)), value: (f.options || []).join('\n'),
        oninput: (e) => { f.options = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); markDirty(); } }), null, true));
    if (f.type === 'faculty') appendTo(g, fld('Allow “Other (not in list)”?', h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked: !!f.allowOther, onchange: (e) => { f.allowOther = e.target.checked; markDirty(); } }), h('span', { text: 'Students may type a name not in the faculty list' }))));

    // Conditional display: only fields placed above this one are valid targets
    const above = (selSection === '__common__' ? [] : draft.commonFields).concat(fields.slice(0, i)).filter(x => x.type !== 'file');
    const target = above.find(x => f.showIf && x.id === f.showIf.field);
    const valInput = target && (target.options || target.type === 'department')
      ? h('select', { onchange: (e) => { f.showIf.equals = e.target.value; markDirty(); draw(); } },
          (target.type === 'department' ? ctx.departments : target.options).map(o => h('option', { value: o, text: o, selected: f.showIf && f.showIf.equals === o })))
      : h('input', { type: 'text', value: f.showIf ? f.showIf.equals : '', disabled: !f.showIf, placeholder: 'value', oninput: (e) => { f.showIf.equals = e.target.value; markDirty(); } });
    appendTo(g, fld('Show this field only when…', h('div', { class: 'inline' },
      h('select', { onchange: (e) => {
        const t = above.find(x => x.id === e.target.value);
        if (!t) delete f.showIf; else f.showIf = { field: t.id, equals: (t.options && t.options[0]) || (t.type === 'department' ? ctx.departments[0] : '') };
        markDirty(); draw();
      } }, h('option', { value: '', text: 'Always show' }), above.map(x => h('option', { value: x.id, text: x.label, selected: f.showIf && f.showIf.field === x.id }))),
      f.showIf ? h('span', { text: ' equals ' }) : null, f.showIf ? valInput : null), 'Example: show “Stipend” only when “Paid or Unpaid” = Paid.', true));
    return g;
  }
  function uniqueId(base, fields, self) {
    const used = new Set(draft.commonFields.concat(...draft.categories.map(c => c.fields)).filter(x => x !== self).map(x => x.id));
    let id = base, n = 1; while (used.has(id)) id = base + '_' + (++n); return id;
  }
  function fld(label, control, help, wide) {
    return h('label', { class: 'field' + (wide ? ' span-2' : '') }, h('span', { class: 'field-label', text: label }), control, help ? h('span', { class: 'help', text: help }) : null);
  }

  function addCategory(draw) {
    let id = 'new_type', n = 1;
    while (draft.categories.some(c => c.id === id)) id = 'new_type_' + (++n);
    draft.categories.push({ id, label: 'New project type', fields: [] });
    selSection = id; markDirty(); draw();
  }

  function preview() {
    const body = h('div');
    const sel = h('select', { class: 'big-select' }, draft.categories.map(c => h('option', { value: c.id, text: c.label })));
    const host = h('div');
    const draw = () => { clear(host); host.appendChild(FormKit.build(draft, ctx, sel.value, {}).el); };
    sel.addEventListener('change', draw);
    appendTo(body, h('div', { class: 'banner banner-info', text: 'Preview of the unsaved form. Nothing is submitted.' }), h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Project type' }), sel), host);
    draw();
    openModal('Student form preview', body, { wide: true });
  }

  async function saveForm(draw) {
    try {
      const saved = await withBusy('Saving form…', () => api('super.saveForm', { form: draft }));
      ctx.form = saved; resetDraft(); draw();
      toast('Form saved (version ' + saved.version + '). Students see it on their next page load.');
    } catch (e) { toastError(e); }
  }
  async function restoreDefault() {
    if (!(await confirmBox('Restore the default form?', 'This replaces the current form with the original default fields. Existing records are not changed.', 'Restore', true))) return;
    try { ctx.form = await withBusy('Restoring…', () => api('super.resetForm')); resetDraft(); hooks && AdminView.rerender(); toast('Default form restored'); } catch (e) { toastError(e); }
  }

  /* =================== FACULTY =================== */
  async function renderFaculty(panel) {
    const host = h('div'); panel.appendChild(host);
    if (!faculty) {
      host.appendChild(h('div', { class: 'center-pad' }, h('div', { class: 'spinner' })));
      try { faculty = await api('super.faculty'); facDirty = false; } catch (e) { toastError(e); return; }
    }
    const draw = () => {
      clear(host);
      const q = facFilter.q.toLowerCase();
      const shown = faculty.filter(f => (!facFilter.dept || f.department === facFilter.dept) && (!q || (f.name + ' ' + f.designation + ' ' + f.email).toLowerCase().includes(q)));
      const counts = {}; faculty.forEach(f => counts[f.department] = (counts[f.department] || 0) + 1);
      appendTo(host, 
        h('div', { class: 'toolbar sticky-bar' },
          h('div', {}, h('strong', { text: faculty.length + ' faculty' }), facDirty ? h('span', { class: 'pill pill-warn', text: '● Unsaved changes' }) : null),
          h('div', { class: 'toolbar-right' },
            h('button', { class: 'btn btn-ghost btn-sm', text: 'Bulk import (paste from Excel)', onclick: () => bulkImport(draw) }),
            h('button', { class: 'btn btn-ghost btn-sm', text: 'Download CSV', onclick: () => downloadText('faculty_list.csv', toCSV([['Department', 'Name', 'Designation', 'Email', 'Active']].concat(faculty.map(f => [f.department, f.name, f.designation, f.email, f.active ? 'Yes' : 'No'])))) }),
            h('button', { class: 'btn btn-secondary btn-sm', text: '+ Add faculty', onclick: () => { faculty.unshift({ department: facFilter.dept || ctx.departments[0], name: '', designation: 'Assistant Professor', email: '', active: true }); facDirty = true; draw(); host.querySelector('tbody input[type=text]')?.focus(); } }),
            h('button', { class: 'btn btn-primary btn-sm', text: 'Save faculty list', disabled: !facDirty, onclick: async () => {
              try {
                const saved = await withBusy('Saving faculty…', () => api('super.saveFaculty', { faculty: faculty.filter(f => f.name.trim()) }));
                faculty = saved; facDirty = false;
                ctx.faculty = saved.filter(f => f.active).map(f => ({ department: f.department, name: f.name, designation: f.designation }));
                draw(); toast('Faculty list saved (' + saved.length + ')');
              } catch (e) { toastError(e); }
            } }))),
        h('div', { class: 'chips' }, h('button', { class: 'chip' + (!facFilter.dept ? ' active' : ''), text: 'All (' + faculty.length + ')', onclick: () => { facFilter.dept = ''; draw(); } }),
          ctx.departments.map(d => h('button', { class: 'chip' + (facFilter.dept === d ? ' active' : ''), text: d + ' (' + (counts[d] || 0) + ')', onclick: () => { facFilter.dept = d; draw(); } }))),
        h('input', { type: 'search', class: 'search-wide', placeholder: 'Search faculty…', value: facFilter.q, oninput: (e) => { facFilter.q = e.target.value; const pos = e.target.selectionStart; draw(); const s = host.querySelector('.search-wide'); s.focus(); s.setSelectionRange(pos, pos); } }),
        shown.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table edit-table' },
          h('thead', {}, h('tr', {}, ['Department', 'Name', 'Designation', 'E-mail (optional)', 'Active', ''].map(t => h('th', { text: t })))),
          h('tbody', {}, shown.map(f => h('tr', {},
            h('td', {}, h('select', { onchange: (e) => { f.department = e.target.value; facDirty = true; draw(); } }, ctx.departments.map(d => h('option', { value: d, text: d, selected: d === f.department })))),
            h('td', {}, h('input', { type: 'text', value: f.name, maxLength: 120, placeholder: 'Dr. Full Name', oninput: (e) => { f.name = e.target.value; facDirty = true; } })),
            h('td', {}, h('input', { type: 'text', value: f.designation, maxLength: 80, oninput: (e) => { f.designation = e.target.value; facDirty = true; } })),
            h('td', {}, h('input', { type: 'email', value: f.email, maxLength: 120, oninput: (e) => { f.email = e.target.value; facDirty = true; } })),
            h('td', { class: 'center' }, h('input', { type: 'checkbox', checked: f.active, attrs: { 'aria-label': 'Active' }, onchange: (e) => { f.active = e.target.checked; facDirty = true; } })),
            h('td', {}, h('button', { class: 'icon-btn', text: '🗑', attrs: { 'aria-label': 'Remove ' + f.name }, onclick: () => { faculty.splice(faculty.indexOf(f), 1); facDirty = true; draw(); } }))))))) :
          emptyState('No faculty yet', 'Add faculty one by one, or paste the department-wise list from Excel using “Bulk import”.'));
    };
    draw();
  }

  function bulkImport(draw) {
    const ta = h('textarea', { rows: 12, placeholder: 'Department<TAB>Name<TAB>Designation<TAB>Email\nCSE\tDr. A. Kumar\tAssistant Professor\takumar@rguktong.ac.in\nCIVIL, Dr. B. Rao, Associate Professor' });
    const mode = h('select', {}, h('option', { value: 'append', text: 'Add to the existing list' }), h('option', { value: 'replace', text: 'Replace the whole list' }));
    const out = h('div', { class: 'small' });
    const parse = () => {
      const rows = [], errs = [];
      ta.value.split(/\r?\n/).forEach((line, n) => {
        if (!line.trim()) return;
        const parts = (line.includes('\t') ? line.split('\t') : line.split(',')).map(s => s.trim());
        if (n === 0 && /department/i.test(parts[0])) return;
        const dept = (parts[0] || '').toUpperCase();
        if (!ctx.departments.includes(dept)) { errs.push('Line ' + (n + 1) + ': unknown department "' + parts[0] + '"'); return; }
        if (!parts[1]) { errs.push('Line ' + (n + 1) + ': name missing'); return; }
        rows.push({ department: dept, name: parts[1], designation: parts[2] || '', email: (parts[3] || '').toLowerCase(), active: true });
      });
      return { rows, errs };
    };
    ta.addEventListener('input', () => { const p = parse(); clear(out); appendTo(out, h('div', { text: p.rows.length + ' valid rows' }), p.errs.slice(0, 8).map(e => h('div', { class: 'field-error', text: e }))); });
    openModal('Bulk import faculty', h('div', {},
      h('p', { class: 'muted', text: 'Copy the columns Department, Name, Designation, Email from Excel and paste below (comma-separated also works). Departments must be one of: ' + ctx.departments.join(', ') + '.' }),
      ta, h('div', { class: 'inline mt' }, h('span', { text: 'Mode: ' }), mode), out), {
      wide: true, actions: [
        { label: 'Cancel', class: 'btn-ghost', onClick: (c) => c() },
        { label: 'Import', class: 'btn-primary', onClick: (c) => {
          const p = parse();
          if (!p.rows.length) { toast('Nothing valid to import', 'warn'); return; }
          if (mode.value === 'replace') faculty = [];
          const key = (f) => f.department + '|' + f.name.toLowerCase();
          const have = new Set(faculty.map(key));
          let added = 0;
          p.rows.forEach(r => { if (!have.has(key(r))) { faculty.push(r); have.add(key(r)); added++; } });
          facDirty = true; c(); draw();
          toast(added + ' faculty imported' + (p.errs.length ? ', ' + p.errs.length + ' lines skipped' : '') + '. Click “Save faculty list” to store.');
        } }]
    });
  }

  /* =================== USERS & ACCESS =================== */
  async function renderUsers(panel) {
    const host = h('div', {}, h('div', { class: 'center-pad' }, h('div', { class: 'spinner' })));
    panel.appendChild(host);
    let data;
    try { data = await api('super.users'); } catch (e) { toastError(e); return; }
    let admins = data.admins.slice(), q = '', roleF = '';
    const draw = () => {
      clear(host);
      const addInp = h('input', { type: 'email', placeholder: 'name@rguktong.ac.in', maxLength: 120, attrs: { 'aria-label': 'New administrator e-mail' } });
      const add = () => { const v = addInp.value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) { toast('Enter a valid e-mail', 'warn'); return; } if (v === data.superAdmin || admins.includes(v)) { toast('Already an administrator', 'warn'); return; } admins.push(v); draw(); };
      addInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      const users = data.users.filter(u => (!roleF || u.role === roleF) && (!q || (u.email + ' ' + u.name + ' ' + u.studentId).toLowerCase().includes(q)))
        .sort((a, b) => (b.lastLogin || '').localeCompare(a.lastLogin || ''));
      const changed = JSON.stringify(admins) !== JSON.stringify(data.admins);
      appendTo(host, 
        h('section', { class: 'card' },
          h('div', { class: 'card-head between' }, h('h3', { text: 'Administrators' }),
            h('button', { class: 'btn btn-primary btn-sm', text: 'Save administrators', disabled: !changed, onclick: async () => {
              try { const r = await withBusy('Saving…', () => api('super.saveAdmins', { admins })); data.admins = r.admins; admins = r.admins.slice(); draw(); toast('Administrators updated. Drive view access synced.'); } catch (e) { toastError(e); }
            } })),
          h('p', { class: 'muted small', text: 'Administrators see the dashboard and all records, verify submissions and get view-only access to uploaded files in Drive. Only the super administrator can change the form, faculty, users and settings. Use a college (rguktong.ac.in) or Gmail address: other personal Google accounts are refused at sign-in for safety.' }),
          h('div', { class: 'chips' },
            h('span', { class: 'chip chip-super' }, '★ ', data.superAdmin, h('span', { class: 'muted', text: ' (super admin, permanent)' })),
            admins.map(a => h('span', { class: 'chip chip-admin' }, a, h('button', { class: 'chip-x', text: '×', attrs: { 'aria-label': 'Remove ' + a }, onclick: () => { admins = admins.filter(x => x !== a); draw(); } })))),
          h('div', { class: 'inline mt' }, addInp, h('button', { class: 'btn btn-secondary btn-sm', text: 'Add administrator', onclick: add }))),
        h('section', { class: 'card' },
          h('div', { class: 'card-head between' }, h('h3', { text: 'Users who have signed in (' + data.users.length + ')' }),
            h('button', { class: 'btn btn-ghost btn-sm', text: 'Download CSV', onclick: () => downloadText('users.csv', toCSV([['Email', 'Name', 'StudentID', 'Batch', 'Role', 'FirstLogin', 'LastLogin', 'Logins', 'Blocked']].concat(data.users.map(u => [u.email, u.name, u.studentId, u.batch, u.role, u.firstLogin, u.lastLogin, u.loginCount, u.blocked ? 'Yes' : 'No'])))) })),
          h('div', { class: 'filter-bar' },
            h('label', { class: 'filter filter-grow' }, h('span', { text: 'Search' }), h('input', { type: 'search', value: q, placeholder: 'e-mail, name, ID', oninput: debounce((e) => { q = e.target.value.toLowerCase(); draw(); host.querySelector('input[type=search]').focus(); }, 250) })),
            h('label', { class: 'filter' }, h('span', { text: 'Role' }), h('select', { onchange: (e) => { roleF = e.target.value; draw(); } }, ['', 'student', 'admin', 'super'].map(r => h('option', { value: r, text: r || 'All', selected: r === roleF }))))),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
            h('thead', {}, h('tr', {}, ['E-mail', 'Name', 'Student ID', 'Batch', 'Role', 'Last sign-in', 'Sign-ins', 'Access'].map(t => h('th', { text: t })))),
            h('tbody', {}, users.slice(0, 500).map(u => h('tr', { class: u.blocked ? 'row-blocked' : '' },
              h('td', { text: u.email }), h('td', { text: u.name }), h('td', { class: 'mono', text: u.studentId }), h('td', { text: (u.batch || '').toUpperCase() }),
              h('td', {}, h('span', { class: 'tag', text: u.role })), h('td', { class: 'nowrap', text: fmtDateTime(u.lastLogin) }), h('td', { class: 'num', text: String(u.loginCount) }),
              h('td', {}, u.role === 'student' ? h('button', { class: 'btn btn-sm ' + (u.blocked ? 'btn-secondary' : 'btn-danger-ghost'), text: u.blocked ? 'Unblock' : 'Block', onclick: () => toggleBlock(u, draw) }) : h('span', { class: 'muted', text: '—' })))))))));
    };
    draw();
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  async function toggleBlock(u, draw) {
    const block = !u.blocked;
    if (block && !(await confirmBox('Block ' + u.email + '?', 'The student will be signed out immediately and cannot sign in or submit until unblocked. Their records are kept.', 'Block', true))) return;
    try { await withBusy('Updating…', () => api('super.setBlocked', { email: u.email, blocked: block })); u.blocked = block; draw(); toast(u.email + (block ? ' blocked' : ' unblocked')); } catch (e) { toastError(e); }
  }

  /* =================== SETTINGS & DRIVE =================== */
  async function renderSettings(panel) {
    const host = h('div', {}, h('div', { class: 'center-pad' }, h('div', { class: 'spinner' })));
    panel.appendChild(host);
    let s;
    try { s = await api('super.settings'); } catch (e) { toastError(e); return; }
    const draw = () => {
      clear(host);
      const open = h('input', { type: 'checkbox', checked: s.submissionsOpen });
      const mb = h('input', { type: 'number', min: 1, max: 25, value: s.maxFileMB });
      const depts = h('textarea', { rows: 8, value: s.departments.join('\n') });
      const pat = h('input', { type: 'text', value: s.studentPattern, class: 'mono' });
      const batchInp = h('input', { type: 'text', placeholder: 'o26', maxLength: 3, class: 'mono short' });
      const folders = Object.entries(s.batchFolders || {}).sort();
      appendTo(host, 
        h('div', { class: 'settings-grid' },
          h('section', { class: 'card' },
            h('h3', { text: 'Submissions' }),
            h('label', { class: 'switch big' }, open, h('span', { text: 'Accept new submissions and edits from students' })),
            fld('Maximum upload size (MB, 1–25)', mb),
            fld('Departments (one code per line)', depts, 'Used for the student’s department, faculty list and dashboard. Removing a code does not change existing records.'),
            h('details', { class: 'mt' }, h('summary', { text: 'Advanced: student e-mail pattern' }),
              fld('Regular expression', pat, 'Default ^o\\d{6,7}@rguktong\\.ac\\.in$ (o + 6 or 7 digits, e.g. o212343 or o2123231). The first three characters of the ID (o21) become the batch folder. Students must also be signed in to a Google Workspace account on rguktong.ac.in.')),
            h('div', { class: 'row-end' }, h('button', { class: 'btn btn-primary', text: 'Save settings', onclick: async () => {
              try {
                s = await withBusy('Saving…', () => api('super.saveSettings', { submissionsOpen: open.checked, maxFileMB: Number(mb.value), departments: depts.value.split('\n'), studentPattern: pat.value }));
                ctx.departments = s.departments; ctx.maxFileMB = s.maxFileMB; ctx.submissionsOpen = s.submissionsOpen;
                draw(); toast('Settings saved');
              } catch (e) { toastError(e); }
            } }))),
          h('section', { class: 'card' },
            h('h3', { text: 'Google Drive storage (dataongole@gmail.com)' }),
            h('ul', { class: 'link-list' },
              h('li', {}, h('a', { href: s.rootFolderUrl, target: '_blank', rel: 'noopener noreferrer', text: '📁 Root folder: RGUKT Ongole Project Database' })),
              h('li', {}, h('a', { href: s.databaseUrl, target: '_blank', rel: 'noopener noreferrer', text: '📊 Database spreadsheet (Projects, Users, Faculty, Settings, Audit)' }))),
            h('h4', { class: 'section-title', text: 'Batch folders' }),
            h('p', { class: 'muted small', text: 'A folder is created automatically the first time a student of a new batch signs in. Each student gets a sub-folder for uploads.' }),
            h('div', { class: 'chips' }, folders.map(([b, id]) => h('a', { class: 'chip', href: 'https://drive.google.com/drive/folders/' + encodeURIComponent(id), target: '_blank', rel: 'noopener noreferrer', text: '📁 ' + b }))),
            h('div', { class: 'inline mt' }, batchInp, h('button', { class: 'btn btn-secondary btn-sm', text: 'Create batch folder', onclick: async () => {
              const b = batchInp.value.trim().toLowerCase();
              if (!/^[a-z]\d{2}$/.test(b)) { toast('Batch code must look like o26', 'warn'); return; }
              try { const r = await withBusy('Creating…', () => api('super.createFolders', { batches: [b] })); s.batchFolders = r.batchFolders; draw(); toast('Folder ' + b + ' ready'); } catch (e) { toastError(e); }
            } })))));
    };
    draw();
  }

  /* =================== AUDIT =================== */
  async function renderAudit(panel) {
    const host = h('div', {}, h('div', { class: 'center-pad' }, h('div', { class: 'spinner' })));
    panel.appendChild(host);
    let rows;
    try { rows = await api('super.audit'); } catch (e) { toastError(e); return; }
    let q = '';
    const draw = () => {
      clear(host);
      const shown = rows.filter(r => !q || (r.email + ' ' + r.action + ' ' + r.details).toLowerCase().includes(q));
      appendTo(host, 
        h('div', { class: 'toolbar' }, h('span', { class: 'muted', text: 'Latest ' + rows.length + ' events (full history is in the Audit sheet)' }),
          h('input', { type: 'search', placeholder: 'Filter…', value: q, oninput: (e) => { q = e.target.value.toLowerCase(); draw(); const s = host.querySelector('input[type=search]'); s.focus(); } })),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, ['Time', 'User', 'Role', 'Action', 'Details'].map(t => h('th', { text: t })))),
          h('tbody', {}, shown.map(r => h('tr', {}, h('td', { class: 'nowrap', text: fmtDateTime(r.time) }), h('td', { text: r.email }), h('td', { text: r.role }),
            h('td', {}, h('span', { class: 'tag' + (/denied|blocked|purge|delete/.test(r.action) ? ' tag-req' : ''), text: r.action })), h('td', { text: r.details })))))));
    };
    draw();
  }

  return { tabs, render };
})();
