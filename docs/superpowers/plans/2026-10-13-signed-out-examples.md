# Signed-out live examples — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-out visitor on each of the six list pages sees a slim sign-in band and then the
real page, filled with the Ashen Vale example, which they can filter, search and open; signed-out
Home links into those examples.

**Architecture:** The example campaign stays one static, typed fixture
(`shared/example-campaign/`). Each feature owns its example in an `example/` folder, which renders
the feature's *real* directory inside a provider that serves the fixture as that domain's context
(writes resolve and do nothing) and inside a navigation that goes nowhere. The directories learn
nothing about examples: they gain a general `canEdit` switch (hides the controls that write) and an
`initialExpandedId`. `GatedContent` draws the band instead of the large panel whenever a page passes
an example.

**Tech Stack:** React 18 + TypeScript, Tailwind + theme classes, Jest + RTL, Playwright e2e.

**Spec:** `docs/design/design_handoff_signed_out_examples/README.md`,
`docs/design/design_handoff_signed_out_notes/README.md` (4a only), plus the decisions below, which
override the handoffs where they differ.

## Decisions made with the maintainer (2026-10-13) — these win over the handoffs

- Six list pages get the band: NPCs, Locations, Quests, Rumours, Chapters, Notes. Every other gated
  route keeps the large panel.
- The example is the real page, interactive, writes nothing.
- **No button is ever faded.** Navigation controls (More info, Open location, Open quest, chapter
  rows, people/quest links in open rows) look exactly live and do nothing.
- Write controls are **left out** on the five directories: Add, Select, batch bars, Delete, the
  rumour composer, the List/Shelf toggle, New Chapter. On Notes (4a) Archive, Delete, Add and Scan
  note are **shown**, unfaded, and do nothing.
- NPC, quest and rumour rows open and close on click; each list starts with one row open (NPCs:
  Vesk Harrow; Quests: Recover the drowned ledger; Rumours: one confirmed rumour).
- An open rumour shows its content as plain text: no editing form anywhere in an example.
- Ladders and objective tick-boxes inside an open row look live; pressing them changes nothing.
- "New here? See what the site does" moves to a muted line under the example.
- Home's chapter rows link to `/story/chapters` (no example reader exists).
- Notes: 4a only — already scanned, nothing reacts, no OpenAI call ever.
- Mockups show intent, not a 1:1 spec. Where the real directory behaves differently from a mockup
  (e.g. Locations flattens only on search, not on pills), the real directory wins.

## Global Constraints

- User-facing copy is British English ("rumour", "traveller"); keys, paths and stored values keep
  their spelling (`/rumors`, `sourceType: "traveler"`).
- Never hardcode colours; theme classes/tokens only.
- No author anywhere in example data: every record built from the fixture has
  `createdBy: ""` and `createdByUsername: ""`, and "Recorded by" is not rendered for it.
- Every example id starts `example-`.
- Cross-feature imports go through public barrels; inside a domain, import siblings directly.
- Example components load lazily (members never download them).
- Double quotes in new files; JSDoc on new components/functions.
- Gates per PR: `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run check:bundle`,
  `npm run lint`, `npm run lint:tests`; touched `e2e/` → `npm --prefix e2e run typecheck` and
  `npm --prefix firebase run test:e2e`; then the dev server (port 3000) in Chrome.
- Every PR targets `main`; PR 2+ open as drafts ("draft until #N merges"). Never base a PR on
  another PR's branch.
- The maintainer's uncommitted TODO.md/CLAUDE.md/todo.txt/`.claude/commands/todo.md` work rides
  along in the working tree: never stage those files.

## Review Focus

1. **A write slipping through.** Pressing a ladder, objective tick-box or Add in an example must
   not reach Firestore or OpenAI. Pinned by provider tests asserting every write stub resolves
   without calling any service, and a Notes test asserting `extractWithOpenAI` is never called.
2. **The example leaking to members.** A signed-in member's empty list must still show its own
   empty state, never the band or the example. Pinned by `GatedContent` tests and the existing e2e
   member journey.
