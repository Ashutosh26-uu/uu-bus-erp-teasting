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

## Deploying

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

- The portal is live only after an administrative admin or the Super Admin generates an OTP. It closes automatically when the time runs out.
- If an OTP is already live and another admin tries to generate one, they see a 5-second popup naming who generated it. Admins watching the Live screen also get the popup when someone else makes the portal live.
- Before marking, the student's status card is shown in black and white. After a correct OTP it turns green.
- Manual marking is allowed while the portal is live and for 1 hour after it closes. After that, unmarked students stay absent.
- Attendance can never be deleted. One phone can mark only one student per trip. 5 wrong OTP tries locks that student out for the trip.

## Excel export

Reports → choose a period (up to 6 months) → **Download Excel**. Sheets:
- **Attendance** – student name, enrollment, date, time, trip, marked by (student self via OTP, or the admin's name)
- **Register (P-A)** – present/absent grid per student per trip with %
- **Daily Summary** and **Report Info**

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
