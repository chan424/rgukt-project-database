/**
 * =====================================================================
 *  RGUKT Ongole Project Database
 *  Google Apps Script backend (deploy from the dataongole@gmail.com account)
 * =====================================================================
 *
 *  Storage (all inside the Drive of dataongole@gmail.com):
 *    RGUKT Ongole Project Database/              <- root folder
 *      RGUKT Ongole Project Database (Data)  (Google Sheet: Projects, Users, Faculty, Settings, Audit)
 *      o20/ o21/ o22/ ...                        <- one folder per batch (year)
 *        O212343/                                <- one folder per student (uploads)
 *
 *  Security model
 *    - The GitHub Pages frontend is public; NOTHING is trusted from it.
 *    - Users sign in with Google. The Google ID token is verified here
 *      (signature via Google's tokeninfo endpoint, audience = our OAuth
 *      client ID, issuer, expiry, verified e-mail, Workspace domain).
 *    - A random server-side session (CacheService, 6 h max) is issued.
 *    - The role is re-computed on EVERY request from the Settings sheet,
 *      so removing an admin or blocking a student takes effect immediately.
 *    - Students can only read/write their own records. All input is
 *      validated against the form definition; unknown fields are dropped.
 *    - Spreadsheet formula injection is neutralised; uploads are type/size
 *      checked; writes are serialised with LockService; every change is
 *      written to the Audit sheet; per-user rate limiting is applied.
 *
 *  One-time setup: see README.md (run setup(), set CLIENT_ID, deploy).
 * =====================================================================
 */

var APP = {
  NAME: 'RGUKT Ongole Project Database',
  VERSION: '1.1.0',
  SUPER_ADMIN: 'dataongole@gmail.com',
  DEFAULT_ADMINS: ['ao@rguktong.ac.in'],
  STUDENT_DOMAIN: 'rguktong.ac.in',
  // o + 6 or 7 digits, e.g. o212343 or o2123231. The first 3 characters (o21) are the batch.
  DEFAULT_STUDENT_PATTERN: '^o\\d{6,7}@rguktong\\.ac\\.in$',
  LEGACY_STUDENT_PATTERNS: ['^o(\\d{2})\\d{4}@rguktong\\.ac\\.in$'],
  DEFAULT_DEPARTMENTS: ['CSE', 'ECE', 'EEE', 'CIVIL', 'MECH', 'CHEM', 'MME'],
  ROOT_FOLDER_NAME: 'RGUKT Ongole Project Database',
  DB_NAME: 'RGUKT Ongole Project Database (Data)',
  SESSION_SECONDS: 6 * 60 * 60,        // CacheService maximum (absolute session lifetime)
  SESSION_IDLE_SECONDS: 60 * 60,       // signed out after 60 minutes without activity
  LOGIN_LIMIT_PER_MIN: 300,            // global cap on sign-in attempts (protects Google quotas)
  MAX_REQUEST_CHARS: 40 * 1024 * 1024, // hard cap on the raw request body
  RATE_LIMIT_PER_MIN: 120,
  MAX_FILE_MB_LIMIT: 25,
  ALLOWED_MIME: {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/zip': 'zip',
    'application/x-zip-compressed': 'zip',
    'image/png': 'png',
    'image/jpeg': 'jpg'
  },
  STATUSES: ['Submitted', 'Needs Correction', 'Verified', 'Rejected'],
  FIELD_TYPES: ['text', 'textarea', 'number', 'date', 'select', 'radio', 'url', 'department', 'faculty', 'file'],
  // Field ids the dashboard depends on: they cannot be deleted or renamed.
  SYSTEM_FIELDS: ['title', 'department', 'academic_year', 'guide', 'company', 'location', 'paid']
};

var SHEETS = {
  Projects: ['ProjectID', 'SubmittedAt', 'UpdatedAt', 'Email', 'StudentID', 'Batch', 'StudentName',
             'Category', 'Department', 'AcademicYear', 'Title', 'Status', 'Remark', 'ReviewedBy',
             'DataJSON', 'FilesJSON'],
  Users:    ['Email', 'Name', 'StudentID', 'Batch', 'Role', 'FirstLogin', 'LastLogin', 'LoginCount'],
  Faculty:  ['FacultyID', 'Department', 'Name', 'Designation', 'Email', 'Active'],
  Settings: ['Key', 'Value'],
  Audit:    ['Time', 'Email', 'Role', 'Action', 'Details']
};

/* =====================================================================
 *  HTTP entry points
 * ===================================================================== */

function doGet() {
  return json_({ ok: true, service: APP.NAME, version: APP.VERSION });
}

