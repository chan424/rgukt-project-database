// Backend tests: run the real Code.gs against the mocks and check behaviour + security rules.
const assert = require('assert');
const { createEnv } = require('./gas-mock');
const env = createEnv(__dirname + '/../backend/Code.gs');
env.setup();

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message); } }
const tok = (email, hd = 'rguktong.ac.in', o = {}) => ['TEST', email, hd, o.aud || 'TEST_CLIENT_ID', o.exp || '', o.verified || 'true'].join('~') + '~padding-padding';
const login = (email, hd, o) => env.call({ action: 'auth.login', payload: { idToken: tok(email, hd, o) } });
const call = (session, action, payload = {}) => env.call({ action, session, payload });
const ok = (r) => { if (!r.ok) throw new Error('expected ok, got ' + r.code + ' ' + r.error); return r.data; };
const err = (r, code) => { if (r.ok) throw new Error('expected error ' + code + ', got ok'); if (code && r.code !== code) throw new Error('expected ' + code + ', got ' + r.code + ' ' + r.error); return r.error; };
const sheet = (n) => env.sheetsById.get(env.props.DB_ID).getSheetByName(n);
const PDF = Buffer.from('%PDF-1.4\n%test\n').toString('base64');

console.log('Setup');
t('creates root folder, database and batch folders o20–o25', () => {
  assert(env.props.ROOT_FOLDER_ID && env.props.DB_ID);
  const names = [...env.drive.folders.values()].map(f => f.name).sort();
  ['o20', 'o21', 'o22', 'o23', 'o24', 'o25', 'RGUKT Ongole Project Database'].forEach(n => assert(names.includes(n), n));
  ['Projects', 'Users', 'Faculty', 'Settings', 'Audit'].forEach(n => assert(sheet(n), n));
  const root = env.drive.folders.get(env.props.ROOT_FOLDER_ID);
  assert.deepStrictEqual(root.viewers.sort(), ['ao@rguktong.ac.in'], 'only ao@ is a default administrator');
  assert.strictEqual(root.sharing, 'PRIVATE', 'root folder is not link-shared');
});
t('running setup twice does not duplicate anything', () => {
  const before = env.drive.folders.size; env.setup();
  assert.strictEqual(env.drive.folders.size, before);
  assert.strictEqual(sheet('Settings').getLastRow(), 9);
});

