# United University — Bus ERP

Transport and OTP-based attendance for United University buses UU-1 to UU-21.

## Run

Requires Node.js 22 or newer. There are no packages to install.

```bash
node server.js
```

Open http://localhost:3000. The console also prints a `Network:` address that phones on the same Wi-Fi can open.

On the **first run** the server creates `data/db.json` and generates a random login ID and password
for every admin and coordinator. They are printed in the console and saved to
`data/initial-credentials.txt`. Give each person their own ID/password, then delete that file.

## Private files (not in this repository)

Personal data and secrets are git-ignored. Copy them to the server by hand:

| File | What it holds | Without it |
|---|---|---|
| `lib/seed.private.js` | Real UU-10 student roster, stops and staff details (same shape as `lib/seed.example.js`) | A fresh database starts with **sample** students and staff |
| `smtp.config.json` | E-mail account for password-reset OTPs (copy `smtp.config.example.json`) | Reset OTPs are printed in the server console |
| `data/` | The live database, voice notes and first-run credentials | A new, empty database is created |

The seed file is read **only** when the database is first created. To move an existing installation,
copy the whole `data/` folder; nothing needs re-seeding.

## Database on Supabase

With `STORAGE=supabase` the app keeps its data in Supabase Postgres. Each student, attendance mark, session, chat, notice and security event is a row in `uubus_records`, with readable views `uubus_students`, `uubus_attendance` and `uubus_security_events`. Voice notes and daily backups go to a private Storage bucket (`uubus-files`, created automatically). A lease row stops two servers from writing at the same time.

1. Supabase dashboard → **SQL Editor** → paste `supabase/schema.sql` → **Run**. This also locks the table so the public/publishable key has no access.
2. Copy `supabase.config.example.json` to `supabase.config.json` (git-ignored). Fill in the project URL and the **secret** key (Project Settings → API Keys → Secret keys, starts with `sb_secret_`). Never use the secret key in a browser, and never commit it.
3. Copy the existing local data across once: `npm run migrate:supabase`. Logins and attendance carry over.
4. Run locally against Supabase with `npm run start:supabase`, or deploy (below). Only one server can use the database at a time.

## Deploying on Zoho Catalyst AppSail (with Supabase)

This folder is linked to the Catalyst project via `catalyst.json` and `.catalystrc`. `app-config.json` sets `STORAGE=supabase`.
```bash
npm run build:catalyst
catalyst deploy appsail --name uu-bus-erp
```
`build:catalyst` puts the app, your private roster, and the e-mail and Supabase settings into `catalyst-build/`. These are uploaded to Zoho only, never to GitHub. Set the AppSail health-check path to `/api/health`.

## Deploying on Zoho Catalyst with Stratus (alternative to Supabase)

AppSail containers have no permanent disk, so the app stores its database, daily backups and voice notes in a **Catalyst Stratus** bucket (`lib/store-catalyst.js`, official `@zcatalyst/stratus` SDK).

One-time setup:
1. Sign in at **catalyst.zoho.in** (India data centre) or catalyst.zoho.com, and create a project, e.g. `uu-bus-erp`.
2. In the project: **Cloud Scale → Stratus → Create bucket**, named `uu-bus-erp-data`. If that name is taken, pick another and change `ZOHO_STRATUS_BUCKET` in `app-config.json`.
3. Install the CLI and log in (opens your browser):
   ```bash
   npm install -g zcatalyst-cli
   catalyst login
   ```
4. In this folder: `catalyst init` → choose your project. Then `catalyst appsail:add --name uu-bus-erp --source . --stack node22 --build ./catalyst-build`, keeping the existing `app-config.json`.

Every deploy:
```bash
npm run build:catalyst
catalyst deploy appsail --name uu-bus-erp
```
`build:catalyst` copies the app plus your private roster (`lib/seed.private.js`) and e-mail settings (`smtp.config.json`) into `catalyst-build/`. These are uploaded to Zoho only, never to GitHub. It also installs the Stratus SDK.

After the first deploy, open the AppSail URL once. The database is created in the bucket on the first visit, and the admin logins are printed in **AppSail → Logs** and saved in the bucket at `private/initial-credentials.txt`. In AppSail → Configuration, set the health-check path to `/api/health`.

## Deploying on Render

`render.yaml` sets everything up: Singapore region, a 1 GB persistent disk at `/var/data`, health checks and auto-deploy on every push.

1. Render dashboard → **New → Blueprint** → connect GitHub and pick this repository → **Apply**.
2. When asked, fill in `SMTP_USER` (the sending Gmail address), `SMTP_PASS` (its 16-character App Password) and `SMTP_FROM` (e.g. `UU Bus ERP <address@gmail.com>`).
3. Service → **Environment → Secret Files** → add a file named `seed.private.js` and paste the contents of your local `lib/seed.private.js`. Do this **before the first successful start**, because the roster is only read when the database is created. If the service already started with sample data, add the file, then use the Shell tab to run `rm /var/data/db.json` and restart.
4. Service → **Logs**: on first start the server prints the admin/coordinator login IDs and passwords, and `E-mail: OTPs sent via smtp.gmail.com …`.
5. Open the `https://uu-bus-erp.onrender.com` address (or add your own domain under **Settings → Custom Domains**).

The `starter` plan is needed because free Render instances have no persistent disk and would lose attendance on every restart.

## Deploying elsewhere