function doPost(e) {
  var out;
  try {
    if (!e || !e.postData || !e.postData.contents) throw appError_('Empty request', 400);
    if (e.postData.contents.length > APP.MAX_REQUEST_CHARS) throw appError_('Request is too large', 413);
    var req;
    try { req = JSON.parse(e.postData.contents); } catch (x) { throw appError_('Malformed request', 400); }
    if (!req || typeof req !== 'object' || Array.isArray(req)) throw appError_('Malformed request', 400);
    out = { ok: true, data: route_(req) };
  } catch (err) {
    if (err && err.isAppError) {
      out = { ok: false, error: err.message, code: err.code };
    } else {
      console.error(err && err.stack ? err.stack : err);
      out = { ok: false, error: 'Internal server error. Please try again.', code: 500 };
    }
  }
  return json_(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function appError_(msg, code) {
  var e = new Error(msg);
  e.isAppError = true;
  e.code = code || 400;
  return e;
}

/* =====================================================================
 *  Router
 * ===================================================================== */

var ROUTES = {
  'auth.login':         { role: null,      fn: login_ },
  'auth.logout':        { role: 'any',     fn: logout_ },
  'config.get':         { role: 'any',     fn: getConfig_ },

  'student.list':       { role: 'student', fn: studentList_ },
  'student.save':       { role: 'student', fn: studentSave_ },
  'student.delete':     { role: 'student', fn: studentDelete_ },

  'admin.records':      { role: 'admin',   fn: adminRecords_ },
  'admin.setStatus':    { role: 'admin',   fn: adminSetStatus_ },

  'super.saveForm':     { role: 'super',   fn: superSaveForm_ },
  'super.resetForm':    { role: 'super',   fn: superResetForm_ },
  'super.faculty':      { role: 'super',   fn: superFacultyList_ },
  'super.saveFaculty':  { role: 'super',   fn: superSaveFaculty_ },
  'super.users':        { role: 'super',   fn: superUsers_ },
  'super.saveAdmins':   { role: 'super',   fn: superSaveAdmins_ },
  'super.setBlocked':   { role: 'super',   fn: superSetBlocked_ },
  'super.settings':     { role: 'super',   fn: superSettings_ },
  'super.saveSettings': { role: 'super',   fn: superSaveSettings_ },
  'super.audit':        { role: 'super',   fn: superAudit_ },
  'super.createFolders':{ role: 'super',   fn: superCreateFolders_ },
  'super.deleteRecord': { role: 'super',   fn: superDeleteRecord_ }
};

function route_(req) {
  var action = String(req.action || '');
  var r = ROUTES.hasOwnProperty(action) ? ROUTES[action] : null;
  if (!r) throw appError_('Unknown action', 404);
  var payload = (req.payload && typeof req.payload === 'object') ? req.payload : {};

  if (r.role === null) return r.fn(payload);

  var user = requireSession_(req.session);
  rateLimit_(user.email);
  var denied = null;
  if (r.role === 'student' && user.role !== 'student') denied = 'Students only';
  if (r.role === 'admin' && user.role !== 'admin' && user.role !== 'super') denied = 'Administrators only';
  if (r.role === 'super' && user.role !== 'super') denied = 'Super administrator only';
  if (denied) {
    audit_(user.email, user.role, 'access.denied', action);
    throw appError_(denied, 403);
  }
  return r.fn(payload, user, req.session);
}

/* =====================================================================
 *  Authentication & sessions
 * ===================================================================== */

function verifyGoogleIdToken_(idToken) {
  var clientId = PropertiesService.getScriptProperties().getProperty('CLIENT_ID');
  if (!clientId) throw appError_('Server is not configured (CLIENT_ID missing). Contact the administrator.', 500);
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 4096) throw appError_('Invalid sign-in token', 401);

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
                              { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw appError_('Google sign-in could not be verified. Please sign in again.', 401);
  var p = JSON.parse(res.getContentText());

  if (p.aud !== clientId) throw appError_('Sign-in token was not issued for this application', 401);
  if (p.iss !== 'accounts.google.com' && p.iss !== 'https://accounts.google.com') throw appError_('Invalid token issuer', 401);
  if (String(p.email_verified) !== 'true') throw appError_('Google e-mail is not verified', 401);
  if (!(Number(p.exp) * 1000 > Date.now())) throw appError_('Sign-in expired. Please sign in again.', 401);
  if (p.iat && Number(p.iat) * 1000 > Date.now() + 5 * 60 * 1000) throw appError_('Invalid sign-in token', 401);
  var email = String(p.email || '').toLowerCase().trim();
  if (!isEmail_(email)) throw appError_('Invalid sign-in token', 401);

  return {
    email: email,
    name: String(p.name || '').slice(0, 120),
    picture: String(p.picture || '').slice(0, 500),
    hd: String(p.hd || '').toLowerCase()
  };
}

/**
 * Google's guidance: an e-mail address is only authoritative for the account if it is a
 * @gmail.com address, or the token carries a Workspace 'hd' claim equal to the address's domain.
 * This stops e.g. a personal Google account created with someone's college address.
 */
function emailIsAuthoritative_(email, hd) {
  var domain = String(email).split('@')[1] || '';
  if (domain === 'gmail.com') return true;
  return !!hd && hd === domain;
}

/** Works out the role for an e-mail against current settings. Returns null if not allowed. */
function resolveIdentity_(email, hd, settings) {
  email = String(email || '').toLowerCase();
  hd = String(hd || '').toLowerCase();
  if (!emailIsAuthoritative_(email, hd)) return null;
  if (email === APP.SUPER_ADMIN) return { role: 'super' };
  if (settings.ADMINS.indexOf(email) >= 0) return { role: 'admin' };
  var info = studentInfo_(email, hd, settings);
  if (info) return { role: 'student', studentId: info.studentId, batch: info.batch };
  return null;
}

/** Student ID and batch from an address such as o2123231@rguktong.ac.in -> O2123231 / o21. */
function studentInfo_(email, hd, settings) {
  if (hd !== APP.STUDENT_DOMAIN) return null;
  var parts = String(email).split('@');
  if (parts.length !== 2 || parts[1] !== APP.STUDENT_DOMAIN) return null;
  var re;
  try { re = new RegExp(settings.STUDENT_PATTERN, 'i'); } catch (e) { re = new RegExp(APP.DEFAULT_STUDENT_PATTERN, 'i'); }
  if (!re.test(email)) return null;
  var local = parts[0];
  if (!/^[a-z0-9]{4,20}$/i.test(local)) return null;
  var batch = local.slice(0, 3).toLowerCase();
  if (!/^[a-z]\d{2}$/.test(batch)) return null;          // batch folder name must look like o21
  return { studentId: local.toUpperCase(), batch: batch };
}

function login_(payload) {
  loginRateLimit_();
  var g = verifyGoogleIdToken_(payload.idToken);
  var settings = getSettings_();
  var id = resolveIdentity_(g.email, g.hd, settings);
  if (!id) {
    audit_(g.email, '-', 'login.denied', emailIsAuthoritative_(g.email, g.hd) ? 'Not a student/admin account' : 'E-mail not backed by Gmail/Workspace (hd=' + (g.hd || 'none') + ')');
    throw appError_('Access denied. Please sign in with your RGUKT Ongole student e-mail (e.g. o2123231@rguktong.ac.in).', 403);
  }
  if (id.role === 'student' && settings.BLOCKED.indexOf(g.email) >= 0) {
    audit_(g.email, 'student', 'login.blocked', '');
    throw appError_('Your account has been blocked. Contact the Academic Office.', 403);
  }
  rateLimit_(g.email);

  var token = newSessionToken_();
  var now = Date.now();
  var sess = { email: g.email, name: g.name, picture: g.picture, hd: g.hd, created: now, last: now };
  CacheService.getScriptCache().put(sessionKey_(token), JSON.stringify(sess), APP.SESSION_SECONDS);

  if (id.role === 'student') ensureStudentFolder_(id.batch, id.studentId);   // locked: safe on concurrent first sign-ins
  upsertUser_(g.email, g.name, id);
  audit_(g.email, id.role, 'login', '');

  return { session: token, expiresIn: APP.SESSION_SECONDS, user: publicUser_(sess, id) };
}

/**
 * Session tokens: 64 hex characters made from two random (v4) UUIDs = 244 random bits, mixed with
 * a per-deployment secret through HMAC-SHA256. Only a SHA-256 hash of the token is used as the cache
 * key, so the raw token never sits in server storage.
 */
function newSessionToken_() {
  var secret = sessionSecret_();
  var raw = Utilities.getUuid() + Utilities.getUuid() + Date.now();
  return hex_(Utilities.computeHmacSha256Signature(raw, secret));
}

function sessionSecret_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('SESSION_SECRET');
  if (!s) {
    s = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    p.setProperty('SESSION_SECRET', s);
  }
  return s;
}

function sessionKey_(token) {
  return 'sess_' + hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8));
}

function hex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) { var b = (bytes[i] + 256) % 256; out += (b < 16 ? '0' : '') + b.toString(16); }
  return out;
}

function requireSession_(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw appError_('Please sign in', 401);
  var cache = CacheService.getScriptCache();
  var key = sessionKey_(token);
  var raw = cache.get(key);
  if (!raw) throw appError_('Session expired. Please sign in again.', 401);
  var sess;
  try { sess = JSON.parse(raw); } catch (e) { cache.remove(key); throw appError_('Session expired. Please sign in again.', 401); }
  var now = Date.now();
  var age = now - Number(sess.created || 0);
  var idle = now - Number(sess.last || sess.created || 0);
  if (!(age >= 0 && age < APP.SESSION_SECONDS * 1000) || idle > APP.SESSION_IDLE_SECONDS * 1000) {
    cache.remove(key);
    throw appError_('Session expired. Please sign in again.', 401);
  }
  var settings = getSettings_();
  var id = resolveIdentity_(sess.email, sess.hd, settings);   // re-evaluated every request
  if (!id) { cache.remove(key); throw appError_('Access revoked', 401); }
  if (id.role === 'student' && settings.BLOCKED.indexOf(sess.email) >= 0) {
    cache.remove(key);
    throw appError_('Your account has been blocked. Contact the Academic Office.', 403);
  }
  // Sliding idle timeout (refreshed at most once a minute to save cache writes)
  if (idle > 60 * 1000) {
    sess.last = now;
    var remaining = Math.floor((APP.SESSION_SECONDS * 1000 - age) / 1000);
    if (remaining > 1) cache.put(key, JSON.stringify(sess), remaining);
  }
  return publicUser_(sess, id);
}

function publicUser_(sess, id) {
  return { email: sess.email, name: sess.name, picture: sess.picture, hd: sess.hd,
           role: id.role, studentId: id.studentId || '', batch: id.batch || '' };
}

function logout_(payload, user, token) {
  CacheService.getScriptCache().remove(sessionKey_(token));
  audit_(user.email, user.role, 'logout', '');
  return { done: true };
}

function rateLimit_(email) {
  var c = CacheService.getScriptCache();
  var key = 'rl_' + email + '_' + Math.floor(Date.now() / 60000);
  var n = Number(c.get(key) || 0) + 1;
  c.put(key, String(n), 120);
  if (n > APP.RATE_LIMIT_PER_MIN) throw appError_('Too many requests. Please wait a minute.', 429);
}

