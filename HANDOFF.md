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
- Runs a SMART standalone login with PKCE, then downloads Patient, Observation (labs, vitals), DiagnosticReport, Condition (problems), MedicationRequest, AllergyIntolerance, Immunization, Procedure and Encounter. Follows paging and saves each response unchanged to `epic_raw/<timestamp>/`.
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
- Exists at `/Volumes/ssd70/Cancer/KnowleageBase/` (spelled that way on disk), with `README.md` as the index. **No topics yet.**
- A `knowledge-base` skill was written and offered to save in the Claude app. For Claude Code, install it at `~/.claude/skills/knowledge-base/SKILL.md`; the file is in `handoff/` here. Not confirmed installed.
- Today's candidate lessons are **not yet saved** to the real Knowledge Base (only a demo copy): Epic registration pitfalls, and GitHub Pages as an https OAuth callback. See §7.

## 4. Current blocker: 403 on every data call

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

## 7. Lessons learned today (candidates for the Knowledge Base)

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
4. **Go to production for MD Anderson**, with the user's explicit OK, because it locks the app:
   - Add a thumbnail and screenshots if Epic requires them, then re-check every field.
   - Click "Save & Ready for Production."
   - In "Review & Manage Downloads," confirm MD Anderson shows as activated. Distribution can take hours to days.
   - MD Anderson's R4 address, from Epic's endpoint list: `https://epicproxy.et0909.epichosted.com/APIProxyPRD/api/FHIR/R4/`. **Re-check it** against open.epic.com/MyApps/Endpoints; it was read through a summarizing tool.
   - The user runs the script with the production ID, `--base` set to that address, and `--redirect-uri https://1cowboyalien.github.io/open-health-data/callback.html`.
5. **Conversion:** LOINC → analyte mapping, unit conversion, duplicate removal, flags. Also convert the osteosarc TSV into the same format, so the two datasets combine.
6. **Automatic sync, later:** create a second Epic app that's a confidential client with persistent access and rolling refresh tokens (needs a JWKS URL). Keep tokens in the keychain. Run a nightly job with a date window going back 7 days and upsert by source plus FHIR ID.
7. **Public export:** versioned TSVs plus a data dictionary. **Dashboard:** a timeline with event overlays, trends with shaded reference ranges, correlations.
8. **Knowledge Base:** when the user says "update the knowledge base," save the §7 lessons (Epic registration pitfalls as a new topic; GitHub Pages as an https OAuth callback).

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
