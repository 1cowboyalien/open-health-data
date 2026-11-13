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

## Knowledge Base
- Shared Knowledge Base: `/Volumes/ssd70/Cancer/KnowleageBase/` (spelled that way on disk). Before work involving established tools, setups, integrations or previously solved problems, read its `README.md` index first and open only the documents it points to (the knowledge-base skill).
- Update it only when the user asks ("update the knowledge base", "save what we learned").
