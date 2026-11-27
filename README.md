# Time Clock

A private, single-person time clock that runs entirely on your phone or computer. No account, no server, no internet needed after the first load.

## What it does

- **Clock in / clock out** with one big button, plus **Start/End Break** for unpaid breaks.
- **Notes on every entry**, typed or dictated.
- **Voice input**:
  - On the Clock screen, tap **Voice command** and say things like "clock in", "clock out at 4:30", "start break", "end break", "note finished the tile", or a whole entry like "yesterday 7 to 3:30 with a 30 minute lunch".
  - Every field in the add/edit form has a 🎤 button.
- **Forgiving manual entry**: type times however you like: `7`, `730`, `7:30a`, `7.30 pm`, `0730`, `17:30`, `half past seven`, `quarter to four`, `noon`, `now`. Dates can be `today`, `yesterday`, `fri`, `last monday`, `11/20`, `nov 20`, `the 20th`, `3 days ago`. Breaks can be `30`, `1:15`, `half hour`, `an hour`, `1 1/2 hours`. Or type or say it all in one line: `fri 630-3 half hour lunch note Johnson kitchen`. A preview line shows how it was understood before you save.
  - If you skip AM/PM, it guesses: clock-in times from 5 to 11 are morning and 12 to 4 are afternoon. Clock-out is the next matching time after clock-in, so overnight shifts work.
- **Timesheet**: week-by-week view with daily totals, regular and overtime hours, and gross pay. Tap any entry to fix it, or tap ＋ on a day to add one.
- **Reports**: week, 2 weeks, month, quarter, year or a custom range, broken down by day, week or month.
- **PDF export** for any period, with a summary, totals table, every punch and its notes, and optional signature lines. **CSV export** for spreadsheets.
- **Settings**: name, employer, hourly rate, weekly overtime threshold and multiplier, week start day, punch rounding (5, 6 or 15 min), h:mm or decimal hours, 12 or 24-hour time.
- **Benefits deal tracking**: each week, coverage = hours worked ÷ full-coverage hours (40 by default), up to 100%. 40 h = fully covered, 20 h = half, 30 h = 75%. The Clock screen shows a coverage bar and how many hours you still need for full coverage. The Timesheet, Reports and PDFs show coverage week by week. Enter the benefits cost (per month or per week) in Settings to see the dollar split between employer and you. A week that spans two months counts in the month it starts in.
- **Photos on any day**: tap 📷 on a day in the Timesheet, or **Add photo to today** on the Clock screen. Use the camera or pick from your library. Tap a photo to add a caption (typed or dictated) or delete it. Photos are shrunk to about 1600 px and kept on the device. They're included in PDFs (turn off with "Include photos") and in backups.
- **View-only link for your boss**: tap **🔗 Share this week** in the Timesheet, or **🔗 Share link** in Reports for any period. Then send it by text or email. When he opens it he sees a read-only Timesheet and Reports for that period, including hours, notes, overtime and benefits coverage, and he can download the PDF. You can choose whether pay amounts and notes are included.
  - The data is packed inside the link itself. Nothing is uploaded and there's no server or account. That means it's a **snapshot**: send a new link when you want him to see updates.
  - Photos are too big to fit in a link, so send the PDF when he needs to see them.
  - The link only works once the app is hosted at a public web address (see below).
- **Backup / restore** to a JSON file, photos included. Your data lives only on this device, so download a backup now and then.

## Install it on your phone

The app has to be opened once from a web address (`https://…`). After that it works fully offline.

1. **Host it (free) with GitHub Pages.** Merge this code into `main`. In the repository go to **Settings → Pages → Build and deployment → Source: GitHub Actions**. The included workflow publishes it to `https://<your-user>.github.io/<repo>/`. GitHub Pages on a private repository needs a paid GitHub plan. You can also upload the folder to Netlify or Cloudflare Pages, or to any static host.
2. **iPhone (Safari):** open the address, tap **Share → Add to Home Screen**.
3. **Android (Chrome):** open the address, tap **Install app** (or ⋮ → **Install app**).

## Voice input and offline use

Voice buttons use the browser's built-in speech recognition:
- **iPhone/iPad (Safari):** recognition usually runs on the device.
- **Chrome on Android/desktop:** recognition usually goes through Google's servers, so the 🎤 buttons need a connection. Offline, use the **microphone key on your phone's keyboard** to dictate into any box instead. The forgiving parser understands the dictated text the same way.
- **Firefox:** no speech recognition, so the 🎤 buttons are hidden. Keyboard dictation still works.

Everything else (clocking, editing, reports, PDFs) works fully offline.

## Files

- `index.html`, `css/app.css`: the UI
- `js/app.js`: app logic, storage, reports, PDF and CSV export, voice
- `js/parse.js`: forgiving date, time and duration parser
- `sw.js`, `manifest.webmanifest`, `icons/`: offline and install support
- `vendor/`: jsPDF and jsPDF-AutoTable (MIT), included so PDFs work offline

To update the app after changing files, bump `VERSION` in `sw.js` so installed copies pick up the change.