/** Sign-in happens before we know who the caller is, so it gets a global per-minute cap. */
function loginRateLimit_() {
  var c = CacheService.getScriptCache();
  var key = 'rl_login_' + Math.floor(Date.now() / 60000);
  var n = Number(c.get(key) || 0) + 1;
  c.put(key, String(n), 120);
  if (n > APP.LOGIN_LIMIT_PER_MIN) throw appError_('Too many sign-in attempts right now. Please wait a minute.', 429);
}

/* =====================================================================
 *  Configuration exposed to the client
 * ===================================================================== */

function getConfig_(payload, user) {
  var s = getSettings_();
  var faculty = readFaculty_().filter(function (f) { return f.active; })
                              .map(function (f) { return { department: f.department, name: f.name, designation: f.designation }; });
  return {
    form: s.FORM_CONFIG,
    departments: s.DEPARTMENTS,
    faculty: faculty,
    maxFileMB: s.MAX_FILE_MB,
    submissionsOpen: s.SUBMISSIONS_OPEN,
    statuses: APP.STATUSES,
    systemFields: APP.SYSTEM_FIELDS,
    fieldTypes: APP.FIELD_TYPES,
    allowedFileTypes: Object.keys(APP.ALLOWED_MIME).map(function (k) { return APP.ALLOWED_MIME[k]; })
                             .filter(function (v, i, a) { return a.indexOf(v) === i; }),
    user: user
  };
}

/* =====================================================================
 *  Student actions
 * ===================================================================== */

function studentList_(payload, user) {
  var rows = readProjects_().filter(function (r) { return r.email === user.email && r.status !== 'Deleted'; });
  rows.sort(function (a, b) { return b.submittedAt < a.submittedAt ? -1 : 1; });
  return rows.map(function (r) { return projectForClient_(r, false); });
}

function studentSave_(payload, user) {
  var s = getSettings_();
  if (!s.SUBMISSIONS_OPEN) throw appError_('Submissions are currently closed by the administrator.', 403);

  var form = s.FORM_CONFIG;
  var category = findCategory_(form, payload.category);
  if (!category) throw appError_('Please choose a valid project type', 400);
  var fields = form.commonFields.concat(category.fields);

  var data = (payload.data && typeof payload.data === 'object') ? payload.data : {};
  var uploads = Array.isArray(payload.files) ? payload.files : [];
  if (uploads.length > 5) throw appError_('Too many files in one submission', 400);
  var totalB64 = 0;
  uploads.forEach(function (u) { totalB64 += String((u && u.base64) || '').length; });
  if (totalB64 > Math.ceil(s.MAX_FILE_MB * 1024 * 1024 * 4 / 3) * 2 + 64) throw appError_('The attached files are too large in total', 413);

  lockAcquire_();
  try {
    var existing = null;
    if (payload.id) {
      existing = findProject_(String(payload.id));
      if (!existing || existing.email !== user.email || existing.status === 'Deleted') throw appError_('Record not found', 404);
      if (existing.status === 'Verified' || existing.status === 'Rejected') {
        throw appError_('This record is ' + existing.status.toLowerCase() + ' and can no longer be edited.', 403);
      }
    }
    var oldFiles = existing ? existing.files : {};
    var clean = validateData_(fields, data, s, uploads, oldFiles);

    // Store uploads in o21/O212343/
    var folder = ensureStudentFolder_(user.batch, user.studentId);
    var files = {};
    Object.keys(oldFiles).forEach(function (k) { files[k] = oldFiles[k]; });
    clean.uploads.forEach(function (u) {
      var blob = Utilities.newBlob(u.bytes, u.mimeType, u.name);
      var f = folder.createFile(blob);
      // Never link-shared: only the owner (dataongole@gmail.com) and the admins who were given
      // view access to the root folder can open it.
      try { f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (x) { console.warn('setSharing failed'); }
      try { f.setDescription('Uploaded by ' + user.email + ' for ' + (existing ? existing.id : 'new record')); } catch (x) {}
      if (files[u.fieldId]) { try { DriveApp.getFileById(files[u.fieldId].id).setTrashed(true); } catch (x) {} }
      files[u.fieldId] = { id: f.getId(), name: u.name, size: u.bytes.length, mimeType: u.mimeType };
    });
    // Remove files for file fields that are no longer visible
    Object.keys(files).forEach(function (k) {
      if (!clean.visibleFileFields[k]) {
        try { DriveApp.getFileById(files[k].id).setTrashed(true); } catch (x) {}
        delete files[k];
      }
    });

    var now = nowIso_();
    var rec = {
      id: existing ? existing.id : newProjectId_(),
      submittedAt: existing ? existing.submittedAt : now,
      updatedAt: now,
      email: user.email,
      studentId: user.studentId,
      batch: user.batch,
      studentName: user.name,
      category: category.id,
      department: String(clean.values.department || ''),
      academicYear: String(clean.values.academic_year || ''),
      title: String(clean.values.title || ''),
      status: 'Submitted',
      remark: existing ? existing.remark : '',
      reviewedBy: '',
      data: clean.values,
      files: files
    };
    writeProject_(rec, existing ? existing.row : null);
    audit_(user.email, 'student', existing ? 'project.update' : 'project.create', rec.id + ' ' + category.id);
    return projectForClient_(rec, false);
  } finally {
    lockRelease_();
  }
}

function studentDelete_(payload, user) {
  lockAcquire_();
  try {
    var rec = findProject_(String(payload.id || ''));
    if (!rec || rec.email !== user.email || rec.status === 'Deleted') throw appError_('Record not found', 404);
    if (rec.status === 'Verified') throw appError_('Verified records cannot be deleted. Contact the administrator.', 403);
    rec.status = 'Deleted';
    rec.updatedAt = nowIso_();
    writeProject_(rec, rec.row);          // soft delete: kept for audit
    audit_(user.email, 'student', 'project.delete', rec.id);
    return { done: true };
  } finally {
    lockRelease_();
  }
}

/* =====================================================================
 *  Admin actions
 * ===================================================================== */

function adminRecords_(payload, user) {
  var rows = readProjects_().filter(function (r) { return r.status !== 'Deleted'; });
  return { records: rows.map(function (r) { return projectForClient_(r, true); }), generatedAt: new Date().toISOString() };
}

function adminSetStatus_(payload, user) {
  var status = String(payload.status || '');
  if (APP.STATUSES.indexOf(status) < 0) throw appError_('Invalid status', 400);
  var remark = cleanText_(payload.remark, 500);
  lockAcquire_();
  try {
    var rec = findProject_(String(payload.id || ''));
    if (!rec || rec.status === 'Deleted') throw appError_('Record not found', 404);
    rec.status = status;
    rec.remark = remark;
    rec.reviewedBy = user.email;
    rec.updatedAt = nowIso_();
    writeProject_(rec, rec.row);
    audit_(user.email, user.role, 'project.status', rec.id + ' -> ' + status);
    return projectForClient_(rec, true);
  } finally {
    lockRelease_();
  }
}

/* =====================================================================
 *  Super-admin actions (dataongole@gmail.com only)
 * ===================================================================== */

function superSaveForm_(payload, user) {
  var cfg = validateFormConfig_(payload.form);
  setSetting_('FORM_CONFIG', JSON.stringify(cfg));
  audit_(user.email, 'super', 'form.save', 'version ' + cfg.version);
  return cfg;
}

function superResetForm_(payload, user) {
  var cfg = defaultFormConfig_();
  setSetting_('FORM_CONFIG', JSON.stringify(cfg));
  audit_(user.email, 'super', 'form.reset', '');
  return cfg;
}

function superFacultyList_() {
  return readFaculty_();
}

function superSaveFaculty_(payload, user) {
  var list = Array.isArray(payload.faculty) ? payload.faculty : null;
  if (!list) throw appError_('Faculty list missing', 400);
  if (list.length > 3000) throw appError_('Too many faculty entries', 400);
  var depts = getSettings_().DEPARTMENTS;
  var seen = {};
  var rows = list.map(function (f, i) {
    var dept = cleanText_(f.department, 40).toUpperCase();
    var name = cleanText_(f.name, 120);
    if (!name) throw appError_('Row ' + (i + 1) + ': faculty name is required', 400);
    if (depts.indexOf(dept) < 0) throw appError_('Row ' + (i + 1) + ': unknown department "' + dept + '"', 400);
    var key = dept + '|' + name.toLowerCase();
    if (seen[key]) throw appError_('Duplicate faculty: ' + name + ' (' + dept + ')', 400);
    seen[key] = true;
    var email = cleanText_(f.email, 120).toLowerCase();
    if (email && !isEmail_(email)) throw appError_('Row ' + (i + 1) + ': invalid e-mail', 400);
    return [cleanText_(f.id, 20) || ('F' + (1000 + i)), dept, name, cleanText_(f.designation, 80), email, f.active === false ? 'No' : 'Yes'];
  });
  lockAcquire_();
  try {
    var sh = sheet_('Faculty');
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, SHEETS.Faculty.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, SHEETS.Faculty.length).setValues(rows.map(function (r) { return r.map(safeCell_); }));
  } finally {
    lockRelease_();
  }
  audit_(user.email, 'super', 'faculty.save', rows.length + ' entries');
  return readFaculty_();
}