3. **Highlight deep links** (`/npcs?highlight=example-npc-odile` from Home) must open and scroll
   to the example row, and a bogus highlight must not crash. Pinned in the Home PR's e2e journey.
4. **Filters that empty the list** show the filter empty state ("No NPCs match these filters"),
   never the "Muninn hasn't met anyone yet" campaign-empty state with its Add button. Pinned in
   each directory example test.
5. **Phone width (320px)**: band wraps, buttons stay ≥44px, no horizontal scroll. Checked in the
   browser per PR (iframe trick from CLAUDE.md).

---

## File map

| File | Responsibility |
|---|---|
| `src/shared/example-campaign/example-campaign.ts` | The fixture: one setting, typed, frozen |
| `src/shared/example-campaign/ExampleRegion.tsx` (new) | Chip + caption + `role="region"` wrapper |
| `src/shared/context/NavigationContext.tsx` | + `InertNavigation`: same context, navigation does nothing |
| `src/shared/components/gated/GatedSignInBand.tsx` (new) | The slim band |
| `src/shared/components/gated/GatedContent.tsx` | Band + example + footnote when an example is passed |
| `src/shared/components/gated/gated-page-copy.ts` | + `exampleLine` per page |
| `src/features/campaign-entities/example/example-records.ts` (new) | Fixture → full `NPC`/`Quest`/`Location`/`Rumor` records |
| `src/features/campaign-entities/example/ExampleCampaignProvider.tsx` (new) | Serves those records as the four contexts; writes do nothing |
| `src/features/campaign-entities/{npcs,locations,quests,rumors}/example/*Example.tsx` | Each page's example (moved from `components/`) |
| `src/features/campaign-entities/*/context/*Context.tsx` | + export a `*ContextValueProvider` (the raw `Context.Provider`) |
| `src/features/campaign-entities/*/components/*Directory.tsx` | + `canEdit`, `initialExpandedId` |
| `src/features/campaign-entities/rumors/components/RumorRowView.tsx` (new) | A rumour's open row as plain text |
| `src/features/storytelling/stories/components/ChapterBrowser.tsx` (new) | Search + All/Unread + list (+ optional toggle/selection), out of `ChaptersPage` |
| `src/features/storytelling/stories/example/ChapterExample.tsx` | Moved; renders `ChapterBrowser` |
| `src/features/collaboration/notes/example/NoteExample.tsx` (new) | 4a: real editor + links panel, from the fixture |
| `src/pages/home/signed-out-example.ts`, `SignedOutHome.tsx` | Home v2 |

---

## PR 1 — `feat/example-fixture`: the bigger fixture, its tests, Home's numbers derived

### Task 1.1: Fixture types and data

**Files:** Modify `src/shared/example-campaign/example-campaign.ts`;
Test `src/shared/example-campaign/__tests__/example-campaign.test.ts`

**Interfaces — Produces:**
```ts
export type ExampleNPC = Readonly<Pick<NPC, "id"|"name"|"title"|"status"|"relationship"|"occupation"|"race"|"description"> & {
  /** Where they were met; absent = "Location unknown". */ locationId?: string }>;
export interface ExampleObjective { readonly description: string; readonly completed: boolean }
export type ExampleQuest = Readonly<Pick<Quest, "id"|"title"|"status"|"description"> & {
  locationId: string; objectives: readonly ExampleObjective[]; relatedNPCIds: readonly string[] }>;
export type ExampleLocation = Readonly<Pick<Location, "id"|"name"|"type"|"status"|"parentId"|"description">>;
export type ExampleRumour = Readonly<Pick<Rumor, "id"|"title"|"status"|"sourceName"|"content"> & {
  sourceType: NonNullable<Rumor["sourceType"]>; convertedToQuestId?: string; relatedNPCIds?: readonly string[] }>;
export interface ExampleChapter { /* unchanged */ }
export interface ExampleNote {
  readonly id: string; readonly title: string; readonly paragraphs: readonly string[];
  /** Fixture ids of records the note names. */ readonly references: readonly string[];
  readonly detections: readonly { readonly id: string; readonly text: string;
    readonly type: "npc"|"location"|"quest"|"rumor"; readonly confidence: number }[];
}
export interface ExampleCampaign { npcs; quests; locations; rumours; chapters; note: ExampleNote }
```
`objectivesDone/objectivesTotal` are replaced by `objectives` (the directory counts them, as it
does for real quests). Data: `example-campaign.proposed.ts` (10 locations, 10 NPCs, 10 quests,
10 rumours, 14 chapters), with "Find Brother Aldous" `active`, plus: a one-line `description` for
every place and quest; objective text summing to the proposal's done/total; `relatedNPCIds` on the
quests whose title names a person; `content` (one or two sentences) for every rumour;
`convertedToQuestId` on the three converted rumours pointing at the quest each became; the notes
handoff's note (9 paragraphs, 9 references, 5 detections).

