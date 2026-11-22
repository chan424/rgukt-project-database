# RGUKT Ongole Project Database

A secure web application that serves as the institutional record of **all student projects at RGUKT Ongole**: minor projects, major projects, internships and other activities (hackathons, papers, certifications…).

- Students sign in with their college Google account (`o2123231@rguktong.ac.in` or `o212343@rguktong.ac.in`) and submit details.
- Administrator (`ao@rguktong.ac.in` by default; the super administrator can add or remove more) sees a live analytics dashboard and verifies submissions.
- The super administrator (**dataongole@gmail.com**) also controls the form, faculty list, users and settings.
- All data and uploaded files are stored in the Google Drive of **dataongole@gmail.com**, organised into one folder per batch (`o20`, `o21`, `o22`, …).
- The website is hosted free on **GitHub Pages**.

---

## 1. How it works

```
 Student / Admin browser                 GitHub Pages (static site, /docs)
        │  1. "Sign in with Google" ───────────────►  Google Identity Services
        │  2. Google ID token (signed JWT)
        ▼
 Google Apps Script Web App  (runs as dataongole@gmail.com)
   • verifies the token with Google (audience, issuer, expiry, verified e-mail, Workspace domain)
   • decides the role: super / admin / student / denied
   • issues a random server-side session (6 h maximum, ends after 60 min of inactivity)
   • validates every request against the form definition
        │
        ▼
 Google Drive of dataongole@gmail.com
   RGUKT Ongole Project Database/
     ├── RGUKT Ongole Project Database (Data)   ← Google Sheet: Projects, Users, Faculty, Settings, Audit
     ├── o20/ ├── o21/ │  ├── O212343/   (that student's uploaded reports/certificates)
     │         │  └── O2123231/
     └── o22/ …        (a new batch folder is created automatically on the first sign-in from that batch)
```

The GitHub site holds **no secrets and no data**. Everything sensitive lives in the Apps Script backend and the Drive of dataongole@gmail.com.

## 2. Features

| Role | Who | Can do |
|---|---|---|
| **Student** | Google Workspace accounts `o` + 6 or 7 digits `@rguktong.ac.in` (batch = first 3 characters, e.g. `o2123231` → `o21`) | Choose type (Minor Project / Major Project / Internship / Others) → fill the matching details form → upload report/certificate → view status and office remarks → edit or delete until verified |
| **Administrator** | `ao@rguktong.ac.in` (default; add/remove more in *Users & Access*) | Dashboard (type, department, batch, faculty, companies, locations, paid vs unpaid, stipend, monthly trend, Department × Type table) with filters; download each chart as PNG; search all records; open uploaded files; mark **Verified / Needs Correction / Rejected** with remarks; export CSV |
| **Super administrator** | `dataongole@gmail.com` (fixed, cannot be removed) | Everything above, plus **Form Builder** (add/edit/reorder fields and project types, conditional fields, preview), **Faculty** (department-wise list, bulk paste from Excel), **Users & Access** (add/remove admins, block/unblock students), **Settings & Drive** (departments, open/close submissions, upload size, batch folders), **Audit Log**, permanent deletion |

**Form logic included by default**

- *General details* (all types): title, department, academic year, year & semester, team members, abstract, keywords, start/end dates, link, report/certificate upload.
- *Minor / Major Project*: guide (pick department → faculty of that department), co-guide, area, status (+ outcome for major).
- *Internship*: company, organisation type, city, state/country, mode (on-site/remote/hybrid), **paid / unpaid** → stipend appears only if *Paid*, duration, industry mentor, faculty coordinator, PPO.
- *Others*: activity type, organiser, achievement, faculty mentor.

## 3. Repository layout

```
backend/Code.gs          Apps Script backend (paste into the Apps Script editor)
backend/appsscript.json  Apps Script manifest (time zone, scopes, web-app settings)
docs/                    The website served by GitHub Pages
  index.html             Page shell + Content-Security-Policy
  js/framebust.js        Anti-clickjacking (stops the site being shown inside another site's frame)
  js/config.js           ← the ONLY file you edit: Web App URL + OAuth Client ID
  js/core.js             Safe DOM builder, API client, session, modals
  js/formkit.js          Renders the dynamic form from the server's definition
  js/student.js          Student screens
  js/admin.js            Dashboard + records review
  js/super.js            Form builder, faculty, users, settings, audit
  vendor/chart.umd.min.js Chart.js 4.6.1 (self-hosted, no CDN)
tests/                   Automated tests (backend logic + security, and full UI in Chrome)
```