function superUsers_() {
  var s = getSettings_();
  var sh = sheet_('Users');
  var vals = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, SHEETS.Users.length).getValues() : [];
  var users = vals.map(function (r) {
    return { email: r[0], name: r[1], studentId: r[2], batch: r[3], role: r[4],
             firstLogin: iso_(r[5]), lastLogin: iso_(r[6]), loginCount: Number(r[7]) || 0,
             blocked: s.BLOCKED.indexOf(String(r[0])) >= 0 };
  });
  return { users: users, admins: s.ADMINS, superAdmin: APP.SUPER_ADMIN, blocked: s.BLOCKED };
}

function superSaveAdmins_(payload, user) {
  var list = Array.isArray(payload.admins) ? payload.admins : null;
  if (!list) throw appError_('Admin list missing', 400);
  var clean = [];
  list.forEach(function (e) {
    var em = cleanText_(e, 120).toLowerCase();
    if (!em) return;
    if (!isEmail_(em)) throw appError_('Invalid e-mail: ' + em, 400);
    if (em === APP.SUPER_ADMIN) return;          // super admin is permanent, not stored
    if (clean.indexOf(em) < 0) clean.push(em);
  });
  if (clean.length > 25) throw appError_('Too many administrators', 400);
  var before = getSettings_().ADMINS;
  setSetting_('ADMINS', JSON.stringify(clean));
  syncAdminFolderAccess_(before, clean);
  audit_(user.email, 'super', 'admins.save', clean.join(', '));
  return { admins: clean };
}

function superSetBlocked_(payload, user) {
  var email = cleanText_(payload.email, 120).toLowerCase();
  if (!isEmail_(email)) throw appError_('Invalid e-mail', 400);
  if (email === APP.SUPER_ADMIN) throw appError_('The super administrator cannot be blocked', 400);
  var list = getSettings_().BLOCKED.filter(function (e) { return e !== email; });
  if (payload.blocked) list.push(email);
  setSetting_('BLOCKED', JSON.stringify(list));
  audit_(user.email, 'super', payload.blocked ? 'user.block' : 'user.unblock', email);
  return { blocked: list };
}

function superSaveSettings_(payload, user) {
  var s = getSettings_();
  if (payload.departments !== undefined) {
    if (!Array.isArray(payload.departments)) throw appError_('Departments must be a list', 400);
    var d = [];
    payload.departments.forEach(function (x) {
      var v = cleanText_(x, 40).toUpperCase();
      if (!v) return;
      if (!/^[A-Z0-9&.\- ]{2,40}$/.test(v)) throw appError_('Invalid department code: ' + v, 400);
      if (d.indexOf(v) < 0) d.push(v);
    });
    if (!d.length) throw appError_('At least one department is required', 400);
    setSetting_('DEPARTMENTS', JSON.stringify(d));
  }
  if (payload.studentPattern !== undefined) {
    var pat = String(payload.studentPattern).trim();
    var re;
    try { re = new RegExp(pat, 'i'); } catch (x) { throw appError_('Student e-mail pattern is not a valid regular expression', 400); }
    if (pat.charAt(0) !== '^' || pat.slice(-1) !== '$') throw appError_('Pattern must start with ^ and end with $', 400);
    if (pat.indexOf('@rguktong') < 0) throw appError_('Pattern must be restricted to the @rguktong.ac.in domain', 400);
    if (re.test(APP.SUPER_ADMIN)) throw appError_('Pattern is too broad', 400);
    setSetting_('STUDENT_PATTERN', pat);
  }
  if (payload.maxFileMB !== undefined) {
    var mb = Number(payload.maxFileMB);
    if (!(mb >= 1 && mb <= APP.MAX_FILE_MB_LIMIT)) throw appError_('Max file size must be 1–' + APP.MAX_FILE_MB_LIMIT + ' MB', 400);
    setSetting_('MAX_FILE_MB', String(Math.round(mb)));
  }
  if (payload.submissionsOpen !== undefined) setSetting_('SUBMISSIONS_OPEN', payload.submissionsOpen ? 'TRUE' : 'FALSE');
  audit_(user.email, 'super', 'settings.save', Object.keys(payload).join(','));
  return superSettings_();
}

function superSettings_() {
  var n = getSettings_(true);
  return { departments: n.DEPARTMENTS, studentPattern: n.STUDENT_PATTERN, maxFileMB: n.MAX_FILE_MB,
           submissionsOpen: n.SUBMISSIONS_OPEN, rootFolderUrl: rootFolder_().getUrl(),
           databaseUrl: SpreadsheetApp.openById(prop_('DB_ID')).getUrl(), batchFolders: n.BATCH_FOLDERS };
}

function superAudit_(payload) {
  var sh = sheet_('Audit');
  var last = sh.getLastRow();
  if (last < 2) return [];
  var n = Math.min(500, last - 1);
  var vals = sh.getRange(last - n + 1, 1, n, SHEETS.Audit.length).getValues();
  return vals.reverse().map(function (r) { return { time: iso_(r[0]), email: r[1], role: r[2], action: r[3], details: r[4] }; });
}

function superCreateFolders_(payload, user) {
  var list = Array.isArray(payload.batches) ? payload.batches : [];
  var made = [];
  list.forEach(function (b) {
    var v = String(b || '').trim().toLowerCase();
    if (!/^[a-z]\d{2}$/.test(v)) throw appError_('Batch code must look like o21', 400);
    ensureBatchFolder_(v);
    made.push(v);
  });
  audit_(user.email, 'super', 'folders.create', made.join(','));
  return { batchFolders: getSettings_(true).BATCH_FOLDERS };
}

function superDeleteRecord_(payload, user) {
  lockAcquire_();
  try {
    var rec = findProject_(String(payload.id || ''));
    if (!rec) throw appError_('Record not found', 404);
    Object.keys(rec.files).forEach(function (k) { try { DriveApp.getFileById(rec.files[k].id).setTrashed(true); } catch (x) {} });
    sheet_('Projects').deleteRow(rec.row);
    audit_(user.email, 'super', 'project.purge', rec.id + ' (' + rec.studentId + ')');
    return { done: true };
  } finally {
    lockRelease_();
  }
}

/* =====================================================================
 *  Validation
 * ===================================================================== */

function findCategory_(form, id) {
  for (var i = 0; i < form.categories.length; i++) if (form.categories[i].id === id) return form.categories[i];
  return null;
}

function isVisible_(field, values) {
  if (!field.showIf || !field.showIf.field) return true;
  var v = values[field.showIf.field];
  return String(v === undefined ? '' : v) === String(field.showIf.equals);
}

