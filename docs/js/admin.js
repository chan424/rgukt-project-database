/* Admin view: dashboard analytics and records review. Super-admin tabs are added by SuperView. */
'use strict';

const AdminView = (() => {
  // Categorical palette (validated for colour-vision deficiency, fixed order: colour follows the entity)
  const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const OTHER_GREY = '#8a8984';
  let ctx, root, tab = 'dashboard', records = [], loadedAt = null, charts = [];
  const filters = { batch: '', department: '', category: '', academicYear: '', status: '', q: '' };
  let page = 0;
  const PAGE = 50;

  function setupCharts() {
    if (!window.Chart || setupCharts.done) return;
    setupCharts.done = true;
    Chart.defaults.font.family = '"Times New Roman", Times, serif';
    Chart.defaults.font.size = 13;
    Chart.defaults.color = '#000000';
    Chart.defaults.borderColor = '#e4e3df';
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.legend.labels.boxHeight = 12;
    Chart.defaults.plugins.tooltip.titleFont = { family: '"Times New Roman", Times, serif', size: 13, weight: 'bold' };
    Chart.defaults.plugins.tooltip.bodyFont = { family: '"Times New Roman", Times, serif', size: 13 };
    Chart.defaults.maintainAspectRatio = false;
    // White background so downloaded PNGs are report-ready
    Chart.register({ id: 'whiteBg', beforeDraw(c) { const g = c.ctx; g.save(); g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.restore(); } });
  }

  async function mount(container, context) {
    ctx = context; root = container;
    setupCharts();
    await load();
    render();
  }

  async function load() {
    const res = await api('admin.records');
    records = res.records; loadedAt = res.generatedAt;
  }

  function tabs() {
    const t = [{ id: 'dashboard', label: 'Dashboard' }, { id: 'records', label: 'Records', badge: records.length }];
    if (ctx.user.role === 'super') t.push(...SuperView.tabs());
    return t;
  }

  function render() {
    charts.forEach(c => c.destroy()); charts = [];
    clear(root);
    appendTo(root, 
      h('section', { class: 'hero hero-admin' },
        h('div', {},
          h('h1', { text: ctx.user.role === 'super' ? 'Super Administrator Console' : 'Administrator Dashboard' }),
          h('p', { class: 'muted' }, 'Signed in as ', h('strong', { text: ctx.user.email }),
            loadedAt ? ' · Data as of ' + fmtDateTime(loadedAt) : '')),
        h('div', { class: 'hero-actions' },
          h('button', { class: 'btn btn-secondary', text: '↻ Refresh data', onclick: async () => { try { await withBusy('Loading…', load); render(); toast('Data refreshed'); } catch (e) { toastError(e); } } }))),
      tabBar(tabs(), tab, (t) => { tab = t; render(); }));
    const panel = h('div', { class: 'tab-panel' });
    root.appendChild(panel);
    if (tab === 'dashboard') renderDashboard(panel);
    else if (tab === 'records') renderRecords(panel);
    else SuperView.render(tab, panel, ctx, { reloadRecords: async () => { await load(); } });
  }

  /* ---------------- Filters ---------------- */
  function filtered(ignoreSearch) {
    const q = filters.q.trim().toLowerCase();
    return records.filter(r =>
      (!filters.batch || r.batch === filters.batch) &&
      (!filters.department || r.department === filters.department) &&
      (!filters.category || r.category === filters.category) &&
      (!filters.academicYear || r.academicYear === filters.academicYear) &&
      (!filters.status || r.status === filters.status) &&
      (ignoreSearch || !q || searchText(r).includes(q)));
  }
  function searchText(r) {
    if (!r._s) r._s = [r.id, r.studentId, r.studentName, r.email, r.title, r.department, JSON.stringify(r.data)].join(' ').toLowerCase();
    return r._s;
  }

  function filterBar(onChange, withSearch) {
    const mk = (key, label, opts, fmt) => h('label', { class: 'filter' }, h('span', { text: label }),
      h('select', { onchange: (e) => { filters[key] = e.target.value; page = 0; onChange(); } },
        h('option', { value: '', text: 'All' }),
        opts.map(o => h('option', { value: o, text: fmt ? fmt(o) : o, selected: filters[key] === o }))));
    const any = Object.entries(filters).some(([k, v]) => v && (withSearch || k !== 'q'));
    return h('div', { class: 'filter-bar' },
      mk('batch', 'Batch', uniqSorted(records.map(r => r.batch)), b => b.toUpperCase()),
      mk('department', 'Department', uniqSorted(ctx.departments.concat(records.map(r => r.department)))),
      mk('category', 'Type', ctx.form.categories.map(c => c.id), id => FormKit.categoryLabel(ctx.form, id)),
      mk('academicYear', 'Academic year', uniqSorted(records.map(r => r.academicYear))),
      mk('status', 'Status', ctx.statuses),
      withSearch ? h('label', { class: 'filter filter-grow' }, h('span', { text: 'Search' }),
        h('input', { type: 'search', placeholder: 'ID, name, title, company, faculty…', value: filters.q,
          oninput: debounce((e) => { filters.q = e.target.value; page = 0; onChange(true); }, 250) })) : null,
      any ? h('button', { class: 'btn btn-ghost btn-sm filter-reset', text: 'Clear filters', onclick: () => { Object.keys(filters).forEach(k => filters[k] = ''); page = 0; render(); } }) : null);
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  /* ---------------- Dashboard ---------------- */
  function countBy(list, keyFn) {
    const m = new Map();
    list.forEach(r => { const k = keyFn(r); if (k === undefined || k === null || k === '') return; m.set(k, (m.get(k) || 0) + 1); });
    return m;
  }
  /** Groups free-text values case-insensitively, keeping the first spelling seen. */
  function countText(list, getter) {
    const m = new Map(), names = new Map();
    list.forEach(r => {
      const raw = String(getter(r) || '').trim().replace(/\s+/g, ' ');
      if (!raw) return;
      const k = raw.toLowerCase();
      if (!names.has(k)) names.set(k, raw);
      m.set(k, (m.get(k) || 0) + 1);
    });
    return [...m.entries()].map(([k, n]) => [names.get(k), n]).sort((a, b) => b[1] - a[1]);
  }
  function topN(entries, n) {
    if (entries.length <= n) return entries;
    const head = entries.slice(0, n), rest = entries.slice(n).reduce((s, e) => s + e[1], 0);
    return head.concat([['Others (' + (entries.length - n) + ')', rest]]);
  }
  const catColor = (id) => { const i = ctx.form.categories.findIndex(c => c.id === id); return i >= 0 && i < PALETTE.length ? PALETTE[i] : OTHER_GREY; };

  function renderDashboard(panel) {
    const list = filtered(true);
    const cats = ctx.form.categories;
    const interns = list.filter(r => r.category === 'internship');
    const paid = interns.filter(r => r.data.paid === 'Paid');
    const stipends = paid.map(r => Number(r.data.stipend)).filter(n => isFinite(n) && n > 0);
    const guides = new Set();
    list.forEach(r => ['guide', 'co_guide'].forEach(k => { const g = r.data[k]; if (g && g.name) guides.add(g.department + '|' + g.name); }));

    appendTo(panel, filterBar(() => { render(); }, false));

    if (!list.length) { panel.appendChild(emptyState('No records match these filters', records.length ? 'Try clearing the filters.' : 'Records will appear here as students submit them.')); return; }

    panel.appendChild(h('div', { class: 'kpis' },
      kpi(list.length, 'Total records'),
      kpi(new Set(list.map(r => r.email)).size, 'Students'),
      cats.map(c => kpi(list.filter(r => r.category === c.id).length, c.label, catColor(c.id))),
      kpi(interns.length ? Math.round(100 * paid.length / interns.length) + '%' : '—', 'Paid internships'),
      kpi(stipends.length ? fmtINR(stipends.reduce((a, b) => a + b, 0) / stipends.length) : '—', 'Avg. stipend / month'),
      kpi(guides.size, 'Faculty guides'),
      kpi(list.filter(r => r.status === 'Submitted').length, 'Pending verification')));

    const grid = h('div', { class: 'chart-grid' });
    panel.appendChild(grid);

    // 1. Records by type
    const byCat = cats.map(c => list.filter(r => r.category === c.id).length);
    addChart(grid, 'Records by type of work', 'All selected records', {
      type: 'bar',
      data: { labels: cats.map(c => c.label), datasets: [{ label: 'Records', data: byCat, backgroundColor: cats.map(c => catColor(c.id)) }] },
      options: barOpts({ legend: false })
    });

    // 2. Department-wise by type (stacked)
    const depts = uniqSorted(list.map(r => r.department));
    addChart(grid, 'Department-wise records by type', 'Student’s department', {
      type: 'bar',
      data: { labels: depts, datasets: cats.map(c => ({ label: c.label, data: depts.map(d => list.filter(r => r.department === d && r.category === c.id).length), backgroundColor: catColor(c.id) })) },
      options: barOpts({ stacked: true })
    }, { wide: true });

    // 3. Batch-wise by type (stacked)
    const batches = uniqSorted(list.map(r => r.batch));
    addChart(grid, 'Batch-wise records by type', 'Batch from student ID (o20, o21, …)', {
      type: 'bar',
      data: { labels: batches.map(b => b.toUpperCase()), datasets: cats.map(c => ({ label: c.label, data: batches.map(b => list.filter(r => r.batch === b && r.category === c.id).length), backgroundColor: catColor(c.id) })) },
      options: barOpts({ stacked: true })
    });

    // 4. Internships: paid vs unpaid
    if (interns.length) {
      const pu = ['Paid', 'Unpaid'].map(k => interns.filter(r => r.data.paid === k).length);
      addChart(grid, 'Internships: paid vs unpaid', interns.length + ' internships', {
        type: 'doughnut',
        data: { labels: ['Paid', 'Unpaid'], datasets: [{ data: pu, backgroundColor: [PALETTE[0], PALETTE[1]], borderColor: '#ffffff', borderWidth: 2 }] },
        options: { cutout: '58%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => c.label + ': ' + c.raw + ' (' + Math.round(100 * c.raw / interns.length) + '%)' } } } }
      });
      const modes = countText(interns, r => r.data.mode);
      addChart(grid, 'Internship mode', 'On-site / remote / hybrid', {
        type: 'bar', data: { labels: modes.map(m => m[0]), datasets: [{ label: 'Internships', data: modes.map(m => m[1]), backgroundColor: PALETTE[0] }] },
        options: barOpts({ legend: false })
      });
      const comp = topN(countText(interns, r => r.data.company), 10);
      addChart(grid, 'Top companies / organisations', 'Internships hosted', {
        type: 'bar', data: { labels: comp.map(c => c[0]), datasets: [{ label: 'Internships', data: comp.map(c => c[1]), backgroundColor: comp.map(c => c[0].startsWith('Others (') ? OTHER_GREY : PALETTE[0]) }] },
        options: barOpts({ legend: false, horizontal: true })
      }, { tall: comp.length > 6 });
      const loc = topN(countText(interns, r => r.data.location), 10);
      addChart(grid, 'Internship locations', 'City', {
        type: 'bar', data: { labels: loc.map(c => c[0]), datasets: [{ label: 'Internships', data: loc.map(c => c[1]), backgroundColor: loc.map(c => c[0].startsWith('Others (') ? OTHER_GREY : PALETTE[2]) }] },
        options: barOpts({ legend: false, horizontal: true })
      }, { tall: loc.length > 6 });
    }

    // 5. Faculty-wise guidance (minor + major, stacked)
    const projCats = cats.filter(c => c.fields.some(f => f.id === 'guide'));
    const guideMap = new Map();
    list.forEach(r => { const g = r.data.guide; if (g && g.name) { const k = g.name + ' (' + g.department + ')'; if (!guideMap.has(k)) guideMap.set(k, {}); const o = guideMap.get(k); o[r.category] = (o[r.category] || 0) + 1; } });
    if (guideMap.size) {
      const top = [...guideMap.entries()].map(([k, o]) => [k, o, Object.values(o).reduce((a, b) => a + b, 0)]).sort((a, b) => b[2] - a[2]).slice(0, 15);
      addChart(grid, 'Projects guided by faculty', 'Top ' + top.length + ' guides', {
        type: 'bar',
        data: { labels: top.map(t => t[0]), datasets: projCats.map(c => ({ label: c.label, data: top.map(t => t[1][c.id] || 0), backgroundColor: catColor(c.id) })) },
        options: barOpts({ stacked: true, horizontal: true })
      }, { wide: true, tall: top.length > 6 });
      const gd = countBy(list.filter(r => r.data.guide && r.data.guide.name), r => r.data.guide.department);
      const gdl = [...gd.entries()].sort((a, b) => b[1] - a[1]);
      addChart(grid, 'Projects by guide’s department', 'Minor and major projects', {
        type: 'bar', data: { labels: gdl.map(x => x[0]), datasets: [{ label: 'Projects', data: gdl.map(x => x[1]), backgroundColor: PALETTE[6] }] },
        options: barOpts({ legend: false })
      });
    }

    // 6. Others: activity type
    const others = list.filter(r => r.data.other_type);
    if (others.length) {
      const ot = countText(others, r => r.data.other_type);
      addChart(grid, 'Other activities by type', 'Hackathons, papers, courses…', {
        type: 'bar', data: { labels: ot.map(x => x[0]), datasets: [{ label: 'Records', data: ot.map(x => x[1]), backgroundColor: catColor('others') }] },
        options: barOpts({ legend: false, horizontal: true })
      });
    }

    // 7. Submissions over time (last 12 months)
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push([d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })]); }
    const mc = countBy(list, r => (r.submittedAt || '').slice(0, 7));
    addChart(grid, 'Submissions over the last 12 months', 'By month of first submission', {
      type: 'line',
      data: { labels: months.map(m => m[1]), datasets: [{ label: 'Submissions', data: months.map(m => mc.get(m[0]) || 0), borderColor: PALETTE[0], backgroundColor: PALETTE[0], borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0.25 }] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } }
    }, { wide: true });

    // Pivot table: department × type
    panel.appendChild(pivotTable(list, depts, cats));
  }

  function kpi(value, label, color) {
    return h('div', { class: 'kpi' }, color ? h('span', { class: 'kpi-dot', style: { background: color }, attrs: { 'aria-hidden': 'true' } }) : null,
      h('div', { class: 'kpi-num', text: String(value) }), h('div', { class: 'kpi-lab', text: label }));
  }

  function barOpts({ stacked = false, horizontal = false, legend = true } = {}) {
    const val = { beginAtZero: true, stacked, ticks: { precision: 0 }, grid: { color: '#eeede9' } };
    const cat = { stacked, grid: { display: false }, ticks: { autoSkip: false, maxRotation: horizontal ? 0 : 45, callback: function (v) { const l = this.getLabelForValue(v); return l.length > 28 ? l.slice(0, 27) + '…' : l; } } };
    return {
      indexAxis: horizontal ? 'y' : 'x',
      datasets: { bar: { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 38, borderColor: '#ffffff', borderWidth: stacked ? { top: 2, right: 0, bottom: 0, left: 0 } : 0 } },
      plugins: { legend: { display: legend, position: 'bottom' } },
      scales: horizontal ? { x: val, y: cat } : { x: cat, y: val }
    };
  }

  function addChart(grid, title, caption, config, { wide = false, tall = false } = {}) {
    const canvas = h('canvas', { attrs: { role: 'img', 'aria-label': title } });
    const card = h('figure', { class: 'chart-card' + (wide ? ' span-2' : '') },
      h('div', { class: 'chart-head' },
        h('figcaption', {}, h('div', { class: 'chart-title', text: title }), h('div', { class: 'chart-cap', text: caption })),
        h('button', { class: 'icon-btn', attrs: { title: 'Download PNG', 'aria-label': 'Download ' + title + ' as PNG' }, text: '⤓',
          onclick: () => { const a = h('a', { href: chart.toBase64Image('image/png', 1), download: title.replace(/[^A-Za-z0-9]+/g, '_') + '.png' }); document.body.appendChild(a); a.click(); a.remove(); } })),
      h('div', { class: 'chart-box' + (tall ? ' tall' : '') }, canvas));
    grid.appendChild(card);
    const chart = new Chart(canvas, config);
    charts.push(chart);
  }

  function pivotTable(list, depts, cats) {
    const rows = depts.map(d => [d, ...cats.map(c => list.filter(r => r.department === d && r.category === c.id).length)]);
    const totals = ['Total', ...cats.map((c, i) => rows.reduce((s, r) => s + r[i + 1], 0))];
    const csv = [['Department', ...cats.map(c => c.label), 'Total']].concat(rows.concat([totals]).map(r => r.concat([r.slice(1).reduce((a, b) => a + b, 0)])));
    return h('section', { class: 'card' },
      h('div', { class: 'card-head between' }, h('h3', { text: 'Department × type of work' }),
        h('button', { class: 'btn btn-ghost btn-sm', text: 'Download CSV', onclick: () => downloadText('department_vs_type.csv', toCSV(csv)) })),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table pivot' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Department' }), cats.map(c => h('th', { class: 'num', text: c.label })), h('th', { class: 'num', text: 'Total' }))),
        h('tbody', {}, rows.map(r => h('tr', {}, h('td', { text: r[0] }), r.slice(1).map(v => h('td', { class: 'num', text: String(v) })), h('td', { class: 'num strong', text: String(r.slice(1).reduce((a, b) => a + b, 0)) })))),
        h('tfoot', {}, h('tr', {}, h('td', { text: 'Total' }), totals.slice(1).map(v => h('td', { class: 'num', text: String(v) })), h('td', { class: 'num', text: String(list.length) }))))));
  }

  /* ---------------- Records ---------------- */
  function keyInfo(r) {
    const d = r.data || {};
    if (d.company) return d.company + (d.location ? ', ' + d.location : '');
    if (d.guide && d.guide.name) return d.guide.name + ' (' + d.guide.department + ')';
    return d.organisation || '';
  }

  function renderRecords(panel) {
    const tableHost = h('div');
    const draw = () => {
      clear(tableHost);
      const list = filtered(false).sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
      const pages = Math.max(1, Math.ceil(list.length / PAGE));
      page = Math.min(page, pages - 1);
      const slice = list.slice(page * PAGE, page * PAGE + PAGE);
      appendTo(tableHost, 
        h('div', { class: 'toolbar' },
          h('span', { class: 'muted', text: list.length + ' record' + (list.length === 1 ? '' : 's') }),
          h('div', { class: 'toolbar-right' },
            h('button', { class: 'btn btn-secondary btn-sm', text: 'Export CSV (filtered)', disabled: !list.length, onclick: () => exportCSV(list) }))),
        list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table clickable' },
          h('thead', {}, h('tr', {}, ['Project ID', 'Student ID', 'Name', 'Batch', 'Dept', 'Type', 'Title', 'Guide / Company', 'Status', 'Submitted'].map(t => h('th', { text: t })))),
          h('tbody', {}, slice.map(r => h('tr', { tabIndex: 0, onclick: () => openRecord(r), onkeydown: (e) => { if (e.key === 'Enter') openRecord(r); } },
            h('td', { class: 'mono', text: r.id }), h('td', { class: 'mono', text: r.studentId }), h('td', { text: r.studentName }),
            h('td', { text: (r.batch || '').toUpperCase() }), h('td', { text: r.department }),
            h('td', {}, h('span', { class: 'cat-tag cat-' + r.category, text: FormKit.categoryLabel(ctx.form, r.category) })),
            h('td', { class: 'title-cell', text: r.title }), h('td', { text: keyInfo(r) }),
            h('td', {}, statusPill(r.status)), h('td', { class: 'nowrap', text: fmtDate(r.submittedAt) })))))) : emptyState('No matching records'),
        pages > 1 ? h('div', { class: 'pager' },
          h('button', { class: 'btn btn-ghost btn-sm', text: '‹ Prev', disabled: page === 0, onclick: () => { page--; draw(); } }),
          h('span', { text: 'Page ' + (page + 1) + ' of ' + pages }),
          h('button', { class: 'btn btn-ghost btn-sm', text: 'Next ›', disabled: page >= pages - 1, onclick: () => { page++; draw(); } })) : null);
    };
    appendTo(panel, filterBar((fromSearch) => { if (fromSearch) draw(); else render(); }, true), tableHost);
    draw();
  }

  function openRecord(r) {
    const statusSel = h('select', {}, ctx.statuses.map(s => h('option', { value: s, text: s, selected: s === r.status })));
    const remark = h('textarea', { rows: 3, maxLength: 500, placeholder: 'Remark shown to the student (required for “Needs Correction” / “Rejected”)', value: r.remark || '' });
    const body = h('div', {},
      h('div', { class: 'rec-head-grid' },
        info('Student', r.studentName), info('Student ID', r.studentId), info('E-mail', r.email), info('Batch', (r.batch || '').toUpperCase()),
        info('Type', FormKit.categoryLabel(ctx.form, r.category)), info('Project ID', r.id),
        info('Submitted', fmtDateTime(r.submittedAt)), info('Updated', fmtDateTime(r.updatedAt)),
        h('div', { class: 'info' }, h('div', { class: 'info-k', text: 'Status' }), statusPill(r.status)),
        r.reviewedBy ? info('Reviewed by', r.reviewedBy) : null),
      h('h4', { class: 'section-title', text: 'Submitted details' }),
      FormKit.details(ctx.form, r, { showFileLinks: true }),
      h('h4', { class: 'section-title', text: 'Verification' }),
      h('div', { class: 'review-box' },
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Status' }), statusSel),
        h('label', { class: 'field span-2' }, h('span', { class: 'field-label', text: 'Remark' }), remark)));
    const actions = [];
    if (ctx.user.role === 'super') actions.push({ label: 'Delete permanently', class: 'btn-danger-ghost', onClick: async (close) => {
      if (!(await confirmBox('Delete permanently?', 'This removes ' + r.id + ' and its uploaded files from the database. This cannot be undone.', 'Delete permanently', true))) return;
      try { await withBusy('Deleting…', () => api('super.deleteRecord', { id: r.id })); records = records.filter(x => x.id !== r.id); close(); render(); toast('Record deleted'); } catch (e) { toastError(e); }
    } });
    actions.push({ label: 'Close', class: 'btn-ghost', onClick: (close) => close() });
    actions.push({ label: 'Save status', class: 'btn-primary', onClick: async (close) => {
      if ((statusSel.value === 'Needs Correction' || statusSel.value === 'Rejected') && !remark.value.trim()) { toast('Please add a remark for the student.', 'warn'); remark.focus(); return; }
      try {
        const upd = await withBusy('Saving…', () => api('admin.setStatus', { id: r.id, status: statusSel.value, remark: remark.value }));
        Object.assign(r, upd); delete r._s;
        close(); render(); toast('Status updated to ' + upd.status);
      } catch (e) { toastError(e); }
    } });
    openModal(r.title || r.id, body, { wide: true, actions });
  }
  function info(k, v) { return h('div', { class: 'info' }, h('div', { class: 'info-k', text: k }), h('div', { class: 'info-v', text: v || '—' })); }

  function exportCSV(list) {
    const base = ['ProjectID', 'StudentID', 'StudentName', 'Email', 'Batch', 'Type', 'Department', 'AcademicYear', 'Title', 'Status', 'Remark', 'ReviewedBy', 'SubmittedAt', 'UpdatedAt'];
    const skip = new Set(['title', 'department', 'academic_year']);
    const fields = [];
    const seen = new Set();
    ctx.form.commonFields.concat(...ctx.form.categories.map(c => c.fields)).forEach(f => { if (!skip.has(f.id) && !seen.has(f.id)) { seen.add(f.id); fields.push(f); } });
    const rows = [base.concat(fields.map(f => f.label))];
    list.forEach(r => rows.push([r.id, r.studentId, r.studentName, r.email, (r.batch || '').toUpperCase(), FormKit.categoryLabel(ctx.form, r.category), r.department, r.academicYear,
      r.title, r.status, r.remark, r.reviewedBy, r.submittedAt, r.updatedAt].concat(fields.map(f => {
        if (f.type === 'file') return r.files && r.files[f.id] ? r.files[f.id].name : '';
        const v = r.data[f.id];
        return v === undefined || v === null || v === '' ? '' : FormKit.displayValue(f.type === 'date' ? null : f, v);
      }))));
    downloadText('rgukt_ongole_projects_' + new Date().toISOString().slice(0, 10) + '.csv', toCSV(rows));
  }

  return { mount, rerender: () => render(), records: () => records };
})();