## 4. One-time setup (about 30 minutes)

> Do steps 4.1–4.5 while signed in to Google as **dataongole@gmail.com**.

### 4.1 Create the backend (Apps Script)
1. Open <https://script.google.com> → **New project**. Rename it *RGUKT Ongole Project Database*.
2. Delete the sample code in `Code.gs` and paste the full contents of `backend/Code.gs`.
3. Project Settings (⚙) → tick **Show "appsscript.json" manifest file in editor**. Open `appsscript.json` and replace it with `backend/appsscript.json`.
4. Select the function **`setup`** in the toolbar and click **Run**. Approve the permissions (Advanced → Go to project → Allow).
   This creates the `RGUKT Ongole Project Database` folder, the database spreadsheet, the batch folders `o20`–`o25`, makes sure none of them is shared by link, and gives the administrator (`ao@rguktong.ac.in`) **view-only** access.
   The execution log shows the folder and sheet links.

### 4.2 Create the Google Sign-In client ID
1. Open <https://console.cloud.google.com> → create a project, e.g. *rgukt-ongole-projects*.
2. **APIs & Services → OAuth consent screen** (also called *Google Auth Platform → Branding / Audience*): User type **External**; app name *RGUKT Ongole Project Database*; support e-mail dataongole@gmail.com; no extra scopes; then **Publish app** (only basic sign-in scopes are used, so Google verification is not needed).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*.
   - **Authorized JavaScript origins**: `https://chan424.github.io` (exactly this, no path and no trailing slash; add your custom domain too, if you use one).
   - Redirect URIs: leave empty.
4. Copy the **Client ID** (ends with `.apps.googleusercontent.com`).

### 4.3 Give the Client ID to the backend
Apps Script → Project Settings → **Script Properties** → *Add script property*: `CLIENT_ID` = the Client ID from 4.2. Save.

### 4.4 Deploy the backend
Apps Script → **Deploy → New deployment** → type **Web app**:

- Execute as: **Me (dataongole@gmail.com)**
- Who has access: **Anyone**

Click **Deploy** and copy the **Web app URL** (ends with `/exec`).
*"Anyone" only lets the website reach the script; every request is still checked for a valid Google sign-in and role.*

### 4.5 Configure and publish the website
1. Edit `docs/js/config.js` and fill in `API_URL` (step 4.4) and `GOOGLE_CLIENT_ID` (step 4.2).
2. Push the repository to GitHub.
3. GitHub → repository **Settings → Pages** → Source: *Deploy from a branch* → Branch **main**, folder **/docs** → Save.
4. After a minute the site is live at <https://chan424.github.io/rgukt-project-database/>.

### 4.6 First use
1. Open the site and sign in as **dataongole@gmail.com**.
2. **Faculty** → **Bulk import** → paste the department-wise list from Excel (columns: *Department, Name, Designation, Email*) → **Import** → **Save faculty list**.
3. Check **Settings & Drive** (departments, upload size) and **Form Builder**; use *Preview as student* before announcing the link.
4. Share the site link with students.

### 4.7 Updating the backend later
After editing the script: **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**. The Web app URL stays the same, so `config.js` does not change.

## 5. Security