- [ ] **Step 1: Replace the tests' "2–3 rows" bound and add the consistency tests (failing).**
```ts
test("each list is long enough to show its page's furniture", () => {
  expect(EXAMPLE_CAMPAIGN.npcs).toHaveLength(10);
  expect(EXAMPLE_CAMPAIGN.locations).toHaveLength(10);
  expect(EXAMPLE_CAMPAIGN.quests).toHaveLength(10);
  expect(EXAMPLE_CAMPAIGN.rumours).toHaveLength(10);
  expect(EXAMPLE_CAMPAIGN.chapters).toHaveLength(14);
});
test("parents come before their children", () => {
  const seen = new Set<string>();
  EXAMPLE_CAMPAIGN.locations.forEach((place) => {
    if (place.parentId) expect(seen).toContain(place.parentId);
    seen.add(place.id);
  });
});
test("no quest is done while a person its title names is missing", () => {
  const missing = EXAMPLE_CAMPAIGN.npcs.filter((npc) => npc.status === "missing");
  EXAMPLE_CAMPAIGN.quests.filter((quest) => quest.status === "completed").forEach((quest) =>
    missing.forEach((npc) => expect(quest.title).not.toContain(npc.name)));
});
test("a quest's people and a rumour's quest are in the example", () => { /* ids resolve */ });
test("exactly one chapter is current", () => {
  expect(EXAMPLE_CAMPAIGN.chapters.filter((chapter) => chapter.isCurrent)).toHaveLength(1);
});
test("the note names only what the example holds, and finds only what it lacks", () => {
  const ids = new Set([...npcs, ...locations].map((row) => row.id));
  EXAMPLE_CAMPAIGN.note.references.forEach((id) => expect(ids).toContain(id));
  const names = new Set([...npcs.map((n) => n.name), ...locations.map((l) => l.name),
    ...quests.map((q) => q.title), ...rumours.map((r) => r.title)].map((s) => s.toLowerCase()));
  EXAMPLE_CAMPAIGN.note.detections.forEach((d) => expect(names).not.toContain(d.text.toLowerCase()));
});
```
Keep the frozen, no-author and id tests (extend them to `note`). NPC `locationId` check becomes
"when present". The "one setting" test also checks `relatedNPCIds` and `convertedToQuestId`.
- [ ] **Step 2:** `npx jest --testPathPattern=example-campaign` → FAIL.
- [ ] **Step 3:** Write the fixture.
- [ ] **Step 4:** Re-run → PASS. Fix the five `*Example.tsx` callers (`QuestExample` maps
  `objectives` to done/total) and their tests; `npx tsc --noEmit`.

### Task 1.2: Home's numbers derived from the fixture

**Files:** Modify `src/pages/home/signed-out-example.ts`; Test `src/pages/home/__tests__/signed-out-example.test.ts`

- [ ] **Step 1 (failing):**
```ts
it("counts what the example pages show", () => {
  const value = (label: string) => SIGNED_OUT_EXAMPLE.stats.find((s) => s.label === label)?.value;
  expect(value("Chapters")).toBe(EXAMPLE_CAMPAIGN.chapters.length);
  expect(value("NPCs")).toBe(EXAMPLE_CAMPAIGN.npcs.length);
  expect(value("Locations")).toBe(EXAMPLE_CAMPAIGN.locations.length);
  expect(value("Open quests")).toBe(EXAMPLE_CAMPAIGN.quests.filter((q) => q.status === "active").length);
});
```
- [ ] **Step 2:** derive `stats` from the fixture; subtitle `"Started October 2024 · 14 sessions"`
  with 14 = `chapters.length`. PASS.