function validateData_(fields, data, settings, uploads, oldFiles) {
  var values = {};
  var errors = [];
  var facultyIndex = {};
  readFaculty_().forEach(function (f) { if (f.active) facultyIndex[f.department + '|' + f.name] = true; });

  // Pass 1: everything except visibility-dependent checks (showIf refers to earlier values)
  fields.forEach(function (f) {
    if (f.type === 'file') return;
    var raw = data[f.id];
    var v = null;
    switch (f.type) {
      case 'text':     v = cleanText_(raw, f.maxLength || 300); break;
      case 'textarea': v = cleanMultiline_(raw, f.maxLength || 5000); break;
      case 'url':
        v = cleanText_(raw, 500);
        if (v && !/^https?:\/\/[^\s<>"']+$/i.test(v)) errors.push(f.label + ': enter a valid http(s) link');
        break;
      case 'number':
        if (raw === '' || raw === null || raw === undefined) { v = ''; break; }
        v = Number(raw);
        if (!isFinite(v)) { errors.push(f.label + ': must be a number'); v = ''; break; }
        if (f.min !== undefined && f.min !== '' && v < Number(f.min)) errors.push(f.label + ': minimum ' + f.min);
        if (f.max !== undefined && f.max !== '' && v > Number(f.max)) errors.push(f.label + ': maximum ' + f.max);
        break;
      case 'date':
        v = cleanText_(raw, 10);
        if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(f.label + ': invalid date');
        break;
      case 'select':
      case 'radio':
        v = cleanText_(raw, 200);
        if (v && (f.options || []).indexOf(v) < 0) errors.push(f.label + ': choose a listed option');
        break;
      case 'department':
        v = cleanText_(raw, 40);
        if (v && settings.DEPARTMENTS.indexOf(v) < 0) errors.push(f.label + ': choose a listed department');
        break;
      case 'faculty':
        var o = (raw && typeof raw === 'object') ? raw : {};
        var dept = cleanText_(o.department, 40), name = cleanText_(o.name, 120), other = o.other === true;
        if (!dept && !name) { v = ''; break; }
        if (settings.DEPARTMENTS.indexOf(dept) < 0) { errors.push(f.label + ': choose a department'); v = ''; break; }
        if (!name) { errors.push(f.label + ': choose a faculty member'); v = ''; break; }
        if (!other && !facultyIndex[dept + '|' + name]) { errors.push(f.label + ': faculty not found in list'); v = ''; break; }
        if (other && !f.allowOther) { errors.push(f.label + ': choose from the list'); v = ''; break; }
        v = { department: dept, name: name, other: other };
        break;
    }
    values[f.id] = v;
  });

  // Pass 2: visibility and required checks; drop hidden values
  var visibleFileFields = {};
  var cleanUploads = [];
  var maxBytes = settings.MAX_FILE_MB * 1024 * 1024;
  fields.forEach(function (f) {
    var visible = isVisible_(f, values);
    if (f.type === 'file') {
      if (!visible) return;
      visibleFileFields[f.id] = true;
      var up = null;
      uploads.forEach(function (u) { if (u && u.fieldId === f.id) up = u; });
      if (up) {
        var mime = String(up.mimeType || '');
        if (!APP.ALLOWED_MIME[mime]) { errors.push(f.label + ': file type not allowed'); return; }
        var b64 = String(up.base64 || '');
        if (b64.length > Math.ceil(maxBytes * 4 / 3) + 16) { errors.push(f.label + ': file exceeds ' + settings.MAX_FILE_MB + ' MB'); return; }
        var bytes;
        try { bytes = Utilities.base64Decode(b64); } catch (x) { errors.push(f.label + ': file is corrupt'); return; }
        if (!bytes.length) { errors.push(f.label + ': file is empty'); return; }
        if (bytes.length > maxBytes) { errors.push(f.label + ': file exceeds ' + settings.MAX_FILE_MB + ' MB'); return; }
        var ext = APP.ALLOWED_MIME[mime];
        if (!contentMatchesType_(bytes, ext)) { errors.push(f.label + ': the file content is not a valid ' + ext.toUpperCase() + ' file'); return; }
        var base = cleanText_(up.name, 100).replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9 _\-]/g, '_') || 'file';
        cleanUploads.push({ fieldId: f.id, mimeType: mime, bytes: bytes, name: base + '.' + ext });
      } else if (f.required && !(oldFiles && oldFiles[f.id])) {
        errors.push(f.label + ': please upload a file');
      }
      return;
    }
    if (!visible) { delete values[f.id]; return; }
    var v = values[f.id];
    if (f.required && (v === '' || v === null || v === undefined)) errors.push(f.label + ' is required');
  });

  // Logical date check
  if (values.start_date && values.end_date && values.end_date < values.start_date) errors.push('End date cannot be before start date');

  if (errors.length) throw appError_('Please correct the following:\n• ' + errors.slice(0, 12).join('\n• '), 422);
  return { values: values, uploads: cleanUploads, visibleFileFields: visibleFileFields };
}

function startsWith_(bytes, sig) {
  if (bytes.length < sig.length) return false;
  for (var i = 0; i < sig.length; i++) if (((bytes[i] + 256) % 256) !== sig[i]) return false;
  return true;
}