| Measure | Detail |
|---|---|
| Verified sign-in | The Google ID token is checked on the server with Google's `tokeninfo` endpoint (Google verifies the signature): audience = your Client ID, issuer `accounts.google.com`, not expired, not issued in the future, `email_verified = true`. Nothing the browser says about e-mail or role is trusted. |
| Real college accounts only | An e-mail address is accepted only if it is a `@gmail.com` account, or the token carries the Workspace claim `hd` equal to the address's domain. So `o212343@gmail.com`, or a personal Google account that someone registered with a college address, is refused. Students additionally need `hd = rguktong.ac.in` and an ID matching `o` + 6–7 digits. |
| Fixed roles | `dataongole@gmail.com` is the permanent super administrator (in the code, cannot be removed or blocked). `ao@rguktong.ac.in` is the only default administrator; the super administrator adds or removes others in *Users & Access*. |
| Server-side roles | The role is recomputed from the Settings sheet on **every** request, so removing an admin or blocking a student takes effect immediately, even for open sessions. |
| Sessions | 64-character tokens from 244 random bits mixed with a per-installation secret (HMAC-SHA256). Only a SHA-256 hash of the token is stored (CacheService). Sessions end after 60 minutes without activity, after 6 hours at most, on sign-out, or when access is revoked. Tokens live in the tab's `sessionStorage` (cleared when the tab closes). |
| Authorisation & IDOR | Every action declares its required role and is checked by the router; forbidden attempts are refused and logged. Students can read, edit and delete only their own records (checked by e-mail on the server, not by record ID). Drive file links are given only to administrators. |
| Input validation | Every answer is checked against the form definition (required fields, options, numbers, dates, links, faculty list); unknown fields are discarded; text is length-limited; raw requests over 40 MB are refused. |
| Uploads | Only PDF/DOC/DOCX/PPT/PPTX/ZIP/PNG/JPG. The real file content is checked for **every** type (magic bytes, and DOCX/PPTX must contain Word/PowerPoint parts), so a renamed `.exe` or web page is refused. Size limit (default 10 MB, max 25 MB), at most 5 files per request, file names sanitised and the extension set from the verified type. Files are stored in `batch/student` folders, explicitly **not link-shared**; replaced files are moved to the bin. |
| Drive sharing | The root folder and database are set to *private* by `setup()`. Administrators get **view-only** access; removing an admin removes it. Students get no Drive access. |
| Batch folders | One folder per batch (`o21`, `o22`, `o23`, …) is created automatically on the first sign-in from that batch, plus one sub-folder per student. Creation runs under a script lock and re-checks Drive, so simultaneous first sign-ins cannot create duplicate folders. |
| Injection | The website never inserts user text as HTML (no `innerHTML`, so no XSS); links are only rendered for `http(s)` URLs; Sheet cells are stored as plain text and values starting with `= + - @` are neutralised; CSV exports are protected the same way. |
| Content-Security-Policy | Scripts only from the site itself and `accounts.google.com/gsi/client`; network calls only to `script.google.com` / `script.googleusercontent.com` / Google Sign-In; images only from the site and `*.googleusercontent.com` (profile photos); no plugins, no `eval`, no forms, `base-uri 'self'`, `upgrade-insecure-requests`. Chart.js is self-hosted (no CDN). |
| Clickjacking | GitHub Pages cannot send the `X-Frame-Options` or `frame-ancestors` headers, and browsers ignore `frame-ancestors` in a `<meta>` tag. `js/framebust.js` therefore hides the page and breaks out if it is loaded inside another site's frame, and the app refuses to start when framed. For header-level protection, put the site behind a proxy such as Cloudflare (free) on a custom domain and add `Content-Security-Policy: frame-ancestors 'none'` there. |
| Abuse control | Per-user rate limit (120 requests/minute), global sign-in limit (300/minute, protects Google quotas), write locking. |
| Errors | Unexpected errors return a generic message; details go only to the Apps Script execution log. |
| Audit trail | Sign-ins, denied sign-ins (with the reason), forbidden actions, submissions, edits, status changes, admin/faculty/form/setting changes are logged in the **Audit** sheet. |
| No secrets in the repository | `config.js` holds only the public Web-app URL and OAuth Client ID. The Client ID check and session secret live in Apps Script *Script Properties*. |

**Important:** never share the Apps Script project or the database sheet with edit access, and never edit the `Settings` rows by hand unless you know the format. Do not change *Who has access* of uploaded files in Drive.

**Requirement:** student and college-admin accounts must be Google Workspace accounts on `rguktong.ac.in` (they are, if students already use Gmail/Drive with their college ID). Additional administrators must use a college or Gmail address.

## 6. Data model (Google Sheet)

| Sheet | Columns |
|---|---|
| Projects | ProjectID, SubmittedAt, UpdatedAt, Email, StudentID, Batch, StudentName, Category, Department, AcademicYear, Title, Status, Remark, ReviewedBy, DataJSON (all answers), FilesJSON |
| Users | Email, Name, StudentID, Batch, Role, FirstLogin, LastLogin, LoginCount |
| Faculty | FacultyID, Department, Name, Designation, Email, Active |
| Settings | FORM_CONFIG, DEPARTMENTS, ADMINS, BLOCKED, BATCH_FOLDERS, STUDENT_PATTERN, MAX_FILE_MB, SUBMISSIONS_OPEN |
| Audit | Time, Email, Role, Action, Details |