console.log('Authentication');
let S, A, SU, S2;
t('student o212343@rguktong.ac.in signs in; batch o21 folder + student folder', () => {
  const d = ok(login('o212343@rguktong.ac.in'));
  S = d.session;
  assert.strictEqual(d.user.role, 'student'); assert.strictEqual(d.user.studentId, 'O212343'); assert.strictEqual(d.user.batch, 'o21');
  const o21 = [...env.drive.folders.values()].find(f => f.name === 'o21');
  assert([...env.drive.folders.values()].some(f => f.name === 'O212343' && f.parent === o21.id));
});
t('new batch o26 student creates o26 folder automatically', () => {
  const d = ok(login('o262001@rguktong.ac.in')); S2 = d.session;
  assert([...env.drive.folders.values()].some(f => f.name === 'o26'));
});
t('7-digit student o2123231@rguktong.ac.in signs in; ID O2123231, batch o21, folder o21/O2123231', () => {
  const d = ok(login('o2123231@rguktong.ac.in'));
  assert.strictEqual(d.user.studentId, 'O2123231'); assert.strictEqual(d.user.batch, 'o21');
  const o21s = [...env.drive.folders.values()].filter(f => f.name === 'o21');
  assert.strictEqual(o21s.length, 1, 'exactly one o21 folder');
  assert([...env.drive.folders.values()].some(f => f.name === 'O2123231' && f.parent === o21s[0].id));
});
t('other batches (o22, o23) get their own folders; IDs with 5 or 8+ digits are refused', () => {
  ok(login('o2210001@rguktong.ac.in')); ok(login('o231234@rguktong.ac.in'));
  ['o22', 'o23'].forEach(b => assert.strictEqual([...env.drive.folders.values()].filter(f => f.name === b).length, 1, b));
  err(login('o21234@rguktong.ac.in'), 403); err(login('o21234567@rguktong.ac.in'), 403); err(login('x2123231@rguktong.ac.in'), 403);
});
t('batch/student folders are created under the script lock, never duplicated', () => {
  // Simulate the "o27" folder existing in Drive but missing from settings (e.g. a concurrent sign-in won the race)
  const root = env.drive.folders.get(env.props.ROOT_FOLDER_ID);
  const orig = root.createFolder; let createdUnlocked = 0;
  root.createFolder = function (n) { if (!env.lockState.held) createdUnlocked++; return orig.call(this, n); };
  ok(login('o2700001@rguktong.ac.in'));
  const map = JSON.parse(sheet('Settings').rows.find(r => r[0] === 'BATCH_FOLDERS')[1]); delete map.o27;
  const sr = sheet('Settings').rows.find(r => r[0] === 'BATCH_FOLDERS'); sr[1] = JSON.stringify(map);
  ok(login('o2700002@rguktong.ac.in'));
  root.createFolder = orig;
  assert.strictEqual(createdUnlocked, 0, 'folder creation happens while holding the lock');
  assert.strictEqual([...env.drive.folders.values()].filter(f => f.name === 'o27').length, 1, 'no duplicate o27 folder');
  assert.strictEqual(env.lockState.held, false, 'lock released');
});
t('only ao@rguktong.ac.in is a default admin; dataongole@gmail.com is super; da@/director@ are not admins', () => {
  A = ok(login('ao@rguktong.ac.in')).session;
  assert.strictEqual(ok(login('ao@rguktong.ac.in')).user.role, 'admin');
  err(login('director@rguktong.ac.in'), 403); err(login('da@rguktong.ac.in'), 403);
  const su = ok(login('dataongole@gmail.com', ''));
  SU = su.session; assert.strictEqual(su.user.role, 'super');
});
t('admin address without the Workspace hd claim (personal Google account) is refused', () => err(login('ao@rguktong.ac.in', ''), 403));
t('college address with a foreign hd claim is refused', () => err(login('o212343@rguktong.ac.in', 'evil.com'), 403));
t('session tokens are random 64-hex and only their hash is stored server-side', () => {
  const a = ok(login('o212343@rguktong.ac.in')).session, b = ok(login('o212343@rguktong.ac.in')).session;
  assert(/^[a-f0-9]{64}$/.test(a) && a !== b);
  assert(![...env.cache.keys()].some(k => k.includes(a)), 'raw token is not a cache key');
});
t('idle sessions expire after 60 minutes', () => {
  const s = ok(login('o212343@rguktong.ac.in')).session;
  const key = [...env.cache.keys()].find(k => k === 'sess_' + require('crypto').createHash('sha256').update(s).digest('hex'));
  const e = env.cache.get(key); const v = JSON.parse(e.v); v.last = Date.now() - 61 * 60 * 1000; e.v = JSON.stringify(v);
  err(call(s, 'config.get'), 401);
});
t('rejects token for another app (aud mismatch)', () => err(login('o212343@rguktong.ac.in', 'rguktong.ac.in', { aud: 'EVIL' }), 401));
t('rejects unverified e-mail', () => err(login('o212343@rguktong.ac.in', 'rguktong.ac.in', { verified: 'false' }), 401));
t('rejects expired token', () => err(login('o212343@rguktong.ac.in', 'rguktong.ac.in', { exp: '1000' }), 401));
t('rejects garbage token', () => err(env.call({ action: 'auth.login', payload: { idToken: 'x'.repeat(50) } }), 401));
t('rejects look-alike gmail o212343@gmail.com', () => err(login('o212343@gmail.com', ''), 403));
t('rejects student-pattern e-mail without Workspace hd claim', () => err(login('o212343@rguktong.ac.in', ''), 403));
t('rejects non-student staff e-mail in domain', () => err(login('someone@rguktong.ac.in'), 403));
t('rejects forged/absent session', () => { err(call('f'.repeat(64), 'config.get'), 401); err(call(undefined, 'config.get'), 401); err(call('../../x', 'config.get'), 401); });
t('unknown action and malformed body are rejected safely', () => { err(call(S, 'admin.hack'), 404); err(env.call('{not json'), 400); });

