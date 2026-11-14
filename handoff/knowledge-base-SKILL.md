---
name: knowledge-base
description: Consult and maintain the shared cross-project Knowledge Base. Use before work involving established tools, setups or previously solved problems, and when asked to update the knowledge base or save what we learned.
---

# Knowledge Base

Keeps reusable knowledge (workflows, setups, troubleshooting, best practices, lessons learned) in one place so the same problem isn't solved twice. This skill holds only the procedure; the knowledge itself lives in the Knowledge Base folder.

## Location

- **Root:** `/Volumes/ssd70/Cancer/KnowleageBase/`. The folder name is spelled exactly like this on disk.
- **Index:** `README.md` in that folder. It is authoritative: every document is listed there with a relative link and one line on when to use it. Its "Conventions" section defines evidence labels and formats; follow it.

How to reach it:
- **Claude Code or any shell on the Mac:** read and write the files directly.
- **A Claude chat linked to the Mac:** use the device tools. If the folder isn't connected yet, request `/Volumes/ssd70/Cancer/KnowleageBase` with `device_request_folder_access`. Read with `device_bash` when present; otherwise stage the needed files with `device_stage_files` and Read them. Write back with `device_commit_files`, passing the staged `mtimeMs` as `expectedMtimeMs` so a newer edit isn't overwritten.
- **Drive not mounted, or no access from this environment:** say so in one line. Never create a substitute Knowledge Base somewhere else. Continue without it and state material assumptions.

If the Knowledge Base moves, update this section only.

## Workflow 1: Consult before work

Use when a task involves established tools, setups, integrations, standards, or a problem that may have been solved before. Skip it for trivial or unrelated requests.

1. Read `README.md` only.
2. From the Index, pick the entries that match the task and open only those documents. Never scan the folder recursively or load every file.
3. Follow the documented approach unless the user's current instructions or newer authoritative evidence supersede it. When deviating, say why.
4. Check each document's `Last verified` date and evidence labels. Re-verify consequential or changeable details (versions, URLs, settings, API behavior, prices) before relying on them. Historical documentation does not prove something still works.
5. If nothing relevant exists, proceed with reasonable judgment and state material assumptions. Optionally note the gap as a candidate lesson for later.

Mention in one line which Knowledge Base documents were used. Don't paste their contents back to the user.

## Workflow 2: Save what we learned

Triggers: "update the knowledge base", "save what we learned", "run knowledge distillation". At project milestones, do this only if the user's standing instructions authorize it.

1. **Gather evidence** from the current work: commands actually run and their output, errors and the fixes that worked, what was confirmed in the real workflow. Don't reconstruct what "should" have happened.
2. **Select reusable lessons:** a successful setup or integration; a repeatable workflow; a failure with its cause and verified fix; constraints and pitfalls; better commands, validation steps or examples. Leave out project status, one-off details and temporary notes. Those stay in the project.
3. **Find each lesson's home.** Read the README index, open the candidate canonical document(s), and compare:
   - Already covered and still correct: no change, or refresh `Last verified`.
   - Covered but incomplete or wrong: edit the canonical document in place.
   - Fits an existing document's scope: add a section there.
   - No suitable home: create one new document. Create a folder only when several related documents need one.
   - Duplicates or conflicting guidance found: add a `> ⚠️ Consolidation note:` explaining it. Never delete documents unless the user asks.
4. **Write** to the documentation standards below.
5. **Update `README.md`:** an index entry for any new document (relative link + when to use it), and one dated line under "Recent changes" summarizing what changed.
6. **Check before finishing:** every relative link in the README and touched documents resolves; no passwords, API keys, tokens or unnecessary private information; unrelated user-authored content is unchanged.
7. **Report** the files created or changed, the lesson behind each change, and anything still unverified. Never claim a write that didn't happen; if a write failed, say so.

## Documentation standards

- Concise, practical Markdown. Use the sections that fit the topic, typically: Purpose and when to use it · Setup and prerequisites · Workflow · Best practices and pitfalls · Troubleshooting · Verified examples · Related documentation.
- Include commands and verification steps only when supported by evidence.
- Label evidence with the README's labels:
  - **Observed:** seen happen during the work.
  - **Checked:** established by an automated check (test, script, linter).
  - **Verified in use:** confirmed working in the real workflow.
  - **Untested / Proposed:** not yet tried. Always label these.
- Time-sensitive documents carry `Last verified: YYYY-MM-DD (context)`.
- Never invent outcomes, commands, references or lessons.
- Never store passwords, API keys, tokens, or private details that aren't needed. Use placeholders such as `<CLIENT_ID>`.
- Preserve unrelated user-authored content. Keep the index and relative links current.

## New topic template

```markdown
# <Topic title>

Last verified: YYYY-MM-DD (<context>)

## Purpose
<What this covers and when to use it.>

## Setup and prerequisites

## Workflow
1. <Step> (**Verified in use**)

## Pitfalls

## Troubleshooting
- **Symptom:** … **Cause:** … **Fix:** … (**Observed**)

## Related
- [Other topic](relative/path.md)
```
