// End-to-end UI test: real frontend in Chrome, real Code.gs in the mock, Google Sign-In faked.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createEnv } = require('./gas-mock');

const DOCS = path.join(__dirname, '../docs');
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const env = createEnv(path.join(__dirname, '../backend/Code.gs'));
env.setup();
const tok = (email, hd = 'rguktong.ac.in') => ['TEST', email, hd, 'TEST_CLIENT_ID', '', 'true'].join('~') + '~padding-padding';

// ---------- seed realistic data through the real API ----------
const FAC = { CSE: ['Dr. K. Srinivas', 'Mr. P. Ravi Kumar', 'Ms. S. Lakshmi', 'Dr. M. Venkatesh'], ECE: ['Dr. N. Prasad', 'Mr. B. Suresh', 'Ms. K. Anitha'],
  EEE: ['Dr. R. Ramesh', 'Mr. T. Naresh'], CIVIL: ['Dr. Ch. Chandra', 'Mr. V. Mahesh', 'Ms. G. Divya'], MECH: ['Dr. S. Kiran', 'Mr. A. Gopi'], CHEM: ['Dr. P. Sravani'], MME: ['Mr. L. Harish'] };
function seed() {
  const su = env.call({ action: 'auth.login', payload: { idToken: tok('dataongole@gmail.com', '') } }).data.session;
  const list = []; Object.entries(FAC).forEach(([d, ns]) => ns.forEach(n => list.push({ department: d, name: n, designation: n.startsWith('Dr') ? 'Associate Professor' : 'Assistant Professor' })));
  const r = env.call({ action: 'super.saveFaculty', session: su, payload: { faculty: list } }); if (!r.ok) throw new Error(r.error);
  let rnd = 7; const R = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647; const pick = (a) => a[Math.floor(R() * a.length)];
  const depts = ['CSE', 'CSE', 'CSE', 'ECE', 'ECE', 'EEE', 'CIVIL', 'CIVIL', 'MECH', 'CHEM', 'MME'];
  const companies = ['TCS', 'Infosys', 'L&T Construction', 'NHAI', 'Wipro', 'ISRO', 'BHEL', 'IIT Madras', 'Zoho', 'Accenture', 'AP Transco', 'Cyient', 'Startup Labs'];
  const cities = ['Hyderabad', 'Bengaluru', 'Chennai', 'Vijayawada', 'Visakhapatnam', 'Pune', 'Remote', 'Ongole'];
  let n = 0, ok = 0;
  for (const batch of ['20', '21', '22', '23', '24']) for (let i = 0; i < 26; i++) {
    const email = 'o' + batch + String(1000 + i * 37).slice(0, 4) + '@rguktong.ac.in';
    const s = env.call({ action: 'auth.login', payload: { idToken: tok(email) } }).data.session;
    const k = 1 + Math.floor(R() * 2);
    for (let j = 0; j < k; j++) {
      const dept = pick(depts); const cat = pick(['minor', 'minor', 'major', 'internship', 'internship', 'others']);
      const data = { title: pick(['Smart', 'Low-cost', 'AI-based', 'IoT-enabled', 'Sustainable']) + ' ' + pick(['traffic monitoring', 'crop advisory', 'pavement evaluation', 'power quality analysis', 'chatbot', 'water quality sensing']) + ' ' + (++n),
        department: dept, academic_year: pick(['2023-24', '2024-25', '2025-26']), semester: pick(['E3 Sem-1', 'E3 Sem-2', 'E4 Sem-1', 'Summer / Vacation']), abstract: 'Study and prototype.', start_date: '2025-0' + (1 + Math.floor(R() * 8)) + '-10' };
      if (cat === 'minor' || cat === 'major') { const gd = R() < 0.8 ? dept : pick(Object.keys(FAC)); Object.assign(data, { guide: { department: gd, name: pick(FAC[gd]) }, domain: 'Other', project_status: pick(['Ongoing', 'Completed']) }); }
      if (cat === 'internship') { const paid = R() < 0.6 ? 'Paid' : 'Unpaid'; Object.assign(data, { company: pick(companies), org_type: 'Private Company (Indian)', location: pick(cities), state_country: 'India', mode: pick(['On-site', 'On-site', 'Remote', 'Hybrid']), paid, duration_weeks: 8 }); if (paid === 'Paid') data.stipend = pick([5000, 10000, 15000, 20000, 25000]); }
      if (cat === 'others') Object.assign(data, { other_type: pick(['Hackathon', 'Research Paper', 'Online Course / Certification', 'Competition']), organisation: pick(['Smart India Hackathon', 'NPTEL', 'IEEE', 'Coursera']) });
      const res = env.call({ action: 'student.save', session: s, payload: { category: cat, data } });
      if (!res.ok) throw new Error('seed failed: ' + res.error); ok++;
    }
  }
  // Spread submission dates over the past months so the trend chart is meaningful
  const sh = env.sheetsById.get(env.props.DB_ID).getSheetByName('Projects');
  for (let i = 1; i < sh.rows.length; i++) { const d = new Date(Date.now() - Math.floor(R() * 300) * 86400000); sh.rows[i][1] = d.toISOString(); if (R() < 0.45) sh.rows[i][11] = 'Verified'; }
  return ok;
}
console.log('Seeded', seed(), 'records');

