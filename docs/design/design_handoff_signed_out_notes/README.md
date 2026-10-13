# Handoff: Signed-out Notes example (addendum)

Builds on the earlier `design_handoff_signed_out_examples` bundle. That bundle covers the band, the fixture and the tokens; this one covers **Notes** only.

## Overview
Today, `/notes` shows only the gated panel to a signed-out visitor. Extraction is the product's most persuasive feature (`gated-page-copy.ts` says so), and a stranger has no way to see it. The chosen direction is **4b**:
- The sign-in band, as on the other list pages.
- An **example note opened in `NoteEditor`** (read-only), with **`CampaignLinksPanel`** beside it.
- **Scan note** replays a canned scan, with **no network call**.
- After the scan, the names found are marked in the note text, and hovering a panel entry highlights its mention.
- **Add** explains what it would create and asks the visitor to sign in.

## About the Design Files
These are HTML design references, not production code. Recreate them with `NoteEditor` and `CampaignLinksPanel` (`src/features/collaboration/notes/components/`), `EntitySigil`, `Button` and `Typography`. All values map to tokens listed in the first bundle's README.

Open `Signed-out Notes.dc.html` with `support.js` beside it. **4a** is the faithful read-only version, already scanned. **4b** is the live demo.

## Fidelity
High fidelity, dark theme. **Chosen: 4a** (faithful, read-only, already scanned). 4b is kept as an optional extra.

## Layout (both)
- Page header: "Notes" / "Your private notes. Only you can read them." (existing).
- The band uses the shared spec. Heading "Sign in to read your notes". Line (4b): "Below is an example note, so press Scan note and see what Muninn picks out. Your own notes are only ever yours."
- Chip "EXAMPLE" plus the muted caption "One player's note from the Ashen Vale · try Scan note".
- Grid `minmax(0,1fr) 300px`, gap 20px, top-aligned. This mirrors `NotePage`.
- Editor (`note-editor card rounded-xl`):
  - Toolbar: 13px, "All notes" and Archive/Delete, with Archive/Delete at opacity .5 (`readOnly`).
  - Title: 30px Zilla 500.
  - "Note content" label, and a body at 17px/1.65.
  - Footer: `bg-secondary`, 13px, "Example note · nothing is saved" on the left and "{n} words" on the right. The Ctrl+S hint is dropped.
- Panel (`campaign-links card rounded-xl p-4`): the existing markup unchanged, except for the points below.

## Example-mode changes to CampaignLinksPanel
1. **No OpenAI.** In example mode, `handleExtract` must not call `extractWithOpenAI`, save, or `updateNote`. It sets "scanning", waits about 1.4s, then shows the canned `references` and `detections` from the fixture. The button label is "Scanning…" while waiting; the real component uses `Loader2`, which is fine to keep.
2. **Disclosure line** becomes: "In this example the scan is a replay. Nothing leaves your browser. In your campaign, the note's text goes to OpenAI. How this works".
3. **Initial state:** "Not scanned yet." (the existing `looksUnscanned` copy).
4. **Reference rows** are not links in example mode (`navigateToEntity` disabled). On hover they get `dropdown-item`'s hover background and highlight their mention in the note.
5. **Add** never calls `convertEntity`. Pressing it reveals one 12px line inside the detection card, followed by a **Sign in** link (accent 600):
   - NPC: "Adding makes {name} an NPC in your campaign, linked back to this note."
   - Location: "Adding makes the hut a Location. You can nest it inside Saltmarsh Fen."
   - Rumour: "Adding records it as an unconfirmed Rumour, sourced from this note."
   - Quest: "Adding opens it as an active Quest for the whole party."
6. **Leave out the Smart detection usage card.** A stranger has no allowance.

## New: mention marks in the note body (4b only)
After the scan, the example note body renders as text with marks instead of a textarea. Members' notes are unchanged.
- In-campaign mention: 1px underline, `--action-outline-border` (#8C857D), offset 4px.
- Detected mention: background `accent.wash`-like rgba(214,146,83,.12), radius 3px.
- Hovered (from the panel): background rgba(214,146,83,.28), plus a 2px ring of the same colour. Transition background 300ms, ring 150ms.
- Hovering a detection card gives it an inset 1px accent ring.

Whether members get marks too is a separate decision. It would need character offsets back from extraction, which `ExtractedEntity` doesn't carry today.

## Example data (add to `example-campaign.ts` as `note`)
No author, and no relation to any real note. Title: "Session 13 — Into the Fen". Body (paragraphs; `[[key|text]]` marks a mention):

1. Left [[cin|Cinderford]] at first light. [[odile|Odile]] wouldn't take us past the ford, so we walked the last stretch through [[fen|Saltmarsh Fen]].
2. [[wren|Sister Wren]]'s map is wrong about the causeway. Lost half a day. Found a [[hut|hut on stilts]]. The man there calls himself [[gully|Gully Thrane]], eel-catcher, and says he knew [[pell|Old Pell]].
3. Cold, wet, and everyone in a bad mood. Lunch was the last of the bread from [[cin|Cinderford]], and it had gone soft in the pack.
4. Gully says [[arc|the Drowned Archive]] [[post|only opens when the water is below the third post]]. Today it was at the fifth.
5. Spent the afternoon drying out by his stove. He cooked eels. Nobody asked what kind.
6. [[ash|Ash-Tongue]] was waiting at the hut. Of course he was. Sold us a name for ten silver: [[reedy|Mother Reedy]]. No idea who that is yet.
7. Walked back the long way so we wouldn't pass the ford after dark. [[odile|Odile]] was right about that much.
8. [[boat|Come back with rope and a proper boat]], not one of [[vesk|Vesk]]'s. Someone should ask [[hale|Corvin Hale]] about the reward again.
9. Long day. Everyone was too tired to argue about who keeps the map.

Paragraphs 3, 5, 7 and 9 are filler on purpose. They mention only names already in the campaign, plus no new people, places, tasks or claims, so the scan results stay at 9 + 5.

**In your campaign (9)**, all ids from the fixture: Odile Marrow, Sister Wren, Old Pell, Ash-Tongue, Vesk Harrow and Corvin Hale (NPC); Cinderford, Saltmarsh Fen and The Drowned Archive (Location).

**Detected, not in your campaign (5)**, one of each type:

| Key | Text | Type | Confidence |
|---|---|---|---|
| gully | Gully Thrane | NPC | 97% |
| reedy | Mother Reedy | NPC | 88% |
| hut | Eel-catcher's hut | Location | 81% |
| post | The Archive opens below the third post | Rumour | 90% |
| boat | Return to the Archive with a boat | Quest | 76% |

Add a fixture test: every reference id exists in the fixture, and no detected name matches an existing name. The real panel filters such names out, so a match would make the demo lie.

## Files
- `Signed-out Notes.dc.html`: 4a and 4b.
- `support.js`: mockup runtime only.

Source read: `CampaignLinksPanel.tsx`, `NoteEditor.tsx`, `gated-page-copy.ts`, plus your screenshots, which were used for layout only. None of their text or entities is used.