/** True if the ASCII text occurs anywhere in the bytes (used to look inside ZIP-based Office files). */
function bytesContain_(bytes, text) {
  var n = text.length, first = text.charCodeAt(0);
  outer: for (var i = 0; i + n <= bytes.length; i++) {
    if (((bytes[i] + 256) % 256) !== first) continue;
    for (var j = 1; j < n; j++) if (((bytes[i + j] + 256) % 256) !== text.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
}

/**
 * Checks the file's real content ("magic bytes"), so a renamed .exe or HTML page cannot be
 * uploaded under an allowed type. The browser-supplied MIME type is never trusted on its own.
 */
function contentMatchesType_(bytes, ext) {
  var ZIP = [0x50, 0x4B, 0x03, 0x04], OLE = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  switch (ext) {
    case 'pdf':  return startsWith_(bytes, [0x25, 0x50, 0x44, 0x46, 0x2D]);                 // %PDF-
    case 'png':  return startsWith_(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    case 'jpg':  return startsWith_(bytes, [0xFF, 0xD8, 0xFF]);
    case 'doc':
    case 'ppt':  return startsWith_(bytes, OLE);
    case 'docx': return startsWith_(bytes, ZIP) && bytesContain_(bytes, 'word/');
    case 'pptx': return startsWith_(bytes, ZIP) && bytesContain_(bytes, 'ppt/');
    case 'zip':  return startsWith_(bytes, ZIP) || startsWith_(bytes, [0x50, 0x4B, 0x05, 0x06]);
  }
  return false;
}

function validateFormConfig_(cfg) {
  if (!cfg || typeof cfg !== 'object') throw appError_('Form definition missing', 400);
  var idRe = /^[a-z][a-z0-9_]{0,39}$/;
  function cleanField(f, where) {
    if (!f || typeof f !== 'object') throw appError_('Invalid field in ' + where, 400);
    var id = String(f.id || '');
    if (!idRe.test(id)) throw appError_('Field id "' + id + '" in ' + where + ' must be lower-case letters, digits or _', 400);
    var type = String(f.type || '');
    if (APP.FIELD_TYPES.indexOf(type) < 0) throw appError_('Field "' + id + '": unknown type', 400);
    var label = cleanText_(f.label, 120);
    if (!label) throw appError_('Field "' + id + '": label is required', 400);
    var out = { id: id, label: label, type: type, required: f.required === true };
    var help = cleanText_(f.help, 300); if (help) out.help = help;
    var ph = cleanText_(f.placeholder, 120); if (ph) out.placeholder = ph;
    if (type === 'select' || type === 'radio') {
      var opts = (Array.isArray(f.options) ? f.options : []).map(function (o) { return cleanText_(o, 200); }).filter(String);
      if (!opts.length) throw appError_('Field "' + label + '" needs at least one option', 400);
      if (opts.length > 100) throw appError_('Field "' + label + '" has too many options', 400);
      out.options = opts.filter(function (v, i, a) { return a.indexOf(v) === i; });
    }
    if (type === 'number') {
      if (f.min !== undefined && f.min !== '' && isFinite(Number(f.min))) out.min = Number(f.min);
      if (f.max !== undefined && f.max !== '' && isFinite(Number(f.max))) out.max = Number(f.max);
    }
    if ((type === 'text' || type === 'textarea') && f.maxLength) {
      out.maxLength = Math.max(10, Math.min(type === 'text' ? 500 : 10000, Number(f.maxLength) || 0));
    }
    if (type === 'faculty') out.allowOther = f.allowOther === true;
    if (f.showIf && f.showIf.field) {
      var sf = String(f.showIf.field);
      if (!idRe.test(sf)) throw appError_('Field "' + label + '": invalid condition', 400);
      out.showIf = { field: sf, equals: cleanText_(f.showIf.equals, 200) };
    }
    return out;
  }
  var common = (Array.isArray(cfg.commonFields) ? cfg.commonFields : []).map(function (f) { return cleanField(f, 'General details'); });
  var cats = Array.isArray(cfg.categories) ? cfg.categories : [];
  if (!cats.length || cats.length > 12) throw appError_('Between 1 and 12 project types are required', 400);
  var catIds = {};
  var categories = cats.map(function (c) {
    var id = String(c.id || '');
    if (!idRe.test(id)) throw appError_('Project type id "' + id + '" is invalid', 400);
    if (catIds[id]) throw appError_('Duplicate project type id ' + id, 400);
    catIds[id] = true;
    var label = cleanText_(c.label, 80);
    if (!label) throw appError_('Project type label is required', 400);
    var fields = (Array.isArray(c.fields) ? c.fields : []).map(function (f) { return cleanField(f, label); });
    var all = common.concat(fields);
    if (all.length > 60) throw appError_(label + ': too many fields', 400);
    var seen = {};
    all.forEach(function (f, i) {
      if (seen[f.id]) throw appError_('Duplicate field id "' + f.id + '" in ' + label, 400);
      seen[f.id] = true;
      if (f.showIf) {
        var target = null;
        for (var j = 0; j < i; j++) if (all[j].id === f.showIf.field) target = all[j];
        if (!target) throw appError_('Field "' + f.label + '": condition must refer to a field placed above it', 400);
      }
    });
    return { id: id, label: label, fields: fields };
  });
  ['title', 'department', 'academic_year'].forEach(function (k) {
    if (!common.some(function (f) { return f.id === k; })) throw appError_('System field "' + k + '" must remain in General details', 400);
  });
  return { version: (Number(cfg.version) || 0) + 1, updatedAt: new Date().toISOString(), commonFields: common, categories: categories };
}

/* =====================================================================
 *  Helpers: text, cells, ids
 * ===================================================================== */

function cleanText_(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 300);
}

function cleanMultiline_(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max || 5000);
}

/** Prevents spreadsheet formula injection (=, +, -, @ at start). */
function safeCell_(v) {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

function unsafeCell_(v) {
  return (typeof v === 'string' && /^'[=+\-@\t\r]/.test(v)) ? v.slice(1) : v;
}

function isEmail_(e) {
  return /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(e);
}

function iso_(d) {
  if (d instanceof Date) return Utilities.formatDate(d, 'Asia/Kolkata', "yyyy-MM-dd'T'HH:mm:ssXXX");
  return d ? String(d) : '';
}

/** Timestamps are stored as IST ISO-8601 text, e.g. 2026-11-20T23:44:10+05:30 */
function nowIso_() {
  return iso_(new Date());
}

function newProjectId_() {
  var d = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyMMdd');
  return 'PRJ-' + d + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
}

function prop_(k) {
  return PropertiesService.getScriptProperties().getProperty(k);
}

/* =====================================================================
 *  Spreadsheet access
 * ===================================================================== */

var _ss = null;
function ss_() {
  if (_ss) return _ss;
  var id = prop_('DB_ID');
  if (!id) throw appError_('Server is not set up yet. Run setup() in Apps Script.', 500);
  _ss = SpreadsheetApp.openById(id);
  return _ss;
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw appError_('Database sheet "' + name + '" missing. Run setup() again.', 500);
  return sh;
}

var _settings = null;
function getSettings_(fresh) {
  if (_settings && !fresh) return _settings;
  var sh = sheet_('Settings');
  var vals = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues() : [];
  var map = {};
  vals.forEach(function (r) { map[String(r[0])] = unsafeCell_(r[1]); });
  function j(k, def) { try { return map[k] ? JSON.parse(map[k]) : def; } catch (e) { return def; } }
  _settings = {
    FORM_CONFIG: j('FORM_CONFIG', null) || defaultFormConfig_(),
    DEPARTMENTS: j('DEPARTMENTS', APP.DEFAULT_DEPARTMENTS),
    ADMINS: j('ADMINS', APP.DEFAULT_ADMINS).map(function (e) { return String(e).toLowerCase(); }),
    BLOCKED: j('BLOCKED', []).map(function (e) { return String(e).toLowerCase(); }),
    BATCH_FOLDERS: j('BATCH_FOLDERS', {}),
    // Old installations stored the earlier 6-digit default: upgrade it transparently
    STUDENT_PATTERN: (!map.STUDENT_PATTERN || APP.LEGACY_STUDENT_PATTERNS.indexOf(String(map.STUDENT_PATTERN)) >= 0)
                     ? APP.DEFAULT_STUDENT_PATTERN : String(map.STUDENT_PATTERN),
    MAX_FILE_MB: Number(map.MAX_FILE_MB) || 10,
    SUBMISSIONS_OPEN: String(map.SUBMISSIONS_OPEN || 'TRUE').toUpperCase() !== 'FALSE'
  };
  return _settings;
}

function setSetting_(key, value) {
  lockAcquire_();
  try { setSettingUnlocked_(key, value); } finally { lockRelease_(); }
}

function setSettingUnlocked_(key, value) {
  var sh = sheet_('Settings');
  var last = sh.getLastRow();
  var keys = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === key) {
      sh.getRange(i + 2, 2, 1, 1).setValues([[safeCell_(value)]]);
      _settings = null;
      return;
    }
  }
  sh.appendRow([key, safeCell_(value)]);
  _settings = null;
}

function readProjects_() {
  var sh = sheet_('Projects');
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, SHEETS.Projects.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (!r[0]) continue;
    out.push(rowToProject_(r, i + 2));
  }
  return out;
}

function rowToProject_(r, row) {
  var data = {}, files = {};
  try { data = JSON.parse(unsafeCell_(r[14]) || '{}'); } catch (e) {}
  try { files = JSON.parse(unsafeCell_(r[15]) || '{}'); } catch (e) {}
  return {
    row: row, id: String(r[0]), submittedAt: r[1], updatedAt: r[2], email: String(r[3]).toLowerCase(),
    studentId: String(r[4]), batch: String(r[5]), studentName: String(unsafeCell_(r[6])), category: String(r[7]),
    department: String(r[8]), academicYear: String(r[9]), title: String(unsafeCell_(r[10])), status: String(r[11]),
    remark: String(unsafeCell_(r[12])), reviewedBy: String(r[13]), data: data, files: files
  };
}

function findProject_(id) {
  if (!/^PRJ-[0-9]{6}-[A-Z0-9]{6}$/.test(id)) return null;
  var sh = sheet_('Projects');
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) {
      return rowToProject_(sh.getRange(i + 2, 1, 1, SHEETS.Projects.length).getValues()[0], i + 2);
    }
  }
  return null;
}

