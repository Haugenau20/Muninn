# Example rows on empty pages (T150)

Agreed with the maintainer 2026-10-12. It reverses the gated-pages spec's §4, "No sample data
outside Home" (2026-09-03, in git at `ab298447~1`), for one state only: a signed-in member looking at
an empty campaign.

## What and why

A campaign with no NPCs (or quests, locations, rumours, chapters) shows one sentence and a button.
The member cannot see what the page will hold. Below that empty state, show a few **example rows**,
drawn with the real row components, inert, under an "Example" chip.

§4's three objections, and why they no longer hold here:

- *Invented authors undermine attribution.* The collapsed directory row and the chapter list row
  show no author. The fixtures' types have no author field, so one cannot be added by accident.
- *Fake rows invite clicks.* The rows are not buttons, take no focus and do not expand.
- *A fixture per entity type forever.* The rows render the same cell components the directories do,
  so a redesign of a real row reaches the example without anyone touching it. Only the data is
  separate, in one small file.

## Scope

- In: NPCs, quests, locations, rumours, chapters.
- Out: notes (the maintainer may take it up afterwards); the signed-out gated panel (keeps its one
  sentence and its link to Home); Home itself (its *Sunless Citadel* example is T123's question; a
  switch to this setting is a separate, stacked PR).

## Components

- **`RosterRow` `inert` prop.** The row line renders as a `div`, not the expand `<button>`; no
  chevron, no hover class, never expanded. `entityId` is still required (the sigil's hue).
- **Cell components**, extracted from each directory's inline cells, used by the directory and the
  example alike, taking narrow props rather than the entity:
  - `NPCRowCells` — name, title, status, relationship, occupation
  - `QuestRowCells` — title, location name, status, objectives done / total
  - `RumorRowCells` — name (and whether it is the untitled placeholder), source name, status,
    source type, converted to quest, unsaved badge
  - `LocationRowCells` — name, type, path, status, the "inside" line
  - Chapters: `ChapterRowView`'s display split from its handlers; an `inert` row draws no actions
    and has no click handler.
  Each directory's `ROW_GRID` moves beside its cells so the example lays out identically.
- **`RosterExample`** (`core/components/Roster.tsx`): the "Example" chip and a card holding the
  rows; the whole block `aria-hidden`, since the empty state's sentence already says what the page
  is for.
- **One setting, one file**: `shared/example-campaign/example-campaign.ts`, deep-frozen like
  `signed-out-example.ts`. Ids are `example-…`, which keep the sigils' hues stable and cannot meet a
  real document id. The setting is invented (no published adventure), and it is consistent across
  pages: a quest's place is one of the example locations, a rumour's source is one of the example
  NPCs.
- **Per-page example components** in each feature (`NPCExample`, …), each rendering
  `RosterExample` with its rows from the fixture. Chapters' is exported from the storytelling
  barrel for `ChaptersPage`.

## Behaviour

- Shown only in the branch that draws the empty state with the rune (`mark`): a campaign with none
  of these. Never while loading or after an error (the page gate handles both before the directory
  renders), never when a filter emptied the list, never signed out.
- Gone with the first real record; no dismissal, nothing stored.
- Below the empty-state card, so its action stays first. Rumours keep their composer above both.
  Chapters use list rows (an empty chronicle has no view toggle).
- Every member sees it, including those who cannot add records.
- Copy: the chip alone, "Example". Home dropped its explanatory caption for the same reason.
- 320 px: the rows narrow the way real rows do (below `md`, name and status).
- The comments that recorded §4 are rewritten: `SignedOutHome.tsx` ("the one page allowed an
  example") and `signed-out-example.ts` ("and nowhere else").

## Testing

- `RosterRow` with `inert`: no button, no expansion, no `aria-expanded`.
- Each directory (and `ChaptersPage`): an empty campaign shows the example rows; a list emptied by
  a filter does not; one real record does not.
- The fixture: frozen; no row carries an author-like key; every quest's place and rumour's source
  names an example location or NPC.
- The extraction is a refactor: the directories' existing suites must stay green untouched.
- Journey (`e2e/tests/example-rows.spec.ts`): the seeded campaign has no rumours. `/rumors` shows
  the example; recording a rumour removes it; deleting that rumour brings it back (so the journeys
  after it see the campaign as seeded).
- Control: with the example's branch condition inverted, the directory tests and the journey fail.
- Browser check on the dev server: an empty campaign's five pages, both themes, 320 px.