For reports, use **Records → Export CSV**: it flattens every form field into its own column.

## 7. Limits

Google Apps Script quotas for a free Gmail account comfortably cover a campus of a few thousand students (about 20,000 sign-in verifications per day, 30 simultaneous requests). The dashboard loads all records at once; this is fast up to roughly 10,000 records.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| "Setup incomplete" on the login page | Fill `API_URL` and `GOOGLE_CLIENT_ID` in `docs/js/config.js`. |
| Google button shows *"origin not allowed"* | Add the exact site origin (`https://username.github.io`) under Authorized JavaScript origins (4.2), then wait about 5 minutes. |
| "Server is not configured (CLIENT_ID missing)" | Add the `CLIENT_ID` script property (4.3) and deploy a new version. |
| "Access denied" for a genuine student | The e-mail must match the pattern in Settings (default `o` + 6 or 7 digits) and the student must be signed in to the college Workspace account (not a personal Gmail). Adjust the pattern under *Settings & Drive → Advanced*. |
| "Access denied" for an administrator | Check they are listed in *Users & Access*, and that they sign in with the college Workspace account (a personal Google account using the college address is refused). |
| "Session expired" after a break | Sessions end after 60 minutes without activity. Sign in again. |
| Changes to Code.gs have no effect | Deploy a **new version** (4.7). |
| Admin cannot open uploaded files | Make sure they are in *Users & Access → Administrators*; saving the list re-shares the Drive folder. |

## 9. Running the tests

```bash
cd tests
npm install            # installs Playwright
node api.test.js       # 55 backend checks: auth, roles, 6/7-digit IDs, batch folders, sessions, uploads, injection, blocking, rate limit
npx playwright install chrome   # once, if Chrome is not installed
node ui.test.js        # full student/admin/super-admin journeys in Chrome; screenshots in tests/shots/
```

The tests run the real `Code.gs` against in-memory stand-ins for Sheets, Drive, Cache and Google's token check, so nothing touches the live Drive.

## 10. What changed in v1.1 (security & improvements)

- Default administrator is now only `ao@rguktong.ac.in` (`da@` and `director@` removed); `dataongole@gmail.com` stays the permanent super administrator and can still add/remove administrators in *Users & Access*.
- Student IDs with **6 or 7 digits** (`o212343`, `o2123231`) are accepted; the batch is the first three characters (`o21`). Installations with the old 6-digit pattern are upgraded automatically.
- E-mail addresses must be backed by Gmail or by the matching Workspace domain (`hd` claim) – blocks personal Google accounts registered with a college address.
- Batch and student folders are created under a lock (no duplicates on simultaneous first sign-ins).
- Sessions: HMAC-mixed random tokens, only a hash stored server-side, 60-minute inactivity timeout, absolute 6-hour limit.
- Uploads: magic-byte check for every allowed type (not just PDF), total-size check, uploaded files explicitly set to private, root folder and database set to private in `setup()`.
- Forbidden actions are logged (`access.denied`); denied sign-ins record the reason; global sign-in rate limit; request size cap.
- Anti-clickjacking script, tighter Content-Security-Policy, `noindex`, skip-to-content link, better focus outlines, reduced-motion support, small-screen header.
- Tests extended (55 backend checks, full UI journey incl. 7-digit student, clickjacking and CSP checks).

## 11. What you need to do next

1. **Publish the site:** GitHub → `chan424/rgukt-project-database` → **Settings → Pages** → *Deploy from a branch* → Branch **main**, folder **/docs** → Save.
2. **Create the backend** (signed in as dataongole@gmail.com): steps 4.1 (paste `backend/Code.gs` and `backend/appsscript.json`, run `setup`).
3. **Create the OAuth Client ID** (step 4.2) with Authorized JavaScript origin `https://chan424.github.io`, and add it as Script Property `CLIENT_ID` (step 4.3).
4. **Deploy** the Apps Script as a Web app (step 4.4: Execute as *Me*, access *Anyone*) and copy the `/exec` URL.
5. Put the Web app URL and Client ID into `docs/js/config.js` (or send them to your assistant to do it), then open <https://chan424.github.io/rgukt-project-database/> and sign in as dataongole@gmail.com (step 4.6).