- [ ] **Step 3:** Commit both handoff folders + this plan + Tasks 1.1–1.2; gates; push; PR.

---

## PR 2 — `feat/example-band`: the band, the region, the footnote

### Task 2.1: `GatedSignInBand` and `exampleLine`

**Files:** Create `src/shared/components/gated/GatedSignInBand.tsx`; Modify `gated-page-copy.ts`
(+ `exampleLine?: string` on `GatedPageCopy`, set for story/quests/npcs/locations/rumors/notes);
Tests `__tests__/GatedSignInBand.test.tsx`, `gated-page-copy.test.ts`.

Props: `{ heading: string; line: string; signInHref: string; joinHref: string }`. Markup: band
surface classes (`surface-band` token class — check `components.css` for the existing band class
before adding one; add a token-backed class if none), `Lock` 18px, heading as `h2`
(Typography h3 size), line, `Sign in` (`buttonClasses primary`) and `I have an invite link`
(`outline`) as `<Link>`s, `flex flex-wrap gap-5 items-center`.

- [ ] Test: renders the heading as a heading, the line, both links with their hrefs. FAIL → build → PASS.
- [ ] Copy test: every page with an example has an `exampleLine`; British spelling (no "rumor").

### Task 2.2: `ExampleRegion`

**Files:** Create `src/shared/example-campaign/ExampleRegion.tsx`; Test alongside.

Props `{ caption: string; children }`. Renders `<section role="region" aria-label="Example campaign">`,
the chip ("Example", existing chip classes) + muted caption (`text-sm typography-muted`) in a
`flex items-baseline gap-3`, then children with `space-y-6`, chip row pulled `-mb-2` toward the
content. No `aria-hidden`.

- [ ] Test: region found by role+name; caption shown. FAIL → build → PASS.

### Task 2.3: `GatedContent` draws the band with an example

**Files:** Modify `GatedContent.tsx`; Test `GatedContent.test.tsx`.

When `gate.state === "signed-out"` **and** `signedOutExample` is given: render `GatedSignInBand`
(heading `gate.heading`, line `gate.copy.exampleLine ?? gate.copy.blurb`), then the example inside
`<React.Suspense fallback={null}>`, then the footnote line
(`GATED_FOOTNOTE` + `<Link to="/">See what the site does</Link>`, `body-sm`, muted). Without an
example, the large panel as today. `space-y-6` between them.

- [ ] Tests: signed-out + example → band heading, no "Private campaign" eyebrow, example, footnote;
  signed-out without example → the panel; signed-in states → never the example. FAIL → build → PASS.
- [ ] Existing five `*Example` components switch from `RosterExample` to `ExampleRegion`
  (still inert rows for now) with their captions; NotesPage gets nothing yet.
- [ ] e2e `example-rows.spec.ts`: region by role `region` name "Example campaign"; band heading;
  footnote link. Gates; push; draft PR.

---

## PR 3 — `feat/example-directories`: provider, `canEdit`, NPCs and Locations live

### Task 3.1: `InertNavigation`

**Files:** Modify `src/shared/context/NavigationContext.tsx`; Test `__tests__/NavigationContext.test.tsx` (or the existing one).

```tsx
/** The surrounding navigation, except that going anywhere does nothing. */
export const InertNavigation: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const outer = useNavigation();
  const value = useMemo(() => ({ ...outer, navigateToPage: () => {}, goBack: () => {} }), [outer]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
};
```
- [ ] Test: a child calling `navigateToPage("/x")` leaves the router location unchanged;
  `getCurrentQueryParams` still reads the URL. FAIL → build → PASS.

### Task 3.2: Example records + `ExampleCampaignProvider`