// ---------- static server ----------
const PORT = Number(process.env.TEST_PORT) || 18765;
const BASE = 'http://localhost:' + PORT + '/';
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, path.normalize(p));
  if (!f.startsWith(DOCS) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(f)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(f).pipe(res);
}).listen(PORT);

const FAKE_GIS = `window.google={accounts:{id:{initialize(o){window.__gcb=o.callback},renderButton(el){var b=document.createElement('button');b.id='fake-gsi';b.textContent='Sign in with Google';b.style.cssText='padding:10px 26px;border-radius:999px;background:#1a73e8;color:#fff;border:0;font:600 15px Roboto,Arial';b.onclick=function(){window.__gcb({credential:window.__testToken})};el.appendChild(b)},disableAutoSelect(){}}}};`;
const TEST_CONFIG = `window.APP_CONFIG=Object.freeze({APP_NAME:'RGUKT Ongole Project Database',INSTITUTION:'Rajiv Gandhi University of Knowledge Technologies, Ongole Campus',API_URL:'https://script.google.com/macros/s/TEST/exec',GOOGLE_CLIENT_ID:'TEST_CLIENT_ID.apps.googleusercontent.com',STUDENT_EMAIL_HINT:'o2123231@rguktong.ac.in'});`;

const problems = [];
let step = 0;
async function newPage(browser, w = 1366, hgt = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await page.route('**/js/config.js', r => r.fulfill({ contentType: 'text/javascript', body: TEST_CONFIG }));
  await page.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }));
  await page.route('https://script.google.com/**', async r => {
    const body = r.request().postData();
    const out = env.call(body);
    await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(out) });
  });
  return page;
}
async function signIn(page, email, hd) {
  await page.goto(BASE);
  await page.waitForSelector('#fake-gsi');
  await page.evaluate(t => { window.__testToken = t; }, tok(email, hd));
  await page.click('#fake-gsi');
}
const shot = async (page, name, full = false) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(SHOTS, String(++step).padStart(2, '0') + '_' + name + '.png'), fullPage: full }); };
function expect(cond, msg) { if (!cond) { problems.push('ASSERT: ' + msg); console.log('  ✗', msg); } else console.log('  ✓', msg); }