function writeProject_(p, row) {
  var vals = [p.id, p.submittedAt, p.updatedAt, p.email, p.studentId, p.batch, p.studentName, p.category,
              p.department, p.academicYear, p.title, p.status, p.remark, p.reviewedBy,
              JSON.stringify(p.data), JSON.stringify(p.files)].map(safeCell_);
  var sh = sheet_('Projects');
  if (row) sh.getRange(row, 1, 1, vals.length).setValues([vals]);
  else sh.appendRow(vals);
}

function projectForClient_(p, forAdmin) {
  var files = {};
  Object.keys(p.files || {}).forEach(function (k) {
    var f = p.files[k];
    files[k] = { name: f.name, size: f.size, mimeType: f.mimeType };
    if (forAdmin) files[k].url = 'https://drive.google.com/file/d/' + encodeURIComponent(f.id) + '/view';
  });
  var out = {
    id: p.id, submittedAt: iso_(p.submittedAt), updatedAt: iso_(p.updatedAt), category: p.category,
    department: p.department, academicYear: p.academicYear, title: p.title, status: p.status,
    remark: p.remark, data: p.data, files: files, batch: p.batch, studentId: p.studentId
  };
  if (forAdmin) { out.email = p.email; out.studentName = p.studentName; out.reviewedBy = p.reviewedBy; }
  return out;
}

function readFaculty_() {
  var sh = sheet_('Faculty');
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, SHEETS.Faculty.length).getValues()
    .filter(function (r) { return r[2]; })
    .map(function (r) {
      return { id: String(r[0]), department: String(r[1]), name: String(unsafeCell_(r[2])), designation: String(unsafeCell_(r[3])),
               email: String(r[4]), active: String(r[5]).toLowerCase() !== 'no' };
    });
}

function upsertUser_(email, name, id) {
  lockAcquire_();
  try {
    var sh = sheet_('Users');
    var last = sh.getLastRow();
    var emails = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
    var now = nowIso_();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i][0]).toLowerCase() === email) {
        var r = sh.getRange(i + 2, 1, 1, SHEETS.Users.length).getValues()[0];
        sh.getRange(i + 2, 1, 1, SHEETS.Users.length).setValues([[email, safeCell_(name), id.studentId || '', id.batch || '', id.role, r[5], now, (Number(r[7]) || 0) + 1]]);
        return;
      }
    }
    sh.appendRow([email, safeCell_(name), id.studentId || '', id.batch || '', id.role, now, now, 1]);
  } finally {
    lockRelease_();
  }
}

function audit_(email, role, action, details) {
  try {
    sheet_('Audit').appendRow([nowIso_(), email, role, action, safeCell_(String(details || '').slice(0, 500))]);
  } catch (e) { console.error('audit failed', e); }
}

/* =====================================================================
 *  Drive folders
 * ===================================================================== */

function rootFolder_() {
  var id = prop_('ROOT_FOLDER_ID');
  if (!id) throw appError_('Server is not set up yet. Run setup() in Apps Script.', 500);
  return DriveApp.getFolderById(id);
}

/**
 * Returns the Drive folder for a batch (o21, o22, …), creating it on first use.
 * Runs under the script lock and re-reads the settings inside it, so two students of a new
 * batch signing in at the same moment cannot create two "o27" folders.
 */
function ensureBatchFolder_(batch) {
  batch = String(batch || '').toLowerCase();
  if (!/^[a-z]\d{2}$/.test(batch)) throw appError_('Invalid batch code', 400);
  var cached = getSettings_().BATCH_FOLDERS[batch];
  if (cached) {
    try { var f0 = DriveApp.getFolderById(cached); if (!f0.isTrashed || !f0.isTrashed()) return f0; } catch (e) { /* deleted manually: recreate */ }
  }
  lockAcquire_();
  try {
    var map = getSettings_(true).BATCH_FOLDERS;          // fresh read inside the lock
    if (map[batch] && map[batch] !== cached) {
      try { var f1 = DriveApp.getFolderById(map[batch]); if (!f1.isTrashed || !f1.isTrashed()) return f1; } catch (e) { /* recreate */ }
    }
    var root = rootFolder_();
    var it = root.getFoldersByName(batch);
    var folder = it.hasNext() ? it.next() : root.createFolder(batch);
    map[batch] = folder.getId();
    setSetting_('BATCH_FOLDERS', JSON.stringify(map));
    return folder;
  } finally {
    lockRelease_();
  }
}

/** Per-student upload folder inside the batch folder, e.g. o21/O2123231/. */
function ensureStudentFolder_(batch, studentId) {
  studentId = String(studentId || '').toUpperCase();
  if (!/^[A-Z0-9]{4,20}$/.test(studentId)) throw appError_('Invalid student ID', 400);
  lockAcquire_();
  try {
    var b = ensureBatchFolder_(batch);
    var it = b.getFoldersByName(studentId);
    return it.hasNext() ? it.next() : b.createFolder(studentId);
  } finally {
    lockRelease_();
  }
}

/* Re-entrant wrapper around the script lock: nested helpers (e.g. creating a student folder while a
 * submission is being saved) share the lock instead of deadlocking or releasing it early. */
var _lock = null, _lockDepth = 0;
function lockAcquire_() {
  if (_lockDepth === 0) {
    var l = LockService.getScriptLock();
    try { l.waitLock(30000); } catch (e) { throw appError_('The server is busy. Please try again in a moment.', 503); }
    _lock = l;
  }
  _lockDepth++;
}
function lockRelease_() {
  if (_lockDepth <= 0) return;
  _lockDepth--;
  if (_lockDepth === 0 && _lock) { var l = _lock; _lock = null; l.releaseLock(); }
}

function syncAdminFolderAccess_(before, after) {
  var root = rootFolder_();
  var ss = DriveApp.getFileById(prop_('DB_ID'));
  after.forEach(function (e) {
    if (before.indexOf(e) < 0) { try { root.addViewer(e); ss.addViewer(e); } catch (x) { console.warn('share failed ' + e); } }
  });
  before.forEach(function (e) {
    if (after.indexOf(e) < 0) { try { root.removeViewer(e); ss.removeViewer(e); } catch (x) { console.warn('unshare failed ' + e); } }
  });
}

/* =====================================================================
 *  Default form definition (editable later from the Form Builder)
 * ===================================================================== */

