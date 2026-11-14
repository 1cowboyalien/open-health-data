# Handoff: Open Health Data (Epic/MyChart → local database → dashboard)

Written 2026-11-13 from a Claude chat session, for continuing in Claude Code.
Project folder: `/Volumes/ssd70/Cancer/open-health-data/`

---

## 1. Goal

An **open-source project** that collects a patient's own medical records into one local database, shows them in an interactive dashboard with graphs (trends, patterns, relationships), and publishes them as an **open dataset**.

- **Start with blood work lab results.** Many more data types follow later: vitals, medications, diagnoses, procedures, MRD, flow cytometry, proteomics, imaging, pathology, genomics.
- **First real source:** MD Anderson (Epic/MyChart). Other health systems later.
- **Inspiration:** osteosarc.com/timeline, Sid Sijbrandij's public osteosarcoma data. Simple TSV downloads, with events and lab measurements overlaid on one timeline.
- **The user's preferred working style:** small steps. Capture real data first, look at the fields, then design. Don't build the whole system at once.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Data access | Epic FHIR R4 through a SMART on FHIR patient login (standalone launch with PKCE). The HealthEx connector stays optional, for exploring data in chat. |
| Storage | **SQLite** on the user's own computer. No database encryption, since the data is meant to be public. Full-disk encryption stays on. |
| Secrets | OAuth tokens never go in code, git or the database. Use the macOS keychain (Python `keyring`) once refresh tokens exist. |
| Publishing | Two layers: (1) a private raw store with tokens; (2) a public export that strips fraud-enabling identifiers (birth date, address, record numbers, insurance IDs). Whether to publish the name and whether to shift dates are still open (see §9). |
| Raw data | Every API response is saved **unchanged** before any processing, so the rest can always be rebuilt from it. |
| Times | Store in UTC and convert to local time only for display. |
| Codes and units | LOINC for labs, UCUM for units, RxNorm for medications, SNOMED CT/ICD-10 for conditions and procedures. |
| Core data model | Everything sits on one timeline per participant. Each item is one of three things: **measurements** (labs, vitals, proteomics…), **events** (medications, diagnoses, procedures, treatments) or **files** (imaging, genomics, pathology: stored on disk, recorded in the database). |
| Planned tables | `participants`, `sources`, `raw_documents`, `measurements` (with a `domain` column), `events`, `files`, `concepts` (code mapping), `reports` (panels), `sync_log` |
| Lab export format | Keep all 14 osteosarc.com columns (§6), plus `loinc_code`, `collected_at` (UTC date and time), `source`, `result_id`, `report_id`, `value_original`, `unit_original`, `participant_id` |
| Genomics, later | nf-core pipelines (e.g. nf-core/sarek) for raw FASTQ/BAM/VCF files, only if raw sequencing data exists |
| Licenses | Code: MIT (added). Data license still open (CC0 or CC-BY). |

## 3. Done so far