(async () => {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', args: ['--no-sandbox'] });
  try {
    // ---- Login page & denied account ----
    let page = await newPage(browser);
    await page.goto(BASE); await page.waitForSelector('#fake-gsi');
    await shot(page, 'login');
    await page.evaluate(t => { window.__testToken = t; }, tok('o212343@gmail.com', ''));
    await page.click('#fake-gsi'); await page.waitForSelector('.login-msg:not(:empty)');
    expect(/Access denied/.test(await page.textContent('.login-msg')), 'gmail look-alike is denied on the login page');
    // da@ / director@ are no longer default administrators
    await page.evaluate(t => { window.__testToken = t; }, tok('director@rguktong.ac.in'));
    await page.click('#fake-gsi'); await page.waitForTimeout(300);
    expect(/Access denied/.test(await page.textContent('.login-msg')), 'director@ is not an administrator by default');
    // Clickjacking: the app refuses to show itself inside another site's frame
    await page.route(BASE + 'attack.html', r => r.fulfill({ contentType: 'text/html', body: '<iframe id="f" sandbox="allow-scripts allow-same-origin" src="' + BASE + '" width="800" height="600"></iframe>' }));
    await page.goto(BASE + 'attack.html');
    await page.waitForTimeout(1200);
    const fr = page.frames().find(f => f !== page.mainFrame());
    const hidden = fr ? await fr.evaluate(() => document.documentElement.style.display === 'none' && !document.querySelector('#fake-gsi')) : false;
    expect(hidden, 'page is hidden and does not start when framed (anti-clickjacking)');
    // Security meta tags
    await page.goto(BASE); await page.waitForSelector('#fake-gsi');
    const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
    expect(/object-src 'none'/.test(csp) && /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client;/.test(csp) && !/unsafe-eval/.test(csp), 'strict Content-Security-Policy present');
    await page.context().close();

    // ---- 7-digit student ID ----
    page = await newPage(browser);
    await signIn(page, 'o2123231@rguktong.ac.in');
    await page.waitForSelector('#category');
    expect(await page.isVisible('text=O2123231') && await page.isVisible('text=O21'), '7-digit ID o2123231 signs in as student O2123231, batch O21');
    await shot(page, 'student_7digit_welcome');
    await page.context().close();

    // ---- Student flow ----
    page = await newPage(browser);
    await signIn(page, 'o212343@rguktong.ac.in');
    await page.waitForSelector('#category');
    expect(await page.isVisible('text=Welcome,'), 'student lands on submission page');
    await page.selectOption('#category', 'minor');
    await page.waitForSelector('text=Minor Project details');
    await shot(page, 'student_minor_form_empty');
    // Submit empty to see validation
    await page.click('button:has-text("Submit")');
    expect(await page.locator('.field-error:has-text("required")').count() >= 4, 'client-side validation highlights required fields');
    const fill = async (label, val) => { const id = await page.locator('label.field-label', { hasText: label }).first().getAttribute('for'); await page.fill('#' + id, val); };
    const sel = async (label, val) => { const id = await page.locator('label.field-label', { hasText: label }).first().getAttribute('for'); await page.selectOption('#' + id, val); };
    await fill('Title of the Project', 'FWD-based evaluation of rural roads in Prakasam district');
    await sel('Your Department', 'CIVIL');
    await sel('Academic Year', '2025-26');
    await sel('Year & Semester', 'E3 Sem-2');
    await fill('Team Members', 'O212344, O212345');
    await fill('Abstract', 'Back-calculation of layer moduli from FWD deflection bowls for PMGSY roads.');
    await fill('Technologies', 'KGPBACK, IITPAVE, Python');
    await fill('Start Date', '2025-08-01');
    await fill('End Date', '2025-11-15');
    // Guide: department → faculty list filters
    const gid = await page.locator('label.field-label', { hasText: 'Project Guide' }).getAttribute('for');
    await page.selectOption('#' + gid, 'CIVIL');
    const names = await page.locator('#' + gid + ' + select option').allTextContents();
    expect(names.some(n => n.includes('Dr. Ch. Chandra')) && !names.some(n => n.includes('Srinivas')), 'faculty list filters by department');
    await page.locator('#' + gid + ' + select').selectOption('Dr. Ch. Chandra');
    await sel('Project Area', 'Transportation / Pavement Engineering');
    await page.check('label.radio:has-text("Completed") input');
    await shot(page, 'student_minor_form_filled', true);
    await page.click('button:has-text("Submit")');
    await page.waitForSelector('.rec-card');
    expect(await page.isVisible('text=FWD-based evaluation of rural roads'), 'minor project submitted and listed');

    // Internship with conditional stipend + PDF upload
    await page.click('.tab:has-text("New Submission")');
    await page.selectOption('#category', 'internship');
    const stipendLabel = page.locator('label.field-label', { hasText: 'Stipend' });
    expect(!(await stipendLabel.isVisible()), 'stipend hidden until "Paid" chosen');
    await page.check('label.radio:has-text("Paid") >> nth=0 >> input').catch(async () => { await page.locator('label.radio', { hasText: /^Paid$/ }).locator('input').check(); });
    expect(await stipendLabel.isVisible(), 'stipend appears when "Paid" chosen');
    await fill('Title of the Project', 'Summer internship – Highway design');
    await sel('Your Department', 'CIVIL'); await sel('Academic Year', '2025-26'); await sel('Year & Semester', 'Summer / Vacation');
    await fill('Abstract', 'Worked on geometric design of NH bypass.'); await fill('Start Date', '2025-05-15'); await fill('End Date', '2025-07-10');
    await fill('Company / Organisation Name', 'L&T Construction'); await sel('Type of Organisation', 'Private Company (Indian)');
    await fill('Location (City)', 'Hyderabad'); await fill('State / Country', 'Telangana, India');
    await page.locator('label.radio', { hasText: 'On-site' }).locator('input').check();
    await fill('Stipend', '12000'); await fill('Duration (weeks)', '8');
    const pdfPath = path.join(__dirname, 'cert.pdf'); fs.writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const fid = await page.locator('label.field-label', { hasText: 'Report / Certificate' }).getAttribute('for');
    await page.setInputFiles('#' + fid, pdfPath);
    await shot(page, 'student_internship_form', true);
    await page.click('button:has-text("Submit")');
    await page.waitForSelector('text=Summer internship – Highway design');
    expect(await page.isVisible('text=L&T Construction · Hyderabad · Paid'), 'internship card shows company · city · paid');
    await shot(page, 'student_my_submissions');
    await page.context().close();

    // ---- Admin flow ----
    page = await newPage(browser, 1440, 900);
    await signIn(page, 'ao@rguktong.ac.in');
    await page.waitForSelector('canvas');
    await page.waitForTimeout(900);
    expect(await page.isVisible('text=Administrator Dashboard'), 'admin sees dashboard');
    expect(!(await page.isVisible('.tab:has-text("Form Builder")')), 'admin does NOT see super-admin tabs');
    await shot(page, 'admin_dashboard', true);
    await page.selectOption('.filter:has-text("Department") select', 'CIVIL');
    await page.waitForTimeout(700);
    await shot(page, 'admin_dashboard_civil', false);
    await page.click('.tab:has-text("Records")');
    await page.fill('.filter-grow input', 'FWD-based');
    await page.waitForTimeout(400);
    expect(await page.locator('tbody tr').count() === 1, 'search finds the student record');
    await page.click('tbody tr');
    await page.waitForSelector('.modal');
    await shot(page, 'admin_record_detail');
    await page.selectOption('.review-box select', 'Verified');
    await page.fill('.review-box textarea', 'Verified with guide.');
    await page.click('.modal-foot button:has-text("Save status")');
    await page.waitForSelector('text=Status updated to Verified');
    await page.fill('.filter-grow input', '');
    await page.waitForTimeout(400);
    await shot(page, 'admin_records');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export CSV")')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    expect(csv.includes('Stipend (₹ per month)') && csv.includes('Dr. Ch. Chandra (CIVIL)'), 'CSV export has all form columns and faculty values');
    await page.context().close();

    // ---- Super admin flow ----
    page = await newPage(browser, 1440, 900);
    await signIn(page, 'dataongole@gmail.com', '');
    await page.waitForSelector('text=Super Administrator Console');
    await page.click('.tab:has-text("Form Builder")');
    await page.click('.nav-main:has-text("Internship")');
    await page.click('.field-row:has-text("Stipend") button:has-text("Edit")');
    await shot(page, 'super_form_builder', true);
    // add a field and save
    await page.click('button:has-text("+ Add field")');
    await page.locator('.field-row.open .field-editor input[type=text]').first().fill('Company Website');
    await page.locator('.field-row.open .field-editor select').first().selectOption('url');
    await page.click('button:has-text("Save form")');
    await page.waitForSelector('text=Form saved (version 2)');
    expect(true, 'super adds a field in the form builder and saves (v2)');
    await page.click('.tab:has-text("Faculty")');
    await page.waitForSelector('.edit-table');
    await page.click('button:has-text("Bulk import")');
    await page.fill('.modal textarea', 'Department\tName\tDesignation\tEmail\nCSE\tDr. New Faculty\tProfessor\tnew@rguktong.ac.in\nXYZ\tBad Row\tx\t');
    await page.waitForTimeout(200);
    await shot(page, 'super_faculty_bulk');
    await page.click('.modal-foot button:has-text("Import")');
    await page.click('button:has-text("Save faculty list")');
    await page.waitForSelector('text=Faculty list saved (17)');
    expect(true, 'bulk import adds valid row, skips bad department, saves 17 (16 seeded + 1)');
    await shot(page, 'super_faculty');
    await page.click('.tab:has-text("Users & Access")');
    await page.waitForSelector('text=Administrators');
    await shot(page, 'super_users');
    await page.click('.tab:has-text("Settings & Drive")');
    await page.waitForSelector('text=Batch folders');
    await shot(page, 'super_settings');
    await page.click('.tab:has-text("Audit Log")');
    await page.waitForSelector('.table');
    await shot(page, 'super_audit');
    await page.context().close();

    // ---- Student sees verification + new field; mobile view ----
    page = await newPage(browser, 390, 844);
    await signIn(page, 'o212343@rguktong.ac.in');
    await page.waitForSelector('.rec-card');
    expect(await page.locator('.rec-card:has-text("FWD-based") .pill-good').count() === 1, 'student sees Verified status');
    expect(await page.locator('.rec-card:has-text("FWD-based") button:has-text("Edit")').count() === 0, 'verified record cannot be edited');
    await shot(page, 'mobile_student_list', true);
    await page.click('.tab:has-text("New Submission")');
    await page.selectOption('#category', 'internship');
    expect(await page.isVisible('label.field-label:has-text("Company Website")'), 'new form field appears for students');
    await page.context().close();
  } catch (e) {
    problems.push('FATAL: ' + e.stack);
  } finally {
    await browser.close(); server.close();
    // The frame-buster's blocked break-out attempt is expected in the clickjacking test
    const real = problems.filter(p => !/favicon/.test(p) && !/Unsafe attempt to initiate navigation/.test(p));
    console.log(real.length ? '\nPROBLEMS:\n' + real.join('\n') : '\nNo console errors, no failed assertions.');
    process.exit(real.length ? 1 : 0);
  }
})();
