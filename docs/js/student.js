/* Student view: submit work and manage own submissions. */
'use strict';

const StudentView = (() => {
  let ctx, root, tab = 'new', records = [], editing = null;

  async function mount(container, context) {
    ctx = context; root = container;
    await loadRecords();
    tab = records.length ? 'mine' : 'new';
    render();
  }

  async function loadRecords() {
    records = await api('student.list');
  }

  function render() {
    clear(root);
    const u = ctx.user;
    appendTo(root, 
      h('section', { class: 'hero' },
        h('div', {},
          h('h1', { text: 'Welcome, ' + (u.name || u.studentId) }),
          h('p', { class: 'muted' }, 'ID ', h('strong', { text: u.studentId }), ' · Batch ', h('strong', { text: u.batch.toUpperCase() }),
            ' · Record every minor project, major project, internship and other activity here.')),
        h('div', { class: 'hero-stats' },
          stat(records.length, 'Submissions'),
          stat(records.filter(r => r.status === 'Verified').length, 'Verified'),
          stat(records.filter(r => r.status === 'Needs Correction').length, 'Need correction'))),
      !ctx.submissionsOpen ? h('div', { class: 'banner banner-warn', text: 'Submissions are currently closed by the administration. You can still view your records.' }) : null,
      tabBar([
        { id: 'new', label: editing ? 'Edit Submission' : 'New Submission' },
        { id: 'mine', label: 'My Submissions', badge: records.length }
      ], tab, (t) => { if (t === 'new' && tab !== 'new') editing = null; tab = t; render(); }),
      h('div', { class: 'tab-panel' }, tab === 'new' ? renderForm() : renderList()));
  }

  function stat(n, label) { return h('div', { class: 'hero-stat' }, h('div', { class: 'hero-num', text: String(n) }), h('div', { class: 'hero-lab', text: label })); }

  function renderForm() {
    const form = ctx.form;
    const wrap = h('div', { class: 'form-wrap' });
    let built = null;
    const catSel = h('select', { id: 'category', class: 'big-select' },
      h('option', { value: '', text: '— Select type of work —' }),
      form.categories.map(c => h('option', { value: c.id, text: c.label, selected: editing && editing.category === c.id })));
    const body = h('div');
    const submitBtn = h('button', { class: 'btn btn-primary btn-lg', text: editing ? 'Save Changes' : 'Submit', disabled: !ctx.submissionsOpen });

    const draw = () => {
      clear(body);
      built = null;
      if (!catSel.value) { body.appendChild(h('p', { class: 'muted center', text: 'Choose the type of work to see the relevant details form.' })); submitBtn.hidden = true; return; }
      const init = editing || {};   // common answers carry over if the type is changed while editing
      built = FormKit.build(form, ctx, catSel.value, init);
      body.appendChild(built.el);
      submitBtn.hidden = false;
    };
    catSel.addEventListener('change', draw);

    submitBtn.addEventListener('click', async () => {
      if (!built) return;
      const res = built.collect();
      if (!res.ok) { toast('Please fill the highlighted fields.', 'warn'); return; }
      try {
        await withBusy('Uploading and saving…', async () => {
          const files = [];
          for (const [fieldId, file] of Object.entries(res.files)) {
            files.push({ fieldId, name: file.name, mimeType: file.type || 'application/octet-stream', base64: await fileToBase64(file) });
          }
          await api('student.save', { id: editing ? editing.id : undefined, category: catSel.value, data: res.data, files });
        });
        toast(editing ? 'Changes saved.' : 'Submitted successfully. Thank you!', 'ok');
        editing = null;
        await loadRecords();
        tab = 'mine';
        render();
      } catch (e) { toastError(e); }
    });

    appendTo(wrap, 
      h('section', { class: 'card form-card' },
        h('div', { class: 'card-head' }, h('span', { class: 'step', text: '1' }), h('h3', { text: 'Type of work' })),
        h('div', { class: 'field' }, h('label', { class: 'field-label', attrs: { for: 'category' } }, 'Project type', h('span', { class: 'req', text: ' *' })), catSel),
        editing ? h('p', { class: 'muted small' }, 'Editing ', h('strong', { text: editing.id }), '. Saving will send it again for verification.') : null),
      body,
      h('div', { class: 'form-actions' },
        editing ? h('button', { class: 'btn btn-ghost', text: 'Cancel edit', onclick: () => { editing = null; tab = 'mine'; render(); } }) : null,
        submitBtn));
    draw();
    return wrap;
  }

  function renderList() {
    if (!records.length) return emptyState('No submissions yet', 'Use “New Submission” to record your first project or internship.');
    return h('div', { class: 'cards-list' }, records.map(r => {
      const canEdit = ctx.submissionsOpen && (r.status === 'Submitted' || r.status === 'Needs Correction');
      const canDelete = r.status !== 'Verified';
      const sub = subtitleFor(r);
      return h('article', { class: 'rec-card' + (r.status === 'Needs Correction' ? ' rec-attn' : '') },
        h('div', { class: 'rec-top' },
          h('span', { class: 'cat-tag cat-' + r.category, text: FormKit.categoryLabel(ctx.form, r.category) }),
          statusPill(r.status)),
        h('h3', { class: 'rec-title', text: r.title || '(untitled)' }),
        sub ? h('div', { class: 'muted', text: sub }) : null,
        h('div', { class: 'rec-meta' }, h('span', { text: r.id }), h('span', { text: 'Submitted ' + fmtDate(r.submittedAt) }),
          r.updatedAt !== r.submittedAt ? h('span', { text: 'Updated ' + fmtDate(r.updatedAt) }) : null),
        r.remark ? h('div', { class: 'remark' }, h('strong', { text: 'Remark from office: ' }), h('span', { text: r.remark })) : null,
        h('div', { class: 'rec-actions' },
          h('button', { class: 'btn btn-ghost btn-sm', text: 'View', onclick: () => openModal(r.title, FormKit.details(ctx.form, r), { wide: true }) }),
          canEdit ? h('button', { class: 'btn btn-secondary btn-sm', text: 'Edit', onclick: () => { editing = r; tab = 'new'; render(); window.scrollTo(0, 0); } }) : null,
          canDelete ? h('button', { class: 'btn btn-danger-ghost btn-sm', text: 'Delete', onclick: () => del(r) }) : null));
    }));
  }

  function subtitleFor(r) {
    const d = r.data || {};
    if (r.category === 'internship') return [d.company, d.location, d.paid].filter(Boolean).join(' · ');
    if (d.guide && d.guide.name) return 'Guide: ' + d.guide.name + ' (' + d.guide.department + ')';
    return [d.organisation, d.other_type].filter(Boolean).join(' · ');
  }

  async function del(r) {
    if (!(await confirmBox('Delete submission?', 'Delete “' + r.title + '” (' + r.id + ')? This cannot be undone by you.', 'Delete', true))) return;
    try {
      await withBusy('Deleting…', () => api('student.delete', { id: r.id }));
      toast('Submission deleted.');
      await loadRecords(); render();
    } catch (e) { toastError(e); }
  }

  return { mount };
})();