**Files:** Create `src/features/campaign-entities/example/example-records.ts`,
`ExampleCampaignProvider.tsx`, tests; Modify the four `*Context.tsx` to export
`export const NPCContextValueProvider = NPCContext.Provider;` (same for Location/Quest/Rumor).

```ts
export const EXAMPLE_RECORDS: { npcs: NPC[]; locations: Location[]; quests: Quest[]; rumors: Rumor[] };
```
Built once from `EXAMPLE_CAMPAIGN`: `createdBy: ""`, `createdByUsername: ""`, empty arrays for
required lists, `connectedNPCs` on each place from the NPCs whose `locationId` names it,
objectives with ids `${quest.id}-objective-${n}`, rumour `relatedNPCs` from `relatedNPCIds`,
`relatedLocations: []`, `notes: []`.

`ExampleCampaignProvider` supplies all four contexts: lists from `EXAMPLE_RECORDS`,
`isLoading: false`, `error/loadError: null`, `hasRequiredContext: true`, `getXById` from the lists,
and **every write a function that resolves and changes nothing** (`async () => undefined`; creates
resolve `""`). Wrapped in `InertNavigation`.

- [ ] Tests: records carry no author (walk keys like the Home test); every place an NPC names lists
  them in `connectedNPCs`; under the provider `useNPCs().npcs` has 10 rows and calling every
  function on each context value resolves without touching `firebase` (mock `core/services/firebase`
  and assert no calls). FAIL → build → PASS.

### Task 3.3: `canEdit` and `initialExpandedId` on NPCDirectory and LocationDirectory

**Files:** Modify both directories; tests in their `__tests__`.

`canEdit?: boolean` (default `true`). False hides: the Select button, batch actions, row checkboxes,
NPC Delete, the campaign-empty Add action (shows the empty state without its button). Navigation
stays (it is what `InertNavigation` neutralises). `RecordedBy` renders nothing when the record has
no `createdBy`. `initialExpandedId?: string` seeds `expandedNpcId`.

- [ ] Tests (each FAIL first): `canEdit={false}` → no "Select NPCs", no "Delete" in an open row,
  "More info" present; `initialExpandedId` → that row's `aria-expanded="true"`; a record without
  `createdBy` → no "Recorded by". Same for Locations ("Select Locations").

### Task 3.4: `NPCExample`, `LocationExample` live

