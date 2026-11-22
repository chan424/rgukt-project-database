/*
 * Deployment configuration — edit these two values after setup (see README.md).
 * They are NOT secrets: the Apps Script URL and OAuth Client ID are public by design.
 * All security checks happen on the server (backend/Code.gs).
 */
window.APP_CONFIG = Object.freeze({
  APP_NAME: 'RGUKT Ongole Project Database',
  INSTITUTION: 'Rajiv Gandhi University of Knowledge Technologies, Ongole Campus',

  // Apps Script Web App URL (Deploy ▸ Manage deployments ▸ Web app URL, ends with /exec)
  API_URL: 'https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec',

  // OAuth 2.0 Client ID (Google Cloud Console ▸ APIs & Services ▸ Credentials)
  GOOGLE_CLIENT_ID: 'REPLACE_WITH_CLIENT_ID.apps.googleusercontent.com',

  STUDENT_EMAIL_HINT: 'o2123231@rguktong.ac.in'
});
