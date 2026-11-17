# ASIN Checker (Google Sheets)

Google Sheets tool (Apps Script, bound to your spreadsheet) that tells you, for a list of
ASINs, whether each one is **sellable** on Amazon: for every row it queries the Amazon
Selling Partner API (`GET /listings/2021-08-01/restrictions`) and writes the status into
the sheet — sellable, approval required, not eligible, not found. The marketplace is
chosen in the "Settings" tab among FR, DE, ES, IT, UK and NL — none is preselected.

Each user works in **their own** copy of the spreadsheet, with **their own SP-API keys**:
nothing is shared, and no key is ever stored in this repository.

---

# For a spreadsheet user

## Requirements

- An **Amazon Professional seller account**, accessed as the **Primary User** (needed to
  register the SP-API application).
- A **self-authorized SP-API application** created from Seller Central: it provides the
  three values to enter in the spreadsheet — `client_id`, `client_secret` and
  `refresh_token`.
- The **Seller ID** (merchant identifier) of the account.

The Listings Restrictions API is only accessible to applications with the right roles.
These roles and the associated quotas evolve: refer to Amazon's
[Selling Partner API documentation](https://developer-docs.amazon.com/sp-api/) rather than
to this file. If the application doesn't have the required rights, the check stops on an
`HTTP 403` error and the message points you to your application's roles.

## Installation

1. **Open the copy link you received** (or *File → Make a copy*). Always work in your copy.
2. Reload the copy. The **"ASIN Checker"** menu appears a few seconds after opening, in the
   menu bar next to "Extensions". It contains eight entries in three groups (keys, checking,
   display).
3. Click any menu entry: Google asks for your authorization. That's expected — a script
   can't do anything before that.

### The "Google hasn't verified this app" warning

On first authorization, Google shows a red warning screen. To continue:

> **Advanced** (bottom left) → **Go to ASIN Checker (unsafe)**

Google then shows a permissions screen with **three checkboxes, unchecked by default**.
Check **"Select all"**, then click **Continue** (there is no "Allow" button on this
screen).

This screen appears because the script **has not gone through Google's app verification
process**, which only applies to public applications. Here, the script is delivered
spreadsheet by spreadsheet: it only runs in your copy, under your account.

The requested permissions are deliberately minimal — you can check them on the consent
screen:

| Permission | What it allows |
|---|---|
| See, edit, create and delete **only this document** | read column A, write statuses. The rest of your Drive is out of reach |
| Display and run third-party web content | the menu, the keys dialog, the sidebar panel |
| Connect to an external service | reach `api.amazon.com` and `sellingpartnerapi-eu.amazon.com`, nothing else |

## Usage

**1. Enter the configuration** ("Settings" tab, created on the menu's first click)

- Menu → **Enter / edit keys**: `client_id`, `client_secret`, `refresh_token` of your
  SP-API application. Fields are masked and always empty when opened; leaving a field
  empty keeps the already-saved key. The tab only ever shows "saved" or "missing".
- Enter your **Seller ID** (B4) and pick the **marketplace** (B5) from the list.
- Menu → **Test connection**: the result and its date are written into the tab. On
  failure, the message tells you what to fix (e.g. an expired `refresh_token`).

**2. Paste the ASINs**

In the "ASINs" tab, paste your ASINs in **column A**, starting at row 2. Columns B, C and
D are filled in by the script — don't write anything there. Case and spaces don't matter;
your input is never rewritten.

**3. Run the check**

Menu → **Open panel**, then **Start / Resume**. The panel shows per-status counters, a
progress bar, and the last rows processed.

A long check is automatically split into several passes (Google's execution time limit):
the panel chains them without intervention. **Stop** cleanly interrupts after the current
ASIN; **Start / Resume** picks up exactly where it left off.

The **Check ASINs** menu entry does the same work, but without chaining: on a long list
you have to rerun it by hand for each pass. The panel is preferable.

**4. Read the results**

| Status (column B) | Meaning |
|---|---|
| `ELIGIBLE` | sellable as new |
| `APPROVAL_REQUIRED` | sellable after Amazon's approval (a request link exists) |
| `NOT_ELIGIBLE` | selling as new is refused |
| `NOT_FOUND` | ASIN unknown on this marketplace |
| `INVALID_ASIN` | not an ASIN (expected format: 10 characters, letters and digits) |
| `ERROR` | temporary failure (network, quota, Amazon incident) — will be retried |

Column C gives the restriction code returned by Amazon, column D the check date.

Menu → **Create / repair Summary** creates a "Summary" tab: count and percentage per
status, total, remaining to check, date of the last run.

## Good to know

- **Don't rename the tabs** "ASINs", "Settings" and "Summary": the script finds them
  by name and would otherwise recreate an empty one.
- The **"Summary" tab is entirely generated** by the script. "Create / repair Summary"
  rewrites it from scratch: don't enter anything there, it would be lost.
- **Closing the panel** (or the spreadsheet) stops the chaining after the current pass.
  Rows already checked are kept; "Start / Resume" continues.
- An **`ERROR` row is retried once per run chain**. If it comes back as `ERROR`, the check
  ends instead of looping — retry later.
- Other statuses are **final**: they are never re-checked. To re-check everything,
  menu → **Clear results** (clears B, C and D; column A is kept).
- Row colors come from conditional formatting. Menu → **Apply colors** puts them back if
  they were cleared.
- **Time zone**: displayed dates follow the spreadsheet's time zone (*File → Settings →
  Time zone*), not the script's. A copy inherits the time zone of the template it was made
  from — if it isn't yours, check and adjust it. Changing the time zone does not
  shift dates already written, only the ones written afterwards.
- **Sorting**: use *Data → Create a filter* on the full `A:D` range. Never sort column A
  alone — columns B, C and D wouldn't follow, and each status would end up next to the
  wrong ASIN.

---

# For a developer

The code lives in `src/` and syncs with the Apps Script project via
[clasp](https://github.com/google/clasp). The script is **bound to a spreadsheet**
(container-bound): it doesn't exist without one, so you first need to create the
spreadsheet + script pair.

```bash
npm install -g @google/clasp
clasp login                            # once per machine
```

Before the first `clasp push`, **enable the Apps Script API** for your account:
[script.google.com/home/usersettings](https://script.google.com/home/usersettings) →
"Google Apps Script API" to **On**. Without this, `clasp push` fails with an API access
error.

1. Create a **Google Sheet** (this will be the template spreadsheet, or your test
   spreadsheet).
2. In that spreadsheet: **Extensions → Apps Script**. An empty project is created and
   bound to the spreadsheet.
3. In the editor: **Project Settings** (gear icon) → copy the **Script ID**.
4. From the repository root:

   ```bash
   cp .clasp.json.example .clasp.json
   ```

   then replace `REMPLACER_PAR_LE_SCRIPT_ID` with the copied ID. `rootDir` must stay
   `"src"`: that's what makes only `src/` get pushed, and `tests/` never reaches Apps
   Script.
5. Push the code:

   ```bash
   clasp push                           # pushes src/ to the script
   clasp open                           # opens the Apps Script editor
   ```

6. Reload the spreadsheet: the "ASIN Checker" menu appears.

`clasp push` overwrites the online version, **`appsscript.json` included** — so the
manifest, its OAuth scopes and the runtime. Any change made directly in the editor (by you
or by a client) is lost: run it deliberately only, and `clasp pull` first if in doubt.

`.clasp.json` and `.clasprc.json` are **not versioned** (they contain the spreadsheet's
identifier and your Google tokens): everyone creates their own from
`.clasp.json.example`.

Tests run outside Apps Script, with no dependency:

```bash
node tests/classify.js     # 244 assertions
```

They cover the pure functions (classification of SP-API responses, selection of rows to
process, Summary formulas, colors). Everything touching `SpreadsheetApp`, `UrlFetchApp`,
`LockService` or `PropertiesService` is covered by the manual checklist.

**[CLAUDE.md](CLAUDE.md)** (in French) is the technical reference: role of each file,
mechanics of a run, secret non-leak rules, manual verification checklist. Read it before
any change.

## Security

- The three SP-API keys live **only** in the script's properties (`PropertiesService`),
  never in a cell, a log, an error message or the repository. A single private function
  reads them, to request an access token from Amazon.
- The access token stays internal: it only ever appears in the SP-API request header.
- From Amazon's response bodies, the script extracts only the strict minimum (token,
  error code, restrictions); displayed messages come from a closed allowlist.
- **Copying the spreadsheet does not copy the script's properties**: every copy starts
  without keys, and its user must enter their own. This is intentional.
- Limit to be aware of: the script's properties are readable by anyone who can open the
  Apps Script editor of **their own** copy. Keys are protected from the sheet, not from a
  user who already has editor access to the script.

## Known limitations

- Checks the **New** condition only; `used_*`, `collectible_*` and `refurbished_*`
  conditions are ignored.
- **Europe only for now** (FR, DE, ES, IT, UK, NL) — North America not supported yet
  (host `sellingpartnerapi-eu.amazon.com`).
- About 1.5–2 ASINs per second in practice: roughly 10 minutes per 1,000 ASINs
  (measured: 624 ASINs in ~6 minutes).
- No scheduled trigger: a check always starts from a click.
- One check at a time per spreadsheet (lock); a second run is refused with a message.
- Statuses are not translated: they are the raw values returned by Amazon.
