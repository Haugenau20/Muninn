---
description: File a backlog item into TODO.md after verifying it against the tree, or drain the whole todo.txt inbox
argument-hint: "[raw idea — or leave empty to drain todo.txt]"
---

# /todo — file a backlog item, investigated

Turn a raw one-line idea into a `TODO.md` entry that someone can pick up months
later without re-deriving anything.

**Input:** `$ARGUMENTS` if non-empty — that is the single raw item to file.
Otherwise **drain the inbox**: process every item currently in `todo.txt`.

The two modes are the same pipeline. Only the source of the raw text differs.

---

## The one rule

**An entry records a measurement, not a claim.** The raw text is a starting
hypothesis. Your job is to go and look.

This file exists because the project has been burned twice by the opposite:
seven drift-log findings described as open were already fixed, and a hand-prune
of `todo.txt` on 2026-09-16 deleted six items on memory alone. Never write
`file:line` you have not opened. Never mark something fixed you have not seen
fixed. If you cannot verify it cheaply, say so in the entry — an honest
`unverified` beats an invented investigation.

---

## Pipeline

Run these in order, per item. With more than three items, keep a todo list so
nothing is silently skipped.

### 1. Classify

Pick one category. It decides the section the entry lands in.

| Category | Section | Means |
|---|---|---|
| `bug` | Bugs | Something is broken or wrong in the tree right now |
| `security` | Security | Access, keys, permissions, abuse |
| `reliability` | Reliability | Data loss, correctness, limits the data will reach as it grows |
| `performance` | Performance and cost | Speed, cost, storage, bundle size |
| `ops` | Operations | Deploys, domains, infrastructure, tooling, docs |
| `ux` | User experience | Friction, polish and copy in what already exists |
| `feature` | Features | A new capability |
| `question` | Questions | An open question that blocks work until the maintainer answers it |

Then pick its **horizon**, which decides the overview table it is listed in
(the definitions are at the top of `TODO.md`): *earlier rather than later*,
*backlog*, *ideas and parked*, or *waiting on the maintainer*. A new feature
idea nobody has asked to build goes to *ideas and parked*; anything blocked on
the maintainer, or a `question`, goes to *waiting on the maintainer*.

### 2. Verify against the tree

Find the code the item is about. Confirm the claim still holds.

- Search for the feature, component or symbol named in the raw text.
- **Open the files.** Do not conclude from a grep hit — and never from a
  column-anchored `grep "^export"`, which this codebase's indentation makes
  lie (see `CLAUDE.md`).
- Capture concrete `path:line` for where the work would start.
- Note the one thing that makes it non-trivial, if there is one. A blocker, a
  data-shape disagreement, a failure mode the happy path hides. If there is
  nothing, say so — "no catch found" is useful information.

Three outcomes:

- **Confirmed** → file it, `Status open`, `Verified <today>`.
- **Already fixed** → file it under `## Closed` with the evidence that closed
  it. Never drop it silently; the next person needs to know it was considered.
- **Too vague to verify** — a direction rather than a claim ("make it a real
  SPA") → file it `Status needs scoping`, and say plainly what question has to
  be answered before it can be sized. Do not invent an investigation to fill
  the template.

An item may also be **partly** verifiable: several sub-claims, some confirmed
and some not. File one entry, mark the status of each sub-claim separately, and
set the entry's status to the weakest of them.

### 3. Check for duplicates

Before writing, search these for the same subject:

- existing entries in `TODO.md`
- `docs/testing/bug-tracking/README.md` — the behavioural-test bug catalogue
- `CLAUDE.md`'s known-issues notes

A hit is not a reason to discard the item. Merge it: one entry, cross-referenced,
noting what the new report adds. Two entries for one problem is how a tracker
starts disagreeing with itself.

### 4. Size it

`S` a sitting · `M` a session or two · `L` needs its own plan first.
Size from what you found in step 2, not from the sentence.

### 5. Write the entry

Next free `T` number — read the file, take the highest, add one. **Numbers are
never reused**, matching the bug tracker's rule. Append to the section for its
category, newest last, and add its row to its horizon's table in the overview,
in priority order.

```markdown
### T014 — Quest objectives can't be ticked off from the quest list
**Category** bug · **Size** S · **Status** open · **Verified** 2026-09-16

One or two sentences: what is wrong or wanted, and why it matters. Written
for someone who has not read the raw note.

- **Where**: `path/to/QuestCard.tsx:88` renders objectives read-only; the
  mutation already exists as `useQuests().updateQuest`.
- **Touches**: the card, the quest context's update path, its test file.
- **Catch**: none found.
- **Source**: todo.txt, 2026-09-16
```

`Status` is one of: `open` · `needs scoping` · `needs investigation` ·
`blocked` · `in progress` · `done` · `dropped`.

Use `needs investigation` where the claim is checkable but checking it is a
task in itself — a cluster of sub-claims, or something that needs the app
running. It is different from `needs scoping`, which means nobody has decided
what the thing *is* yet.

Keep it to five to eight lines. An entry is a map to the work, not the work.

### 6. Drain mode only — clear the inbox line

Remove the item from `todo.txt` **only after** its entry is in `TODO.md`.
Leave the file with its header and nothing else when you are done.

### 7. Report, do not commit

Print a summary: what was filed under which ID, what turned out already fixed,
what merged into an existing entry, what you could not verify and why.

**Leave everything uncommitted.** The maintainer reviews before it lands, and
nothing here pushes to `main`.

---

## Red flags

| Thought | Reality |
|---|---|
| "The raw note says where it is, I'll cite that" | The note is the hypothesis. Open the file. |
| "grep found it, that's enough" | Read it. This tree indents exports; greps under-report. |
| "It's obviously already fixed" | Then show the code that fixed it, in the Closed entry. |
| "I'll sketch how to fix it while I'm here" | Out of scope. Verify and locate; approach comes at pickup time, against a current tree. |
| "This one's too vague, I'll skip it" | File it `needs scoping`. Skipping loses it. |
| "Close enough to an existing entry, I'll drop it" | Merge and cross-reference. Dropping loses what the new report added. |