console.log('Role enforcement');
t('student cannot call admin or super actions', () => { err(call(S, 'admin.records'), 403); err(call(S, 'super.saveForm', { form: {} }), 403); err(call(S, 'super.users'), 403); });
t('admin cannot call super actions', () => { err(call(A, 'super.saveFaculty', { faculty: [] }), 403); err(call(A, 'super.saveAdmins', { admins: [] }), 403); err(call(A, 'super.deleteRecord', { id: 'x' }), 403); });
t('admins/super cannot submit as students', () => err(call(SU, 'student.save', {}), 403));
t('forbidden attempts are written to the audit log', () => {
  err(call(S, 'super.users'), 403);
  const rows = sheet('Audit').rows.filter(r => r[3] === 'access.denied');
  assert(rows.some(r => r[1] === 'o212343@rguktong.ac.in' && r[4] === 'super.users'));
});
t('oversized raw request is refused with 413', () => {
  const old = env.context.APP.MAX_REQUEST_CHARS; env.context.APP.MAX_REQUEST_CHARS = 1000;
  try { err(env.call({ action: 'config.get', session: S, payload: { x: 'a'.repeat(2000) } }), 413); } finally { env.context.APP.MAX_REQUEST_CHARS = old; }
});

console.log('Faculty & config');
t('super saves department-wise faculty; bad department rejected', () => {
  err(call(SU, 'super.saveFaculty', { faculty: [{ department: 'XYZ', name: 'Dr. A' }] }), 400);
  const f = ok(call(SU, 'super.saveFaculty', { faculty: [
    { department: 'CSE', name: 'Dr. A. Kumar', designation: 'Assistant Professor' },
    { department: 'CIVIL', name: 'Dr. B. Rao', designation: 'Associate Professor' },
    { department: 'ECE', name: '=HYPERLINK("http://evil")', designation: 'x' },
    { department: 'EEE', name: 'Dr. Inactive', active: false }] }));
  assert.strictEqual(f.length, 4);
});
t('config for students lists only active faculty', () => {
  const c = ok(call(S, 'config.get'));
  assert.strictEqual(c.faculty.length, 3); assert(c.form.categories.length === 4);
  assert.deepStrictEqual(c.form.categories.map(x => x.label), ['Minor Project', 'Major Project', 'Internship', 'Others']);
});