**Files:** Move to `npcs/example/NPCExample.tsx`, `locations/example/LocationExample.tsx`;
`npcs/example/index.ts` exports `LazyNPCExample = React.lazy(() => import("./NPCExample"))`; barrel
exports `NPCExample` as the lazy one (same name, so pages don't change).

```tsx
const NPCExample: React.FC = () => (
  <ExampleRegion caption="The Ashen Vale · try the filters">
    <ExampleCampaignProvider>
      <NPCDirectory npcs={EXAMPLE_RECORDS.npcs} canEdit={false} initialExpandedId="example-npc-vesk" />
    </ExampleCampaignProvider>
  </ExampleRegion>
);
```
- [ ] Tests: status bar "10 met so far"; typing "Vesk" filters; "Hostile" pill filters; a search
  matching nothing → "No NPCs match these filters" and no "Add"; Vesk open; More info click leaves
  location unchanged. Same shape for Locations ("charted so far", "Dungeons" pill → The Drowned
  Archive with its ancestors open).
- [ ] e2e: `/npcs` signed-out — filter by pill, open Odile, More info stays on `/npcs`; `/locations`
  — search flattens. Remove `inert` usages these two replace. Gates; browser check; push; draft PR.

---

## PR 4 — `feat/example-quests-rumours`

### Task 4.1: QuestDirectory `canEdit` / `initialExpandedId`
Hides Select, batch, campaign-empty Add. Tests as 3.3.

### Task 4.2: `RumorRowView` and RumorDirectory `canEdit` / `initialExpandedId`

**Files:** Create `rumors/components/RumorRowView.tsx`; Modify `RumorDirectory.tsx`.

`RumorRowView` props `{ rumor: Rumor; npcName: (id) => string | null; onOpenQuest: (id) => void }`:
`RosterField`s for "What was said" (content), "Source" (type word + name), "People" (names), and,
when `convertedToQuestId`, an outline "Open quest" button. No inputs, no Save, no ladder.
`canEdit={false}` hides Select, batch, composer, and renders `RumorRowView` instead of
`RumorRowEditor`.

- [ ] Tests: `canEdit={false}` → no textbox in an open row, no "Save", no composer; content shown.

### Task 4.3: `QuestExample`, `RumorExample` live
Move to `example/` folders, lazy as in 3.4. Quests open "Recover the drowned ledger"; Rumours open
`example-rumour-ferry`.
- [ ] Tests: "sworn so far", Completed/Failed folded; "rumours gathered", False folded; pill
  filters; open rumour shows content and no form. e2e journeys for both. Gates; push; draft PR.

---

## PR 5 — `feat/example-chapters`

### Task 5.1: `ChapterBrowser` out of `ChaptersPage`

**Files:** Create `stories/components/ChapterBrowser.tsx`; Modify `ChaptersPage.tsx`; tests.

Props: `{ items: ChapterWithProgress[]; filterMode; onFilterModeChange; viewMode?; onViewModeChange?;
selection?; onChapterSelect; onEditChapter?; isAdmin? }` — search state inside; the toggle renders
only when `onViewModeChange` is given, the Select button only when `selection` is given. The page
keeps persistence and the batch bar. Existing `ChaptersPage` tests must stay green unchanged.

### Task 5.2: `ChapterExample` on `ChapterBrowser`
Items from the fixture (as `ChapterWithProgress`), local `filterMode`, `onChapterSelect` no-op,
caption "The Ashen Vale · fourteen sessions in". Remove `ChapterRowView`'s `inert` and
`RosterExample`/`RosterRow.inert` once nothing uses them.
- [ ] Tests: "All 14" / "Unread 1"; run 1–10 folded with Show; search filters. e2e. Gates; push; draft PR.

---

## PR 6 — `feat/example-notes` (4a)

**Files:** Create `collaboration/notes/example/NoteExample.tsx`, lazy export; Modify `NotesPage.tsx`
(`signedOutExample`), and whatever seam the editor and the links panel need to read a given note
and its references instead of the notes context (read `NoteEditor`, `CampaignLinksPanel`,
`useNoteReferences` first; prefer a static `NoteContext` value + references prop over branches).

Layout: grid `minmax(0,1fr) 300px`, gap 20px. Editor read-only with the fixture note
(`paragraphs.join("\n\n")`), Archive/Delete shown unfaded doing nothing, footer
"Example note · read-only". Panel: already scanned, 9 in-campaign references (rows look live, go
nowhere), 5 detections with Add (does nothing), Scan note (does nothing). No usage card. Band line
(4a): the notes `exampleLine` is the existing blurb. Caption "One player's note from the Ashen Vale".

- [ ] Tests: no call to the extractor/OpenAI service on render or on pressing Scan note / Add
  (mock and assert zero calls); 9 + 5 listed; no textbox editable. e2e. Gates; push; draft PR.

---

## PR 7 — `feat/home-v2`

**Files:** `signed-out-example.ts` (+ `ref` on `ExampleUpdate`, `href` per stat), `SignedOutHome.tsx`, tests.

Stats as links (`/story/chapters`, `/npcs`, `/locations`, `/quests`), `→` in accent, gap colour
`card-border`. Update rows: date `12 Mar` (`toLocaleDateString("en-GB", { day: "numeric", month: "short" })`),
mark (chapter number on sunken square / `EntitySigil`), name + detail line, status word in its tone;
links: chapter → `/story/chapters`, quest → `/quests?highlight=<id>`, NPC → `/npcs?highlight=<id>`.
Footer "10 rumours gathered, 2 of them false" + "Open the example →" `/rumors`. Caption "Click
around, nothing is saved"; drop `aria-hidden`. Invite-only line with `Lock`. Product lines as rows
with links ("See the story →", "See the rumours →", "Members only").
- [ ] Tests: derived footer; every link's href; no author. e2e: Home → NPC row → `/npcs` with that
  row open and highlighted. Delete this plan file in this PR. Gates; push; draft PR.
