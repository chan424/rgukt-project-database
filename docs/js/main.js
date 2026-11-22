/* App bootstrap: Google sign-in, session restore, role-based routing. */
'use strict';

const App = (() => {
  const app = () => $('#app');

  function configured() {
    return CFG.API_URL && !CFG.API_URL.includes('REPLACE_WITH') && CFG.GOOGLE_CLIENT_ID && !CFG.GOOGLE_CLIENT_ID.includes('REPLACE_WITH');
  }

  function waitForGoogle(timeout = 10000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function poll() {
        if (window.google && google.accounts && google.accounts.id) return resolve();
        if (Date.now() - t0 > timeout) return reject(new Error('Google Sign-In could not load. Check your connection or disable blockers for accounts.google.com.'));
        setTimeout(poll, 100);
      })();
    });
  }

  function renderUserbox(user) {
    const box = $('#userbox');
    clear(box);
    if (!user) { box.hidden = true; return; }
    const roleLabel = { student: 'Student', admin: 'Administrator', super: 'Super Admin' }[user.role];
    appendTo(box, 
      user.picture ? h('img', { class: 'avatar', src: user.picture, alt: '', referrerPolicy: 'no-referrer', width: 34, height: 34 }) : h('div', { class: 'avatar avatar-txt', text: (user.name || user.email)[0].toUpperCase() }),
      h('div', { class: 'user-meta' }, h('div', { class: 'user-name', text: user.name || user.email }),
        h('div', { class: 'user-sub' }, h('span', { class: 'role role-' + user.role, text: roleLabel }), ' ', user.studentId || user.email)),
      h('button', { class: 'btn btn-ghost btn-sm', text: 'Sign out', onclick: logout }));
    box.hidden = false;
  }

  async function showLogin(message) {
    renderUserbox(null);
    const btnHost = h('div', { id: 'gbtn', class: 'gbtn' });
    const msg = h('div', { class: 'login-msg', attrs: { role: 'alert' }, text: message || '' });
    appendTo(clear(app()), h('div', { class: 'login-wrap' },
      h('section', { class: 'login-card' },
        h('img', { src: 'assets/logo.svg', alt: '', width: 64, height: 64, class: 'login-logo' }),
        h('h1', { text: CFG.APP_NAME }),
        h('p', { class: 'muted', text: CFG.INSTITUTION }),
        h('div', { class: 'login-points' },
          point('🎓', 'Students', 'Record minor projects, major projects, internships and other achievements.'),
          point('📊', 'Administration', 'Department-wise, batch-wise and faculty-wise analytics.'),
          point('🔒', 'Secure', 'Institutional Google sign-in only. All access is logged.')),
        btnHost, msg,
        h('p', { class: 'small muted', text: 'Students: sign in with your college e-mail, e.g. ' + CFG.STUDENT_EMAIL_HINT })),
      h('p', { class: 'small muted center', text: 'By signing in you agree that the details you submit are stored by RGUKT Ongole for academic records.' })));

    if (!configured()) { msg.textContent = 'Setup incomplete: set API_URL and GOOGLE_CLIENT_ID in js/config.js (see README).'; return; }
    try {
      await waitForGoogle();
      google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: onCredential, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true, itp_support: true, context: 'signin' });
      google.accounts.id.renderButton(btnHost, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', width: 300, logo_alignment: 'left' });
    } catch (e) { msg.textContent = e.message; }
  }
  function point(icon, t, d) { return h('div', { class: 'login-point' }, h('span', { class: 'lp-icon', attrs: { 'aria-hidden': 'true' }, text: icon }), h('div', {}, h('strong', { text: t }), h('div', { class: 'small muted', text: d }))); }

  async function onCredential(resp) {
    try {
      const res = await withBusy('Signing in…', () => api('auth.login', { idToken: resp.credential }));
      Session.set({ session: res.session, user: res.user, at: Date.now() });
      await start();
    } catch (e) {
      Session.clear();
      showLogin(e.message);
    }
  }

  async function start() {
    const s = Session.get();
    if (!s) return showLogin();
    clear(app()).appendChild(h('div', { class: 'center-pad' }, h('div', { class: 'spinner' })));
    let cfg;
    try { cfg = await api('config.get', {}, { noAuthRedirect: true }); }
    catch (e) { Session.clear(); return showLogin(e.code === 401 ? '' : e.message); }
    const ctx = {
      user: cfg.user, form: cfg.form, departments: cfg.departments, faculty: cfg.faculty, maxFileMB: cfg.maxFileMB,
      submissionsOpen: cfg.submissionsOpen, statuses: cfg.statuses, systemFields: cfg.systemFields,
      fieldTypes: cfg.fieldTypes, allowedFileTypes: cfg.allowedFileTypes
    };
    renderUserbox(ctx.user);
    const container = clear(app());
    try {
      if (ctx.user.role === 'student') await StudentView.mount(container, ctx);
      else await AdminView.mount(container, ctx);
    } catch (e) { toastError(e); }
  }

  async function logout() {
    try { await api('auth.logout', {}, { noAuthRedirect: true }); } catch (e) { /* ignore */ }
    Session.clear();
    try { google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
    showLogin();
  }

  return { start, showLogin };
})();
window.App = App;

// Never run inside another site's frame (see js/framebust.js)
document.addEventListener('DOMContentLoaded', () => { if (!window.__APP_FRAMED__) App.start(); });
