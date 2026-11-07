# 28-hour check

A small website for staff whose visa allows at most 28 hours of work in any
7 days. Upload the workplace's shift schedule PDF, type your name, and it shows:

- whether any 7-day window goes over 28 hours
- hours worked and room left for each day
- which shows you could still add without going over

Everything runs in the browser. The PDF never leaves the device; parsed
schedules are saved in the browser's localStorage.

## Run it locally

ES modules don't load from `file://`, so serve the folder:

```
npx serve .          # or VS Code "Live Server"
```

Then open the address it prints.

## Tests

```
npm test             # node --test, no packages needed (Node 20+)
```

`tests/fixtures/schedule-1109.json` is the text layout of a real schedule with
every name replaced by a fake one. **Never commit a real schedule PDF or real
names**: on a free GitHub account the repo is public. `.gitignore` already
excludes PDFs.

## Where things live

| File | Job |
| --- | --- |
| `js/config.js` | Show times, break rules, the 28h limit. Change rules here only. |
| `js/hours.js` | `dayMinutes()` — the one hour calculation every worker goes through |
| `js/checker.js` | 7-day windows, unknown days, room left, show suggestions |
| `js/pdfParser.js` | Reads text positions with pdf.js, finds the header columns |
| `js/scheduleBuilder.js` | Turns positioned text into rows; warnings; merged-name splitting |
| `js/nameMatch.js` | Name normalising and exact matching |
| `js/storage.js` | Save / load / delete / backup, with validation |
| `js/render.js`, `js/main.js` | The page |
| `vendor/pdfjs/` | Pinned pdf.js (6.2.108), opened with `isEvalSupported: false` |

## Rules used

- Back-to-back shows are one block (first start to last end), so two in a row
  are 5.5h, not 6h.
- Unpaid break by the day's total shows: 3 shows 45 min, 4 shows 1h, 5 shows 3h.
- Leader of Show 1 starts 15 min early; leader of Show 5 ends 15 min late.
- Exactly 28h in a window is allowed.
- The Break column of the PDF is ignored.

## Deploy (GitHub Pages)

1. Push this folder to a repo (no PDFs, no real names).
2. Repo Settings → Pages → deploy from the main branch, root folder.
3. Share the link only with the people who should use it. The page has a
   `noindex` tag so search engines won't list it. There is deliberately no
   `robots.txt`: blocking crawlers would stop them from seeing that tag.

This is a helper, not legal advice. The limit covers all jobs combined.