function defaultFormConfig_() {
  var years = ['2022-23', '2023-24', '2024-25', '2025-26', '2026-27', '2027-28'];
  var sems = ['E1 Sem-1', 'E1 Sem-2', 'E2 Sem-1', 'E2 Sem-2', 'E3 Sem-1', 'E3 Sem-2', 'E4 Sem-1', 'E4 Sem-2', 'Summer / Vacation'];
  var domains = ['Artificial Intelligence / Machine Learning', 'Data Science / Analytics', 'Web / Mobile App Development',
                 'Cyber Security / Networks', 'IoT / Embedded Systems', 'VLSI / Electronics', 'Communication Systems',
                 'Power Systems / Electrical Machines', 'Structural Engineering', 'Transportation / Pavement Engineering',
                 'Geotechnical Engineering', 'Environmental / Water Resources', 'Thermal / Fluid Engineering',
                 'Design / Manufacturing', 'Materials / Metallurgy', 'Chemical Process Engineering', 'Other'];
  var projectFields = function (major) {
    var f = [
      { id: 'guide', label: 'Project Guide (Faculty)', type: 'faculty', required: true, allowOther: false,
        help: 'Choose the department first, then the faculty member.' },
      { id: 'co_guide', label: 'Co-Guide (if any)', type: 'faculty', required: false, allowOther: true },
      { id: 'domain', label: 'Project Area / Domain', type: 'select', required: true, options: domains },
      { id: 'project_status', label: 'Project Status', type: 'radio', required: true, options: ['Ongoing', 'Completed'] }
    ];
    if (major) f.push({ id: 'outcome', label: 'Outcome', type: 'select', required: false,
      options: ['None yet', 'Paper Published', 'Paper Communicated', 'Patent Filed', 'Product / Prototype', 'Startup'] });
    return f;
  };
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    commonFields: [
      { id: 'title', label: 'Title of the Project / Internship', type: 'text', required: true, maxLength: 200 },
      { id: 'department', label: 'Your Department', type: 'department', required: true },
      { id: 'academic_year', label: 'Academic Year', type: 'select', required: true, options: years },
      { id: 'semester', label: 'Year & Semester', type: 'select', required: true, options: sems },
      { id: 'team_members', label: 'Team Members (IDs, comma separated)', type: 'text', required: false,
        placeholder: 'O212344, O212345', help: 'Leave blank if you worked individually.' },
      { id: 'abstract', label: 'Abstract / Brief Description', type: 'textarea', required: true, maxLength: 3000 },
      { id: 'keywords', label: 'Technologies / Tools / Keywords', type: 'text', required: false, placeholder: 'Python, TensorFlow, IoT' },
      { id: 'start_date', label: 'Start Date', type: 'date', required: true },
      { id: 'end_date', label: 'End Date', type: 'date', required: false },
      { id: 'project_link', label: 'GitHub / Demo / Publication Link', type: 'url', required: false, placeholder: 'https://' },
      { id: 'report', label: 'Report / Certificate (PDF)', type: 'file', required: false,
        help: 'Final report, internship certificate or offer letter.' }
    ],
    categories: [
      { id: 'minor', label: 'Minor Project', fields: projectFields(false) },
      { id: 'major', label: 'Major Project', fields: projectFields(true) },
      { id: 'internship', label: 'Internship', fields: [
        { id: 'company', label: 'Company / Organisation Name', type: 'text', required: true },
        { id: 'org_type', label: 'Type of Organisation', type: 'select', required: true,
          options: ['Private Company (MNC)', 'Private Company (Indian)', 'Startup', 'PSU / Government',
                    'Research Institute / IIT / NIT / University', 'NGO', 'Other'] },
        { id: 'location', label: 'Location (City)', type: 'text', required: true, placeholder: 'Hyderabad' },
        { id: 'state_country', label: 'State / Country', type: 'text', required: true, placeholder: 'Telangana, India' },
        { id: 'mode', label: 'Mode', type: 'radio', required: true, options: ['On-site', 'Remote', 'Hybrid'] },
        { id: 'paid', label: 'Paid or Unpaid', type: 'radio', required: true, options: ['Paid', 'Unpaid'] },
        { id: 'stipend', label: 'Stipend (₹ per month)', type: 'number', required: true, min: 0, max: 1000000,
          showIf: { field: 'paid', equals: 'Paid' } },
        { id: 'duration_weeks', label: 'Duration (weeks)', type: 'number', required: true, min: 1, max: 104 },
        { id: 'mentor', label: 'Industry Mentor (Name & Designation)', type: 'text', required: false },
        { id: 'faculty_coordinator', label: 'Faculty Coordinator (if any)', type: 'faculty', required: false, allowOther: false },
        { id: 'ppo', label: 'Pre-Placement Offer (PPO)?', type: 'radio', required: false, options: ['Yes', 'No', 'Awaited'] }
      ] },
      { id: 'others', label: 'Others', fields: [
        { id: 'other_type', label: 'Type of Activity', type: 'select', required: true,
          options: ['Hackathon', 'Research Paper', 'Online Course / Certification', 'Workshop / Training',
                    'Startup / Innovation', 'Competition', 'Other'] },
        { id: 'organisation', label: 'Organising Body / Platform / Journal', type: 'text', required: true },
        { id: 'achievement', label: 'Result / Achievement', type: 'text', required: false, placeholder: 'Winner, Published, Certified…' },
        { id: 'faculty_involved', label: 'Faculty Mentor (if any)', type: 'faculty', required: false, allowOther: true }
      ] }
    ]
  };
}

/* =====================================================================
 *  ONE-TIME SETUP – run manually from the Apps Script editor as
 *  dataongole@gmail.com (Run ▸ setup). Safe to run again.
 * ===================================================================== */

function setup() {
  var props = PropertiesService.getScriptProperties();
  var me = Session.getEffectiveUser().getEmail();
  if (me && me.toLowerCase() !== APP.SUPER_ADMIN) {
    throw new Error('Run setup() while signed in as ' + APP.SUPER_ADMIN + ' (current: ' + me + ')');
  }

  // Root folder
  var root = null;
  var rid = props.getProperty('ROOT_FOLDER_ID');
  if (rid) { try { root = DriveApp.getFolderById(rid); } catch (e) { root = null; } }
  if (!root) {
    var it = DriveApp.getFoldersByName(APP.ROOT_FOLDER_NAME);
    root = it.hasNext() ? it.next() : DriveApp.createFolder(APP.ROOT_FOLDER_NAME);
    props.setProperty('ROOT_FOLDER_ID', root.getId());
  }

  // Database spreadsheet
  var ss = null;
  var did = props.getProperty('DB_ID');
  if (did) { try { ss = SpreadsheetApp.openById(did); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(APP.DB_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(root);
    props.setProperty('DB_ID', ss.getId());
  }
  _ss = ss;

  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange('A:Z').setNumberFormat('@');   // plain text: stops Sheets turning "3/4" or "2025-26" into dates
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  // Default settings (only if missing)
  var s = sheet_('Settings');
  var existing = {};
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 1).getValues().forEach(function (r) { existing[r[0]] = true; });
  var defaults = {
    FORM_CONFIG: JSON.stringify(defaultFormConfig_()),
    DEPARTMENTS: JSON.stringify(APP.DEFAULT_DEPARTMENTS),
    ADMINS: JSON.stringify(APP.DEFAULT_ADMINS),
    BLOCKED: '[]',
    BATCH_FOLDERS: '{}',
    STUDENT_PATTERN: APP.DEFAULT_STUDENT_PATTERN,
    MAX_FILE_MB: '10',
    SUBMISSIONS_OPEN: 'TRUE'
  };
  Object.keys(defaults).forEach(function (k) { if (!existing[k]) s.appendRow([k, defaults[k]]); });
  _settings = null;

  // Upgrade the old 6-digit student pattern to the new default (o + 6 or 7 digits)
  var curPat = '';
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0] === 'STUDENT_PATTERN') curPat = String(r[1]); });
  if (APP.LEGACY_STUDENT_PATTERNS.indexOf(curPat) >= 0) setSetting_('STUDENT_PATTERN', APP.DEFAULT_STUDENT_PATTERN);

  // The root folder and database must never be shared by link
  try { root.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { Logger.log('Could not set root folder sharing: ' + e); }
  try { DriveApp.getFileById(ss.getId()).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { Logger.log('Could not set database sharing: ' + e); }
  sessionSecret_();

  // Batch folders o20 … o25
  ['o20', 'o21', 'o22', 'o23', 'o24', 'o25'].forEach(ensureBatchFolder_);

  // Give the other administrators view access to files and the database
  syncAdminFolderAccess_([], getSettings_(true).ADMINS);

  audit_(APP.SUPER_ADMIN, 'super', 'setup', 'v' + APP.VERSION);
  Logger.log('Setup complete.\nRoot folder: ' + root.getUrl() + '\nDatabase: ' + ss.getUrl() +
             '\nNext: set Script Property CLIENT_ID, then Deploy ▸ New deployment ▸ Web app.');
}

/** Optional helper: quick health check from the editor. */
function checkSetup() {
  var p = PropertiesService.getScriptProperties();
  Logger.log('CLIENT_ID set: ' + !!p.getProperty('CLIENT_ID'));
  Logger.log('ROOT_FOLDER_ID: ' + p.getProperty('ROOT_FOLDER_ID'));
  Logger.log('DB_ID: ' + p.getProperty('DB_ID'));
  Logger.log('Admins: ' + getSettings_(true).ADMINS.join(', '));
  Logger.log('Student pattern: ' + getSettings_(true).STUDENT_PATTERN);
  try { Logger.log('Root folder link sharing: ' + rootFolder_().getSharingAccess() + ' (should be PRIVATE)'); } catch (e) {}
}