- Use a host with a **persistent disk** (Railway with a volume, Render with a disk, or any VPS). The database is a file in `data/`, and hosts with temporary disks wipe it on restart.
- Set `DATA_DIR` to the persistent disk path and `PORT` if the host requires it. Start command: `npm start`.
- Serve over **HTTPS** (Railway/Render do this automatically). Voice messages need it.
- Back up `data/db.json` daily.

## Roles

| Role | Who | Can do |
|---|---|---|
| **Student** (no login) | Picks their bus, then their name | Marks own attendance with the OTP, sees attendance % (7 days–6 months), chats (text + voice) with admins, sees stops, notices and contacts |
| **Student Coordinator** | Two student coordinators per bus | Sees total students marked and average present (1 day–6 months). No names, no OTP |
| **Administrative Admin** | Bus Incharge / faculty coordinator, Transport Incharge (all buses) | Generates the OTP and chooses how long it stays valid, closes the portal early, marks students manually up to 1 hour after the OTP expires, downloads Excel, reads and replies to student chats, posts notices, edits stops |
| **Super Admin** | Shown only as "Super Admin" on the portal | Everything above on every bus, plus add, remove or move students between buses, and add, edit, disable or reset any admin/coordinator |

## Other features

- **Dark mode:** use the moon/sun button at the top of every screen. It follows the phone's setting until changed, and the choice is remembered on that device.
- **Live popup for students:** when a student opens their portal, a popup says whether the attendance portal is live. If it goes live (or closes) while the student has the page open, a new popup appears on any tab, with an "Enter OTP now" button.
- Footer credit: Developed by [ReasonateAI](https://reasonateai.com/) under the guidance of Mr. Manish Shukla, CSE Department, United University.

## Attendance rules

- The portal is live only after an administrative admin or the Super Admin opens it. It closes automatically when the time runs out.
- If the portal is already live and another admin tries to open it, they see a 5-second popup naming who opened it. Admins watching the Live screen also get the popup when someone else makes the portal live.
- Before marking, the student's status card is shown in black and white. After a correct code it turns green.
- Manual marking is allowed while the portal is live and for 1 hour after it closes. After that, unmarked students stay absent.
- Attendance can never be deleted. 5 wrong codes locks that student out for the trip.

## Anti-proxy protection

Chosen when the admin makes the portal live:

| Protection | How it works | Stops |
|---|---|---|
| **Rotating QR code** (default) | The admin's screen shows a QR code and a 6-digit code that change every 30 seconds (the previous code is accepted for one more cycle). Scanning the QR with the phone camera opens the student's portal and marks them in one step. | Codes forwarded on WhatsApp or screenshots, which expire within seconds |
| **Fixed OTP** (optional) | One code for the whole trip; can be shared on WhatsApp. | — (easier, less strict) |
| **Location check** (on by default) | The admin's phone shares its GPS while the portal is live; a student must be within the bus radius (default 200 m, set in Settings, plus both phones' GPS accuracy). | Marking from home or college |
| **One phone per student** | The first phone a student marks from becomes linked to their name. Other phones can't mark for that name, and a linked phone can't mark for anyone else. Admins can **Reset** the link in Students if a student changes phones. | Friends marking for each other |

Every blocked attempt (wrong code, too far, no location, wrong phone) is logged with the student and details. Admins see a live "blocked attempts" banner, and Reports → **Security** lists events and repeat offenders (also exported to Excel).

Location needs an **https://** address (or localhost). Over plain `http://` on Wi-Fi, untick the location check.

## Excel export

Reports → choose a period (up to 6 months) → **Download Excel**. Sheets:
- **Attendance** – student name, enrollment, date, time, trip, marked by (the student, or the admin's name), distance from the bus, GPS accuracy, device
- **Register (P-A)** – present/absent grid per student per trip with %
- **Daily Summary**, **Security Events** and **Report Info**

## Data safety

- Changes are saved within a second. A dated backup copy is kept automatically each day (last 30 days, in `data/backups/`).
- Super Admin → Settings → **Download full backup** saves the whole database as a JSON file.
- Storage is pluggable: local disk by default, or Zoho Catalyst Stratus (`STORAGE=catalyst`) for cloud hosting.

## Password reset by e-mail OTP

**One-time setup (sender account):**
1. Pick a Gmail account to send from, e.g. a transport-office address. Turn on 2-Step Verification, then create an **App password**: Google Account → Security → App passwords. It is 16 characters.
2. Open `smtp.config.json` in the project folder. Put the address in `user` (and in `from`) and the app password in `pass`. The file is git-ignored; keep it private.
3. Test it: `node scripts/test-email.js your-address@example.com`, then restart the server. The startup message should say `E-mail: OTPs sent via smtp.gmail.com …`.

Other providers work too (Outlook: `smtp.office365.com`, port 587; Zoho: `smtp.zoho.in`, 465). Instead of the file, you can set the `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` environment variables, or fill in Super Admin → Settings → *E-mail*.

**Each admin's e-mail:** each admin saves their own e-mail under Settings/Account, or the Super Admin adds it under Settings → Edit account. The OTP is sent only to that saved address.

**Resetting:** on the login screen, **Forgot password?** → login ID → the OTP arrives by e-mail (valid 10 minutes, 5 tries, one request per minute) → set a new password.

Until e-mail is configured, reset OTPs are printed in the server console.

## Putting it online

- **Campus Wi-Fi:** run it on a PC and share the `Network:` address.
- **Internet:** deploy to any Node host (Render, Railway, a VPS). Set `PORT` if needed, and set `DATA_DIR` to a persistent disk.
- Voice messages need the microphone, and browsers allow that only on `https://` (or localhost). Use HTTPS when hosting online.
