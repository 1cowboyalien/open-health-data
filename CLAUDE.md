# Open Health Data: Claude Code instructions

Start by reading `HANDOFF.md` in this folder. It has the full state of the project, decisions, IDs, the current blocker and next steps.

## Working style
- Small steps. Capture real data and look at the fields with the user before designing or building larger pieces.
- Explain briefly what you're about to do and what changed.

## Rules
- Never mark the Epic app "Ready for Production" without the user's explicit go-ahead. It locks the app.
- Never enter passwords; the user logs in to MyChart and fhir.epic.com themselves.
- Never write OAuth tokens to code, git, logs or the database. Use the macOS keychain (`keyring`).
- Never commit `epic_raw/`, databases or real health data (see `.gitignore`).
- Save raw API responses unchanged before processing. Store times in UTC.
- Keep the 14 osteosarc.com lab columns, plus the added columns listed in `HANDOFF.md` §6.
- `epic_pull.py` in this folder is the canonical version of the script.

## After every pull (do this without being asked)
1. Rebuild: `python3 flatten_labs.py && python3 flatten_vitals.py && python3 flatten_meds.py && python3 make_lab_view.py`
2. Run `python3 check_new_data.py` and work through what it lists:
   - **Drugs needing a half-life:** look each up on its US label (DailyMed, section 12.3), and add a row to `reference/med_halflife.tsv` with the label sentence, link and date (basis `label`). If no label states one, add a best estimate (basis `estimate`, reasoning in `refers_to`; the viewer draws these grey and dotted). If a half-life doesn't apply (IV fluids, flushes, local/topical use, vaccines), add basis `none` with the reason.
   - **Drugs with no class rule:** add a rule to `reference/med_classes.tsv`.
   - **New lab tests at only one hospital:** check whether another hospital has the same test under another code or name; join true matches in `reference/lab_concepts.tsv` (keep different formulas or methods apart). Give new tests an abbreviation/full name in `reference/lab_names.tsv` where useful.
   - **Sensitive drugs** (e.g. reproductive or obstetric): put their class and half-life rows in the private `local/med_classes.local.tsv` / `local/med_halflife.local.tsv`, never in `reference/`.
3. Rebuild again, check the viewer, then `python3 check_new_data.py --mark-reviewed`.
4. Tell the user what was added, what was estimated and what was skipped.

## New Natera (Signatera) files
- Extract a new report PDF with `swift ../records/pdftext.swift in.pdf out.txt`, add the text path to `local/mrd_sources.json`, save emailed allele .xlsx files in its `allele_dir`, then run `python3 flatten_mrd.py`. If it says "new variants", run `python3 liftover_mrd.py --ensembl --genes` (sends only chromosome, position and base to Ensembl). Then `python3 make_lab_view.py`.

## Viewer
- Serve it with `python3 serve_viewer.py` (port 8766, this Mac only; `--lan` for the home Wi-Fi). Don't use `python3 -m http.server` for it any more: that lists every private file in `local/` and doesn't save shared edits.
- Usage stats and a health meter: `/stats` on the viewer (this Mac and the home network only; `usage.py`, `usage.js`, `stats_view.html`). Visits are logged to the private `local/usage.sqlite`; the page reports only control/panel code names, never health values or Ask text.
- Start view (what a new visitor lands on): the "Start view" button next to Clear saves the current view to private `local/start_view.json` (this Mac and the home network only; `start_view.js`, injected by `serve_viewer.py`). Browsers that already have their own view keep it until they use "Put this browser back".
- Top bar fold (`navfold.js`, built into the page): on phones the pinned bar starts folded to one line (time window + Controls ▾); ▴ Fold folds it anywhere. A Keyframes panel pinned to the top bar folds to its title line once you scroll into the charts (click to open; folds again after ~150 px). Fold choice is kept in localStorage `navfold.*`, not in the Start view.
- Panels: every panel header ends with the same group at the right, ⤒ ↑ ↓ ⤓ · − + · ▾ Minimize · × (one button size for all header buttons). Minimized panels are kept in the `mins` setting (part of the Start view). The Keyframes panel has a time scroll bar at its bottom (drag to move the window, click to jump; always shown, full width on All).
- Minimized panels show a data "skin" behind their title bar (make_lab_view.py: skinData / skinDraw), on the shared time axis edge to edge; each has a style button (labs line/mountain; Signatera mountain / stems / circles…; Procedures one row / lanes / activity; MRI lesions linear/log, dose stacked, perfusion highest lesion, swelling lines, scan dates 3T tall, slice viewer filmstrip from local/imaging/thumbs). Hover shows what a mark is. Top bar: Maximize all / Minimize all / × All; drag a panel's title bar to reorder; one bad panel can't stop the others (error message instead).
- Panel settings rows move up into the title row when they fit (liftTools); tables under charts fold with ▾ Table; From / To have − / + and fine knob dragging.
- Story page ("Tell your story", `story_view.html` + `story.py`, at `/story`, this Mac and the home network/VPN only): Erica looks at a photo and talks; each answer is saved as WAV in `local/story/sessions/<id>/takes/`, turned into text on this Mac by `local/story/Story Transcribe.app` (built by `story/build_transcribe.sh`; rebuilding it makes macOS ask for Speech Recognition permission again), and Claude asks one spoken follow-up (chat server `POST /api/interview`, voice by `say`). The records viewer is embedded under the photo (an iframe of /labs.html driven with its own setWin/onlyLab; topic buttons Photos, Procedures, Brain MRI, Labs, Signatera, Pathology). Claude's reply is JSON {say, show?, photos?, next?}: show puts records on screen, photos jumps to her photos from an event she names; "Or start by telling a story" begins with no photo (Erica leads). A Ready check (button on the start screen; GET /story/api/health for the home Mac: drive, photos, speech to text tried on a spoken sample, Claude's voice, chat server, certificate; plus this computer's mic, speakers, connection, a practice run through POST /story/api/practice, and a filming-day list) should be all ✓ before Erica starts. "📚 Your stories" (start screen) shows progress by chapter (click a photo to tell or edit it), drafts waiting for review, saved stories and all sessions; the story editor changes title, caption, who sees it, fixes words in her answers (recordings unchanged), adds links (labs.html#date=YYYY-MM-DD opens the charts there) and more photos, or takes a story off the gallery (kept in local/story/check/deleted-stories.jsonl). Each session has a storyteller ("Who's telling?" on the start screen: Erica first, then Nina, Dan, Kyle, and anyone added; names and how they know Erica in local/story/tellers.json); Claude speaks to that person about their own part, and stories record their teller. Captions are reviewed at the end and saved to `local/photos/stories/<photo>.json`. Settings: `local/story/settings.json` (voice, claudeSeesPhoto, model, maxQuestions). The microphone needs https: run the viewer with `--https-port 8767` (certificate: `python3 serve_viewer.py --make-cert`, in `local/tls/`).
- Shared edits live in `local/med_edits.json` (backups in `local/edits_history/`). Don't delete or overwrite it without asking: it holds the user's moments and medication changes.

## Knowledge Base
- Shared Knowledge Base: `/Volumes/ssd70/Cancer/KnowleageBase/` (spelled that way on disk). Before work involving established tools, setups, integrations or previously solved problems, read its `README.md` index first and open only the documents it points to (the knowledge-base skill).
- Update it only when the user asks ("update the knowledge base", "save what we learned").