### GitHub: https://github.com/1cowboyalien/open-health-data (public)
- `README.md`: project description, how it works, data format, privacy, terms.
- `LICENSE`: MIT.
- `TERMS.md`: terms of use (the Epic app's Terms URL points here).
- `callback.html`: OAuth return page served by **GitHub Pages** at https://1cowboyalien.github.io/open-health-data/callback.html (verified loading). It shows the `code`/`state` for the user to paste into the script. It runs entirely in the browser and clears the query string from history.

### Epic app at fhir.epic.com
- **App name:** "erica pull". **App ID:** 64997. **Status:** "Test" (ready for sandbox). **NOT** ready for production. That step locks the app permanently.
- **Non-production client ID:** `036c8b49-3950-41e5-bcec-c27f89822fa9`
- **Production client ID:** `47c5195d-ab13-45a0-b675-82d1af3cafe4`
- **Settings:** audience Patients; Automatic Client Distribution **USCDI v3**; all 247 patient APIs selected (R4 plus older versions); public client (not confidential); R4; SMART v1; unconstrained FHIR IDs.
- **Redirect URIs:** `http://localhost:8765/callback` (sandbox) and `https://1cowboyalien.github.io/open-health-data/callback.html` (needed for production).
- **Documentation URL:** the GitHub repo. **Terms URL:** `.../blob/main/TERMS.md`.
- **Purposes:** individual access to their health information, research. **Users:** individual/caregiver, researcher.
- **Data Use Questionnaire:** answered by the user.
- **Not yet done:** thumbnail and screenshots, which may be required before production.

### Script: `epic_pull.py` (this folder; Python standard library only)
- Runs a SMART standalone login with PKCE, then downloads Patient, Observation (labs, vitals), DiagnosticReport, Condition (problems), MedicationRequest, MedicationDispense, AllergyIntolerance, Immunization, Procedure and Encounter. Follows paging and saves each response unchanged to `epic_raw/<timestamp>/`.
- Then reads every `Medication/<id>` that an order or dispense points to (Epic can't search Medication by patient) and saves them unchanged in `medications_p1.json` (a "collection" Bundle); failures go to `medications_errors.json`. This is where RxNorm codes are.
- **Two redirect modes:**
  - Default `http://localhost:8765/callback`: a local server catches the code.
  - `--redirect-uri https://...callback.html`: paste mode, where the user pastes what the page shows.
- `--scope` asks for `patient/<Resource>.read` for each resource by default. `--base` sets the FHIR server (sandbox by default).
- Saves `_token_info.json` (token response **without** any token values), `_summary.json`, and `<label>_ERROR.json` for failed calls.
- **Tested:** it compiles; paste mode parses both full URLs and query strings; sandbox login and token exchange **work end to end** (two runs, see §4).

### Analysis of the osteosarc.com lab TSV (`reference/osteosarc-lab-results.tsv`)
- 5,261 rows, 14 columns, 130 harmonized `measurement` names drawn from 493 original names, 153 draw dates from 2022-10-07 to 2026-10-08.
- **Good ideas to copy:** a harmonized test name plus the original name; a standard reference range plus the lab's own range (they differ in 2,156 rows); a `value_qualifier` column (`<`, `>`, `>=`) that keeps `value` always numeric.
- **Gaps that LOINC and a source column would fix:**
  - Different tests merged under one name: BNP with NT-proBNP; eGFR mixing creatinine and cystatin C and MDRD and CKD-EPI 2021; CK-MB as %, U/L and µg/L.
  - Unconverted units: one row each in a different unit for Free T4 (ng/L vs ng/dL), Iron, Phosphorus, Testosterone and Transferrin.
  - Date only, with no time or source: 547 same-day same-test pairs, some apparently duplicates.
  - Duplicate names: "Specific Gravity" vs "Specific Gravity, Urine"; "pH, Urine" vs "Urine pH".

### Knowledge Base
- Exists at `/Volumes/ssd70/Cancer/KnowleageBase/` (spelled that way on disk), with `README.md` as the index.
- The `knowledge-base` skill is installed for Claude Code at `~/.claude/skills/knowledge-base/SKILL.md` (it loaded in a session on 2026-11-14); the source is in `handoff/` here.
- **Saved 2026-11-14:** `epic-fhir-patient-apps.md` (the §7 Epic registration pitfalls, GitHub Pages and firewall notes on the callback, granted scopes vs CapabilityStatement, medication resources), `js-testing-without-node.md` (osascript testing, Chart.js pitfalls) and `claude-desktop-app-tips.md` (browser pane, Terminal panel, `gh` sign-in). `claude-code-skills.md` was corrected: `python3` now works.

## 4. ~~Current blocker~~ RESOLVED: 403 on every data call

**Resolved 2026-11-13, 12:22:** the third run (`epic_raw/20261113-122219`) was granted all `patient/*.read` scopes and downloaded data. The cause was propagation delay. Field findings are in `notes/field-inventory-sandbox.md`. New open item: the app is "not authorized for Outside Record Results" (Care Everywhere), see that note.

History:
Two sandbox runs (12:03 and 12:05 on 2026-11-13), both logged in as `fhircamila`:
- Login, approval and token exchange **succeed**. Patient FHIR ID: `erXuFYUfucBZaryVksYEcMg3` (Camila Lopez).
- The token's granted `scope` is only `fhirUser launch/patient openid`. Every FHIR call, including `Patient/{id}`, returns **HTTP 403 with an empty body**.
- The second run asked for `patient/*.read` scopes explicitly. Epic still dropped them.
- **Most likely cause:** propagation delay. The API list was re-saved at about 11:46, only 20 minutes before. During editing, the API selection had been lost once after the questionnaire page navigated away, and was then re-added and saved. Developer guides cite 30–60 minutes and up to a day for changes to reach the sandbox.

**What to do:**
1. After about an hour (from about 13:00 on 2026-11-13), run the same command again (§8, step 1). Success looks like a "Granted scope:" line listing `patient/Observation.read` and others, with numeric counts.
2. If it's still a 403 after several hours:
   - Open fhir.epic.com → Build Apps → "erica pull" and confirm the "Selected" API list isn't empty and the status is still "Test." The questionnaire round trip emptied it once.
   - Try `fhirderrick / epicepic1`.
   - Read Epic's Troubleshooting and FAQ pages on fhir.epic.com about 403 errors and scopes.
   - Contact open.epic support, if needed.

## 5. Files

| Location | What it is |
|---|---|
| `/Volumes/ssd70/Cancer/open-health-data/epic_pull.py` | **Canonical** download script, the latest version with `--scope` and the granted-scope print-out. Newer than any copy sent in chat. |
| `.../open-health-data/epic_raw/20261113-120357/`, `.../20261113-120552/` | The two failed sandbox runs: only `_token_info.json`, `_summary.json` and `*_ERROR.json`. **Never commit `epic_raw/`.** |
| `.../open-health-data/reference/osteosarc-lab-results.tsv` | The osteosarc.com lab download, the reference format |
| `.../open-health-data/handoff/knowledge-base-SKILL.md` | The Knowledge Base skill, for installing in Claude Code |
| `.../open-health-data/.gitignore` | Keeps `epic_raw/`, databases and secrets out of git |
| `.../open-health-data/flatten_labs.py`, `flatten_meds.py` | Newest pull per site → `local/labs_all.tsv`, `local/meds_all.tsv`, `local/med_dispenses.tsv` (private) |
| `.../open-health-data/make_lab_view.py`, `med_timeline.py`, `med_timeline.js` | Build the private viewer `local/labs.html` (labs + treatment band) |
| `.../open-health-data/reference/lab_concepts.tsv`, `med_classes.tsv` | Public, editable naming/class rules for labs and drugs |
| `.../open-health-data/CLAUDE.md` | Standing rules for Claude Code in this folder |
| GitHub repo | README, LICENSE, TERMS.md, callback.html. This folder is **not yet a git clone** of it (§8, step 0). |
| `/Volumes/ssd70/Cancer/KnowleageBase/README.md` | Knowledge Base index |

## 6. Reference formats

**osteosarc.com lab TSV columns (keep all of them, with the same names):**
`date, category, measurement, test_name_original, panel_name, unit, value, reference_low, reference_high, source_reference_low, source_reference_high, flag, out_of_range, value_qualifier`

**Columns we add:** `loinc_code, collected_at, source, result_id, report_id, value_original, unit_original, participant_id`

**FHIR fields to check first in real lab Observations:**
- Is `code.coding` with a LOINC code always present?
- `effectiveDateTime` vs `issued`: do we get the draw time?
- `valueQuantity` (value, unit, UCUM `code`) vs `valueString`, and how comparators (`<`, `>`) appear.
- `referenceRange` (low/high/text), `interpretation` (H/L codes).
- `category`, `status`, and how `DiagnosticReport.result` links Observations into panels.
- `specimen`, `performer`.

## 7. Lessons learned 2026-11-13 (saved to the Knowledge Base 2026-11-14, see §3)

- **"Save & Ready for Production" locks an Epic app.** Use "Save & Ready for Sandbox" and test first. *(Observed)*
- **Production needs at least one https redirect URI.** `http://localhost` alone shows a warning and blocks production. *(Observed)*
- **Epic's Terms URL rejects `#`** ("A restricted character has been entered"). Link to a standalone page. *(Observed)*
- **The "Open Data Use Questionnaire" button navigates away from the edit page.** Afterwards the API selection was empty and had to be re-added. Re-check all fields before saving. *(Observed)*
- **The first save doesn't keep the documentation URL** if it was set by script. Re-enter it on the edit page. *(Observed)*
- **A new non-production client ID reached the sandbox login within about 30 minutes,** but data scopes were still not granted about 20 minutes after the API list was re-saved. *(Observed. Whether the scopes arrive later is untested.)*
- **GitHub Pages works as an https OAuth callback.** The site was live within about 2 minutes of being enabled. *(Verified in use)*
- **Claude's computer-use access to Safari is view-only;** clicking and typing are blocked. Use the Claude app's built-in browser for web steps, or have the user do them.
- **Running Python on the Mac:** run from the folder containing the script, or `cd` there first. The `can't open file … No such file or directory` error meant the wrong folder. *(Observed)*

## 8. Next steps, in order

0. **Set up the folder in Claude Code**
   - Install the Knowledge Base skill: `mkdir -p ~/.claude/skills/knowledge-base && cp handoff/knowledge-base-SKILL.md ~/.claude/skills/knowledge-base/SKILL.md`
   - Optionally add the Knowledge Base lines from `CLAUDE.md` to `~/.claude/CLAUDE.md` as well.
   - Turn this folder into a clone of the GitHub repo **without losing local files**: `git init`, `git remote add origin https://github.com/1cowboyalien/open-health-data.git`, `git fetch origin`, `git checkout -t origin/main`. Confirm `.gitignore` is in place before any `git add`.
1. **Re-run the sandbox pull** once Epic has applied the API list (§4). The user runs this in Terminal and logs in themselves:
   ```
   cd /Volumes/ssd70/Cancer/open-health-data
   python3 epic_pull.py --client-id 036c8b49-3950-41e5-bcec-c27f89822fa9
   ```
   Log in with Epic's public sandbox test patient: `fhircamila` / `epicepic1` (backup `fhirderrick` / `epicepic1`).
2. **Look at the real fields** in `epic_raw/<latest>/observation_labs_p*.json` and the DiagnosticReports, using the §6 checklist. Write a short field-inventory note, and talk through the layout with the user **before** building anything.
3. **Design the SQLite schema** from what the data shows (the planned tables in §2), and agree it with the user.
4. **Go to production for MD Anderson.** ✅ **DONE 2026-11-13 ~12:33 PST:** the user clicked "Save & Ready for Production" and kept the name "erica pull". Epic confirmed it: "marked as ready for production use"; My Apps shows "Production Ready, Client ID Downloads: 0".
   - **Activation test:** open MD Anderson's authorize URL with the production client ID (no login needed). While the app isn't activated, it shows "OAuth2 Error: Something went wrong trying to authorize the client", the same page a fake client ID gets (checked at 12:34). Once activated, it should show the MyChart login instead. Epic says distribution can take up to about 12 hours.
   - ✅ **LIVE at MD Anderson by 14:02 PST 2026-11-13** (about 1.5 h after production): the production client ID now gets a 302 redirect to `my.mdanderson.org/mychart/Authentication/OAuth/Start`; a fake ID still gets the OAuth2 Error page.
   - ✅ **First real pull, 18:04 PST 2026-11-13** (`epic_raw/20261113-180417-mdanderson`): Erica logged in through MyChart. **No paste needed:** MD Anderson accepts the `http://localhost:8765/callback` redirect in production, so the default mode works. Command: `python3 epic_pull.py --client-id 47c5195d-ab13-45a0-b675-82d1af3cafe4 --base https://fhir.mdanderson.org/FHIR/api/FHIR/R4/`
   - Data shape (no clinical details): labs are 2 pages; LOINC on 94%; all have `effectiveDateTime`, `issued` and `specimen`, none have `performer`; most have `valueQuantity` (with a unit nearly always, a UCUM code on most), some `valueString`, a few with no value; comparator `<` on a handful; a referenceRange on most; coded interpretation H/L/A on about a quarter. Units need cleanup (e.g. `"mmol/L "` with a trailing space, non-UCUM `K/uL`). (Correction: the labs search showed no Outside Record warning, but other searches did; see below.)
   - ✅ **Multiple health systems, 2026-11-13.** Auto-distribution means the app works at any Epic customer: find the address with `python3 find_endpoint.py "<name>"`. Four more Epic systems were pulled the same evening. The list of Erica's systems and their addresses is **private** in `local/sites.md` (git-ignored); don't put it in this file, since it goes to the public repo.
     - `epic_pull.py` now: `--site <name>` puts the site in the folder name (`epic_raw/<timestamp>-<site>`) and writes `_source.json` (site, base, client ID, UTC time); it prints the sandbox test-login hint only for the sandbox; in paste mode it **picks up the code from the macOS clipboard** when the user clicks Copy on callback.html (stdin still works).
     - **Some hospitals' web firewalls block the `localhost` redirect.** One returned Imperva "Access denied / Error 15" on the MyChart OAuth page whenever `redirect_uri=http://localhost…` was in the URL, but loaded fine with the GitHub Pages callback. → **Default to `--redirect-uri https://1cowboyalien.github.io/open-health-data/callback.html`** for all sites.
     - Every site returns OperationOutcome warnings like "Client not authorized for <Resource> - Outside Record …" (also "Patient-Reported Surgical History", "External Radiotherapy Summary") even though those APIs are selected on the app. They're probably not enabled in each hospital's copy of the client. This matters less when pulling each hospital directly, but Care Everywhere copies from hospitals we don't pull are missing. Not verified why.
     - Overlap between sites: deduplication is built in (same LOINC or name + collection minute + value + unit). In practice the only cross-site same-day results were a pathology consult (one system re-reviewing another's specimen), not repeated blood tests; 9 duplicates were within one site.
   - **Combining labs (2026-11-13):** `python3 flatten_labs.py` (newest pull per site → `local/labs_all.tsv`, osteosarc-style columns + `source`, `value_original`, `unit_original`, `unit_note`), then `python3 make_lab_view.py` (→ `local/labs.html`; the same test across hospitals is joined by LOINC + unit, and points are colored by hospital).
     - Unit cleanup in `flatten_labs.py`: a synonym map (K/uL = 10³/uL = x10E3/uL → `10*3/uL`; M/uL = x10E6/uL → `10*6/uL`; gm/dL → g/dL; IU/L → U/L; second(s) → s; % HbA1c → %); fixing mojibake (`10Â³/uL` is UTF-8 read as Latin-1); a real conversion for magnesium mEq/L → mg/dL (×1.215, checked against another site's medians); and relabeling cell counts whose 10³/10⁶ label contradicts the values (only when medians agree within 2×), noted in `unit_note`. One site had mislabeled RBC and IG units. Left split on purpose: urine microscopy cells/HPF vs cells/uL.
     - Numbers sent as text (`valueString` that is exactly a number, optionally `<`/`>`) become values, noted in `unit_note`; BP "117/78", tube/ID numbers and words stay text. Signatera: the MTM readout is text with no unit → value + unit `MTM/mL` (Natera's unit, noted as added); the paired "SIGNATERA TEST RESULT" POSITIVE/NEGATIVE becomes the flag (POSITIVE → `A`). "Test Not Performed" stays text.
     - Viewer x-axis is a fixed time scale for every test (from the first month of the earliest result to the latest), with year gridlines, so charts line up when switching tests. Before May 2023 is compressed into the left 15% (`COMPRESS_BEFORE`/`COMPRESS_WIDTH` in make_lab_view.py; only in windows wider than 3 years). A time-window control (From/To sliders + presets: All, Since May 2023, last 24/12/6/3 months) applies to every test and is remembered in the browser (localStorage); the y-axis fits the visible points. **Compare mode:** tick tests in the list to stack them as separate charts on the same time window, with a fixed-width y-axis so the dates line up; per-chart height (−/+, 70–600 px), ↑/↓ reorder, × remove; hovering draws a date guide line across all charts. Selection, order, heights, window and mode persist (localStorage keys `labs.*`).
     - **Medications and treatment timeline (2026-11-14):**
       - `python3 flatten_meds.py` → `local/meds_all.tsv` (one row per MedicationRequest: drug as written + normalized, RxNorm codes from the Medication records, ordered and administered dose, dosage text, route, frequency, start/end with where they came from, status, intent, category, site, request id, dispense count and dates) and `local/med_dispenses.tsv` (one row per MedicationDispense).
       - `reference/med_classes.tsv` (public, editable, like `lab_concepts.tsv`): regex on the drug name → normalized drug name + simple class (HER2/targeted, chemo, supportive/antiemetic, steroid, contrast/imaging, pain, anticonvulsant, other). First match wins; unmatched → other.
       - Findings (no clinical details): every order uses `medicationReference` (no inline code), so RxNorm needs the Medication reads; compounded infusion products have no RxNorm code. "Generic External Medication" orders are reconciled outside records; their Medication records are placeholders too, so the real drug is not available (Outside Record data is blocked for our client at every site). Dispenses: hospital dispenses are "Unit Dose" (close to "given"); outpatient fills are "First Fill"; outside pharmacies don't appear. An order's end date is often its validity, not when the drug stopped.
       - **Capability check (2026-11-14, `<base>metadata`, no login):** all five sites list MedicationAdministration, MedicationDispense and Medication (read + search; Medication only by `_id`). Our client is granted `MedicationDispense.read` and `Medication.read` but **not** MedicationAdministration, even though every eligible patient API is selected, so it's most likely not offered to patient apps. A production app can't gain APIs; it would need a new app. MedicationStatement isn't offered in R4.
       - **Treatment band in `local/labs.html`:** rows built by `med_timeline.py` (one per drug + setting: "given at hospital/clinic" or "taken at home"); drawing and editing in `med_timeline.js`, which `make_lab_view.py` inlines. Same compressed x-axis, window sliders and hover guide as the labs (same fixed y-axis width), in single and compare mode. Bars = ordered periods (home orders end where the next order of the same drug starts; no end date → 30 days, dashed). Markers: ● confirmed by a hospital dispense, ◆ one-time order marked completed, ■ pharmacy fill, ○ assumed dose from the schedule (doses/day, every N days, days on/off; none when as needed), ▲ confirmed or entered by the user, ✕ skipped. Marker color = site. Class chips choose which kinds are shown.
       - **Editing:** click a bar to change start/end, schedule, dose, note or hide it; click an assumed dose to cycle taken → skipped → assumed (only when doses are ≥4 px apart, otherwise the editor opens with that date); "+ Add medication" has the same fields as the records. Changes are kept in localStorage (`labs.txedits`) and never change the records; **Export** saves `med_edits.json`, which goes in `local/`. `make_lab_view.py` builds it back in (the newer of file and browser wins), and `flatten_meds.py` adds entered medications to `meds_all.tsv` with source `you`. **Import** loads a file into another browser.
       - Testing without node: the pure functions in `med_timeline.js` run under `osascript -l JavaScript` with small stubs for `store` and `D`; the page's whole script is syntax-checked with `new Function(...)` the same way. Watch for name clashes with the viewer's globals (e.g. `sel`), and defer redraws out of Chart.js click handlers (`setTimeout(render,0)`), or Chart.js throws `handleEvent` errors.
       - Rebuild everything: `python3 flatten_labs.py && python3 flatten_meds.py && python3 make_lab_view.py`.
     - **Harmonized test names:** `reference/lab_concepts.tsv` (public, no personal data) maps equivalent LOINC codes, plus name rules for miscoded results, to one `measurement` name (new `concept` column), and can fill a missing unit. The viewer groups by concept, else by LOINC, else by name. Official LOINC names were checked on tx.fhir.org. Found: one site sent CA 15-3 under LOINC 5587-1 (arsenic, 24h urine). Kept apart on purpose: eGFR by formula (CKD-EPI 2021 / CKD-EPI / MDRD), and manual vs automated differentials. One site's eGFR is capped at ">89" (comparator kept).
   Original notes for this step:
   - Add a thumbnail and screenshots if Epic requires them, then re-check every field.
   - Click "Save & Ready for Production."
   - In "Review & Manage Downloads," confirm MD Anderson shows as activated. Distribution can take hours to days.
   - MD Anderson's R4 address, **verified 2026-11-13** against https://open.epic.com/Endpoints/R4: `https://fhir.mdanderson.org/FHIR/api/FHIR/R4/` (metadata returns 200; its SMART config points login to `epicproxy.et0909.epichosted.com/APIProxyPRD/oauth2/...`). Use this as `--base`, not the epicproxy address.
   - App check (2026-11-13): all 247 selected APIs are tagged USCDI v3 + Patient + not deprecated, and every eligible API is selected (including Outside Record Results). Public client, no refresh tokens. So the app qualifies for automatic distribution. Thumbnail and screenshots are optional (not required fields).
   - The user runs the script with the production ID, `--base` set to that address, and `--redirect-uri https://1cowboyalien.github.io/open-health-data/callback.html`.
5. **Conversion:** LOINC → analyte mapping, unit conversion, duplicate removal, flags. Also convert the osteosarc TSV into the same format, so the two datasets combine.
6. **Automatic sync, later:** create a second Epic app that's a confidential client with persistent access and rolling refresh tokens (needs a JWKS URL). Keep tokens in the keychain. Run a nightly job with a date window going back 7 days and upsert by source plus FHIR ID.
7. **Public export:** versioned TSVs plus a data dictionary. **Dashboard:** a timeline with event overlays, trends with shaded reference ranges, correlations.
8. ~~**Knowledge Base:** save the §7 lessons.~~ ✅ Done 2026-11-14 (see §3). Keep adding lessons when the user says "update the knowledge base."

## 9. Open decisions (ask the user)

- **Public export:** labs only, or also medications, diagnoses and procedures? Name or anonymous ID? Exact dates or shifted dates?
- **Data license:** CC0 or CC-BY.
- **Whose data:** only the user's own, or family members' too (which needs MyChart proxy access and their consent)?
- **Dashboard approach:** Streamlit/Dash (quick) or a publishable web page.
- **Which data type comes after blood work.**
- Whether to rename the Epic app from "erica pull." The name is shown to patients on the MyChart approval screen, and it can't be changed after production.

## 10. Guardrails

- Never mark the Epic app "Ready for Production" without the user's explicit go-ahead.
- Never enter passwords; the user logs in themselves. Never store or commit tokens, and never commit `epic_raw/` or real health data.
- The Data Use Questionnaire and terms acceptance belong to the user.
- Real records contain the user's identifiers. That's fine locally; strip identifiers only in the public export.
- Verify anything time-sensitive before relying on it: Epic UI, endpoints, propagation times.