console.log('Student submissions');
const base = { title: 'Pavement crack detection using CNN', department: 'CSE', academic_year: '2025-26', semester: 'E3 Sem-2', abstract: 'Detects cracks.', start_date: '2025-07-01', end_date: '2025-11-01' };
let minorId, internId;
t('valid minor project saves with guide from faculty list', () => {
  const d = ok(call(S, 'student.save', { category: 'minor', data: { ...base, guide: { department: 'CSE', name: 'Dr. A. Kumar' }, domain: 'Artificial Intelligence / Machine Learning', project_status: 'Completed', hacker_field: 'dropped' } }));
  minorId = d.id; assert(/^PRJ-\d{6}-[A-Z0-9]{6}$/.test(d.id)); assert.strictEqual(d.status, 'Submitted');
  assert(!('hacker_field' in d.data), 'unknown fields must be dropped');
});
t('missing required fields → 422 with field names', () => {
  const e = err(call(S, 'student.save', { category: 'minor', data: { title: 'x' } }), 422);
  assert(/Your Department is required/.test(e) && /Project Guide/.test(e));
});
t('guide not in faculty list is rejected; inactive faculty rejected', () => {
  err(call(S, 'student.save', { category: 'minor', data: { ...base, guide: { department: 'CSE', name: 'Dr. Fake' }, domain: 'Other', project_status: 'Ongoing' } }), 422);
  err(call(S, 'student.save', { category: 'minor', data: { ...base, guide: { department: 'EEE', name: 'Dr. Inactive' }, domain: 'Other', project_status: 'Ongoing' } }), 422);
});
t('option outside the list is rejected', () => err(call(S, 'student.save', { category: 'minor', data: { ...base, academic_year: '1999', guide: { department: 'CSE', name: 'Dr. A. Kumar' }, domain: 'Other', project_status: 'Ongoing' } }), 422));
t('end date before start date is rejected', () => err(call(S, 'student.save', { category: 'minor', data: { ...base, end_date: '2024-01-01', guide: { department: 'CSE', name: 'Dr. A. Kumar' }, domain: 'Other', project_status: 'Ongoing' } }), 422));
const intern = { ...base, title: 'Summer internship at L&T', company: 'L&T Construction', org_type: 'Private Company (Indian)', location: 'Chennai', state_country: 'Tamil Nadu, India', mode: 'On-site', duration_weeks: 8 };
t('paid internship requires stipend (conditional field)', () => {
  const e = err(call(S, 'student.save', { category: 'internship', data: { ...intern, paid: 'Paid' } }), 422);
  assert(/Stipend/.test(e));
});
t('unpaid internship drops hidden stipend value; PDF upload stored in o21/O212343', () => {
  const d = ok(call(S, 'student.save', { category: 'internship', data: { ...intern, paid: 'Unpaid', stipend: 99999 }, files: [{ fieldId: 'report', name: 'certificate.pdf', mimeType: 'application/pdf', base64: PDF }] }));
  internId = d.id;
  assert(!('stipend' in d.data)); assert.strictEqual(d.files.report.name, 'certificate.pdf');
  assert(!d.files.report.url, 'students do not get Drive URLs');
  const stuFolder = [...env.drive.folders.values()].find(f => f.name === 'O212343');
  const file = [...env.drive.files.values()].find(f => f.parent === stuFolder.id && f.name === 'certificate.pdf');
  assert(file, 'file stored in student folder');
  assert.strictEqual(file.sharing, 'PRIVATE', 'uploaded file is private');
});
t('every allowed type is checked by its real content (magic bytes)', () => {
  let recId = null;
  const up = (name, mimeType, buf) => { const r = call(S, 'student.save', { id: recId || undefined, category: 'others', data: { ...base, title: 'Upload type check', other_type: 'Hackathon', organisation: 'SIH' }, files: [{ fieldId: 'report', name, mimeType, base64: buf.toString('base64') }] }); if (r.ok) recId = r.data.id; return r; };
  const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]);
  const JPG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46]);
  const OLE = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0]);
  const DOCX = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.from('....[Content_Types].xml....word/document.xml')]);
  const PPTX = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.from('....ppt/presentation.xml')]);
  const ZIP = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.from('readme.txt')]);
  const HTML = Buffer.from('<html><script>alert(1)</script></html>');
  ok(up('photo.png', 'image/png', PNG)); ok(up('scan.jpg', 'image/jpeg', JPG)); ok(up('old.doc', 'application/msword', OLE));
  ok(up('slides.ppt', 'application/vnd.ms-powerpoint', OLE));
  ok(up('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', DOCX));
  ok(up('deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', PPTX));
  ok(up('code.zip', 'application/zip', ZIP));
  err(up('x.jpg', 'image/jpeg', HTML), 422); err(up('x.png', 'image/png', JPG), 422);
  err(up('x.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ZIP), 422);
  err(up('x.doc', 'application/msword', ZIP), 422); err(up('x.zip', 'application/zip', HTML), 422);
  // file names are sanitised and the extension comes from the verified type, not the user's name
  const d = ok(up('../../evil<script>.php.png', 'image/png', PNG));
  assert(/^[A-Za-z0-9 _\-]+\.png$/.test(d.files.report.name), d.files.report.name);
  const replaced = [...env.drive.files.values()].filter(f => f.name === 'photo.png');
  assert(replaced.length === 1 && replaced[0].trashed, 'a replaced upload is moved to the bin');
  ok(call(S, 'student.delete', { id: recId }));
});
t('fake PDF, disallowed type and oversized file are rejected', () => {
  err(call(S, 'student.save', { category: 'internship', data: { ...intern, paid: 'Unpaid' }, files: [{ fieldId: 'report', name: 'x.pdf', mimeType: 'application/pdf', base64: Buffer.from('MZ-exe').toString('base64') }] }), 422);
  err(call(S, 'student.save', { category: 'internship', data: { ...intern, paid: 'Unpaid' }, files: [{ fieldId: 'report', name: 'x.exe', mimeType: 'application/x-msdownload', base64: PDF }] }), 422);
  err(call(S, 'student.save', { category: 'internship', data: { ...intern, paid: 'Unpaid' }, files: [{ fieldId: 'report', name: 'big.pdf', mimeType: 'application/pdf', base64: 'A'.repeat(15 * 1024 * 1024) }] }), 422);
});
t('formula injection in title is neutralised in the sheet', () => {
  ok(call(S, 'student.save', { category: 'others', data: { ...base, title: '=IMPORTXML("http://evil","//a")', other_type: 'Hackathon', organisation: 'SIH' } }));
  const rows = sheet('Projects').getRange(2, 11, sheet('Projects').getLastRow() - 1, 1).getValues().map(r => r[0]);
  assert(rows.includes('=IMPORTXML("http://evil","//a")'), 'stored as literal text');
  assert.strictEqual(env.context.safeCell_('=SUM(A1)'), "'=SUM(A1)"); assert.strictEqual(env.context.safeCell_('+91 9876'), "'+91 9876");
  assert.strictEqual(env.context.safeCell_('Normal title'), 'Normal title'); assert.strictEqual(env.context.unsafeCell_("'=x"), '=x'); assert.strictEqual(env.context.unsafeCell_("'quoted'"), "'quoted'");
});
t('student sees only own records', () => {
  ok(call(S2, 'student.save', { category: 'others', data: { ...base, title: 'Other student work', other_type: 'Competition', organisation: 'IEEE' } }));
  const mine = ok(call(S, 'student.list'));
  assert.strictEqual(mine.length, 3); assert(mine.every(r => r.studentId === 'O212343'));
});
t("student cannot edit or delete another student's record", () => {
  err(call(S2, 'student.save', { id: minorId, category: 'minor', data: base }), 404);
  err(call(S2, 'student.delete', { id: minorId }), 404);
});
t('student can edit own record; paid internship with stipend works', () => {
  const d = ok(call(S, 'student.save', { id: internId, category: 'internship', data: { ...intern, paid: 'Paid', stipend: 15000 } }));
  assert.strictEqual(d.data.stipend, 15000); assert.strictEqual(d.files.report.name, 'certificate.pdf', 'existing file kept');
});

console.log('Admin review');
t('admin sees all records with Drive links', () => {
  const r = ok(call(A, 'admin.records'));
  assert.strictEqual(r.records.length, 4);
  assert(r.records.find(x => x.id === internId).files.report.url.startsWith('https://drive.google.com/file/d/'));
});
t('admin verifies; verified record is locked for the student', () => {
  ok(call(A, 'admin.setStatus', { id: minorId, status: 'Verified', remark: 'OK' }));
  err(call(S, 'student.save', { id: minorId, category: 'minor', data: base }), 403);
  err(call(S, 'student.delete', { id: minorId }), 403);
  err(call(A, 'admin.setStatus', { id: minorId, status: 'Approved!!' }), 400);
});
t('needs-correction remark is visible to student', () => {
  ok(call(A, 'admin.setStatus', { id: internId, status: 'Needs Correction', remark: 'Upload signed certificate' }));
  assert.strictEqual(ok(call(S, 'student.list')).find(r => r.id === internId).remark, 'Upload signed certificate');
});

console.log('Super admin');
t('form builder: save new field, version increments; student sees it', () => {
  const c = ok(call(SU, 'config.get')).form;
  c.categories[2].fields.push({ id: 'company_website', label: 'Company website', type: 'url', required: false });
  const saved = ok(call(SU, 'super.saveForm', { form: c }));
  assert.strictEqual(saved.version, c.version + 1);
  assert(ok(call(S, 'config.get')).form.categories[2].fields.some(f => f.id === 'company_website'));
});
t('form builder rejects removing system fields, bad ids, dangling conditions', () => {
  const c = ok(call(SU, 'config.get')).form;
  const a = JSON.parse(JSON.stringify(c)); a.commonFields = a.commonFields.filter(f => f.id !== 'title'); err(call(SU, 'super.saveForm', { form: a }), 400);
  const b = JSON.parse(JSON.stringify(c)); b.categories[0].fields.push({ id: 'Bad Id!', label: 'x', type: 'text' }); err(call(SU, 'super.saveForm', { form: b }), 400);
  const d = JSON.parse(JSON.stringify(c)); d.categories[0].fields.push({ id: 'zz', label: 'x', type: 'text', showIf: { field: 'nope', equals: 'y' } }); err(call(SU, 'super.saveForm', { form: d }), 400);
  const e = JSON.parse(JSON.stringify(c)); e.categories[0].fields.push({ id: 'pick', label: 'x', type: 'select', options: [] }); err(call(SU, 'super.saveForm', { form: e }), 400);
});
t('blocking a student ends their session immediately', () => {
  ok(call(SU, 'super.setBlocked', { email: 'o262001@rguktong.ac.in', blocked: true }));
  err(call(S2, 'student.list'), 403);
  err(login('o262001@rguktong.ac.in'), 403);
  ok(call(SU, 'super.setBlocked', { email: 'o262001@rguktong.ac.in', blocked: false }));
  ok(login('o262001@rguktong.ac.in'));
});
t('super cannot be blocked or removed', () => {
  err(call(SU, 'super.setBlocked', { email: 'dataongole@gmail.com', blocked: true }), 400);
  const r = ok(call(SU, 'super.saveAdmins', { admins: ['dataongole@gmail.com', 'ao@rguktong.ac.in'] }));
  assert(!r.admins.includes('dataongole@gmail.com'));
});
t('removing an admin revokes their live session and Drive access', () => {
  ok(call(SU, 'super.saveAdmins', { admins: ['hod.cse@rguktong.ac.in'] }));
  err(call(A, 'admin.records'), 401);
  const root = env.drive.folders.get(env.props.ROOT_FOLDER_ID);
  assert(!root.viewers.includes('ao@rguktong.ac.in') && root.viewers.includes('hod.cse@rguktong.ac.in'));
  assert.strictEqual(ok(login('hod.cse@rguktong.ac.in')).user.role, 'admin', 'super admin can add an admin from the UI');
  ok(call(SU, 'super.saveAdmins', { admins: ['ao@rguktong.ac.in'] }));
  err(login('hod.cse@rguktong.ac.in'), 403);
});
t('settings: too-broad or invalid student pattern rejected; departments update', () => {
  err(call(SU, 'super.saveSettings', { studentPattern: '.*' }), 400);
  err(call(SU, 'super.saveSettings', { studentPattern: '^(.*$' }), 400);
  err(call(SU, 'super.saveSettings', { maxFileMB: 500 }), 400);
  const s = ok(call(SU, 'super.saveSettings', { departments: ['CSE', 'ECE', 'EEE', 'CIVIL', 'MECH', 'CHEM', 'MME', 'Maths'] }));
  assert(s.departments.includes('MATHS'));
});
t('old 6-digit pattern stored by an earlier version is upgraded automatically', () => {
  const row = sheet('Settings').rows.find(r => r[0] === 'STUDENT_PATTERN');
  const keep = row[1]; row[1] = '^o(\\d{2})\\d{4}@rguktong\\.ac\\.in$';
  assert.strictEqual(ok(login('o2499999@rguktong.ac.in')).user.batch, 'o24');
  row[1] = keep;
});
t('closing submissions blocks student saves', () => {
  ok(call(SU, 'super.saveSettings', { submissionsOpen: false }));
  err(call(S, 'student.save', { category: 'others', data: base }), 403);
  ok(call(SU, 'super.saveSettings', { submissionsOpen: true }));
});
t('users list, audit log and permanent delete', () => {
  const u = ok(call(SU, 'super.users'));
  assert(u.users.some(x => x.email === 'o212343@rguktong.ac.in' && x.loginCount >= 1));
  const a = ok(call(SU, 'super.audit'));
  assert(a.some(x => x.action === 'login.denied') && a.some(x => x.action === 'project.status'));
  ok(call(SU, 'super.deleteRecord', { id: internId }));
  assert(!ok(call(A = ok(login('ao@rguktong.ac.in')).session, 'admin.records')).records.some(r => r.id === internId));
  assert([...env.drive.files.values()].find(f => f.name === 'certificate.pdf').trashed);
});
t('logout destroys the session', () => { ok(call(S, 'auth.logout')); err(call(S, 'student.list'), 401); });
t('rate limit returns 429 after 120 requests/minute', () => {
  const s = ok(login('o222222@rguktong.ac.in')).session;
  let got429 = false;
  for (let i = 0; i < 130 && !got429; i++) { const r = call(s, 'config.get'); if (!r.ok && r.code === 429) got429 = true; }
  assert(got429);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
