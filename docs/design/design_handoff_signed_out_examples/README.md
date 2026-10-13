# Handoff: Signed-out example data (T150 follow-up)

## Overview
Signed-out visitors see a sign-in panel on each list page, with an inert "Example" list underneath (`GatedContent` → `signedOutExample`). Today that example has 2–3 rows and none of the directory's furniture: no status bar, no search, no filters, no groups. It looks thinner than the real product, and the worry is that it puts visitors off.

This handoff covers the chosen direction, the **live sample**:
- On signed-out list pages, the large `GatedPageState` panel becomes a slim **sign-in band** at the top.
- Below it, the **whole directory** renders from a richer example campaign (about 10 records per page): status bar, search, filters, groups, and folded history groups.
- The example is **interactive but writes nothing**. Filters, bands, search, folding and NPC row expand all work locally.
- The data stays **static in code** (see `DATA-DECISION.md`).

Pages covered: NPCs, Locations, Quests, Rumours, Chapters (Session Chronicles), and signed-out Home.

## About the Design Files
The files in this bundle are **design references made in HTML**. They show the intended look and behaviour; they are not production code. Recreate them in the Muninn codebase (React 18 + TS + Tailwind, theme tokens via `ThemeContext`) using its existing primitives: `Roster*` in `src/core/components/Roster.tsx`, the `*RowCells` components, `EntitySigil`, `Button`, `Typography`, `GatedContent`/`GatedPageState`. **Do not copy the inline styles.** Every value in the mockup comes from an existing token or class (listed below), so the real implementation should use the class and not the hex value.

Open `Signed-out Examples.dc.html` in a browser (keep `support.js` next to it). It's a pan/zoom canvas:
- **Turn 3 (top):** 3a Home today, 3b Home v2.
- **Turn 2:** 2a Quests, 2b Rumours, 2c Chapters.
- **Turn 1:** 1a/1e are today's pages for reference. 1b/1f are the full page under the panel, inert. 1c/1g are side by side. **1d/1h are the chosen live sample** for NPCs and Locations.

## Fidelity
**High fidelity**, dark theme (`colour-schema.json → resolved.dark`). Light theme follows automatically from the tokens; nothing in this design is specific to one theme.

## What to build

### 1. Signed-out sign-in band (replaces the big panel on list pages only)
Recommendation: a new `variant="signed-out-band"` on `GatedPageState`, or a small sibling `GatedSignInBand`. Copy still comes from `GATED_COPY` (heading) plus one new line.
- Container: `surface.band` (`--surface-band-bg` #14100B, border `--surface-band-border` #29241F), 1px border, `rounded-md` (6px), padding 16px 20px, flex row, gap 20px, wraps.
- Lucide `Lock`, 18px, `--surface-band-on-muted`.
- Text block (flex 1 1 360px):
  - Heading: Zilla Slab 600, 18px/1.3, `--surface-band-on`, using `GATED_COPY[page].heading`.
  - Line: Archivo 14px/20px, `--surface-band-on-muted`. Proposed copy: "Below is an example campaign, so try it. Your own {noun} are private to your group." For Chapters: "Below is an example campaign's chapter log. Your own story is private to your group."
- Actions: `buttonClasses({variant:'primary'})` **Sign in** → `signInPathFor(location)`; `buttonClasses({variant:'outline'})` **I have an invite link** → `/join`. Gap 12px.
- The "New here? See what the site does" footnote moves out of the band. Suggestion: keep it under the example or in the footer (open question; not shown in the mocks).
- Home and any non-list gated route keep the existing full panel.

### 2. Example caption
`RosterExample`'s chip stays ("EXAMPLE": 12px, 600, uppercase, `tracking-widest`, `chip` class, `px-2 py-1 rounded`). Beside it, at gap 12px, a muted caption (14px, `typography-muted`): "The Ashen Vale · try the filters". For Chapters: "The Ashen Vale · fourteen sessions in".

The chip and caption now sit above the **whole directory**, not just a row card. The space below the chip is the page's normal `space-y-6` rhythm, with the chip pulled 16px closer to the status bar.

### 3. The directory, fed by the example
The key change: the example renders the **real directory shell** (`RosterStatusBar`, `RosterFilterBar`, `RosterFilterPills`/`RosterFilterSelect`, `RosterGroup`, `RosterRow`) in a **local, read-only mode**. Two routes:
- **(Preferred)** Have each `*Directory` accept data as props (most already do: `NPCDirectory({ npcs })`), and add a `readOnly` / `example` flag. The flag hides batch selection, the composer, delete/edit and links to detail pages, and keeps search, filters, bands, folding and expand. Then `NPCExample` becomes `<NPCDirectory npcs={EXAMPLE_NPCS} example />`. This guarantees the example never drifts from the real page.
- (Alternative) Compose the `Roster*` primitives in each `*Example` with local state. Simpler, but it duplicates the filter logic.

What must be hidden or neutralised in example mode:
- "Select NPCs / Quests / Rumours / Chapters" buttons, batch bars, `RumorComposer`, the List/Shelf toggle, "New Chapter" / "Add …" buttons, Delete, and the "More info" navigation. More info can be shown as a dead or disabled button, or dropped; pick one.
- "Open location" on NPC group headings: show it, but make it non-navigating (or drop it).
- Hooks that write (`updateNPCRelationship`, etc.) must never be called. The stance ladder in an expanded example row is display-only.
- Nothing may show an author. The "Recorded by" field is **omitted** in example mode (it is not shown as "Unknown").
- `aria-hidden` on the example currently hides it from assistive technology, because it was inert. Once it's interactive, **remove `aria-hidden`** and give the region a label instead (`role="region" aria-label="Example campaign"`). The e2e test `example-rows.spec.ts` needs updating to match.

#### Per page (see the mockups for exact copy)
| Page | Status bar (`totalLabel`, band order) | Filters | Groups | Folded by default |
|---|---|---|---|---|
| NPCs (1d) | "met so far": alive, unknown, missing, deceased | search "Search name, title or description" + pills All/Friendly/Neutral/Hostile/Unknown | by location (+ muted "Location unknown") | none; one row (Vesk Harrow) starts expanded |
| Locations (1h) | "charted so far": explored, visited, known | search "Search locations..." + type pills All/Regions/Cities/Towns/Villages/Dungeons/Landmarks/Buildings/POIs | single "Locations" group, tree with 30px rails; flattens with "Type · in Parent" path while any filter is on | none |
| Quests (2a) | "sworn so far": completed, active, failed | search "Search quests..." + `RosterFilterSelect` "All Locations" | Active / Completed / Failed Quests | Completed, Failed (`HISTORY_GROUPS`) |
| Rumours (2b) | "rumours gathered": confirmed, unconfirmed, false | search "Search rumours..." + pills All/NPC/Tavern/Notice/Traveler/Other | Unconfirmed / Confirmed / False | False (`COLLAPSED_BY_DEFAULT`) |
| Chapters (2c) | (no bar) | input "Search chapter titles and summaries" + rounded-full "All 14" / "Unread 1" | `groupChaptersByTens`; `collapseReadRuns` folds 1–10 into "1–10 · Ten more read chapters" + Show | run 1–10 |

Row cells are the existing ones, unchanged: `NPCRowCells`, `LocationRowCells`, `QuestRowCells`, `RumorRowCells`, `ChapterRowView`.

NPC expanded row in example mode: two columns, 2fr / 1fr, gap 24px, padding 16px 20px 20px, top hairline `card-border`.
- Left: Description, then the Stance ladder (display-only, current value selected), then Notes ("No notes yet").
- Right: Race, then "More info" (outline, sm).
- Field labels: `RosterField` (11px, 600, uppercase, `tracking-wider`, muted).
- Expanded row background: `bg-secondary`.

Quest and Rumour rows don't expand in the mocks. Their expanded content wasn't designed here, so either reuse the directory's expanded view (read-only) or keep those rows inert.

### 4. Signed-out Home (3b)
File: `src/pages/home/SignedOutHome.tsx` and `signed-out-example.ts`. Layout unchanged: `max-w-7xl`, `px-4 py-12`, `lg:grid-cols-2` with `gap-12`.

Changes:
1. **Stats derived, not typed.** `stats` comes from `EXAMPLE_CAMPAIGN`: chapters = `chapters.length` (14), NPCs = `npcs.length` (10), Locations = `locations.length` (10), Open quests = active quests (5). Subtitle: "Started October 2024 · 14 sessions". Dates as `12 Mar` (`toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })`), not `12/03/2025`.
2. **Tiles are links.** Each tile is a `<Link>`: Chapters → `/story/chapters`, NPCs → `/npcs`, Locations → `/locations`, Open quests → `/quests`. Hover `--surface-card-hover`. The tile label row gets a trailing `→` in accent. Grid gap stays 1px, but the gap colour is now `card-border` (#3B3630), not `bg-secondary`.
3. **Update rows are links with substance.** Each row is: date (72px, muted 14px), mark (28px), name (Zilla 600 16px) over a 13px detail line, and the status word on the right in its own tone.
   - Chapter: the mark is the chapter number on a sunken square (`--surface-sunken-bg`, 1px `card-border`, 12px muted). Detail is the summary, clamped to one line. Right side: "Chapter" in secondary.
   - Quest: `EntitySigil`. Detail "Quest · {place} · {n} of {m} objectives". Right side: status in `valence-*` (e.g. Active, #A59B45).
   - NPC: `EntitySigil`. Detail "NPC · {title}". Right side: disposition (`disposition-*`).
   - Rows link to `/story/chapters/{id}`, `/quests?highlight={id}`, `/npcs?highlight={id}`. The deep links must land on the example rows, so the example ids need to work with the directories' highlight params, or link to the list page only.
   - The `ExampleUpdate` type gains a `ref` (the fixture id). Still no author.
4. **Card footer.** Hairline, then "10 rumours gathered, 2 of them false" (derived) on the left and "Open the example →" (accent, 600 14px) on the right, linking to `/rumors`.
5. **Caption beside the chip:** "Click around, nothing is saved" (muted 14px). This replaces the old intent of "nothing here is clickable" now that it is clickable. Remove `aria-hidden` from the panel, since it now contains links.
6. **Invite-only line.** Remove "To get in, ask whoever set up your campaign for a join link." from the blurb. Add a line between the blurb and the buttons: Lucide `Lock` 16px muted, plus "Invite only for now. Ask whoever set up your campaign for a join link." (14px, primary ink). Blurb `mb-6`, line `mb-4`.
7. **Product lines become links.** Each `PRODUCT_LINES` item becomes a row: text (secondary 16px) on the left, link on the right (accent 600 14px): "See the story →" `/story/chapters`, "See the rumours →" `/rumors`. The notes line says "Members only" (muted, not a link), because notes have no example. Rows are separated by a hairline `--surface-page-border`, padding 10px 0. The old `· ` prefix goes.

Unchanged: h1, the buttons, the raven line and "About the name".

## Interactions & Behavior
- Clicking a band, or its legend entry, toggles that status filter. Clicking the active one again returns to `all`. The active legend entry is bold and underlined (existing `RosterStatusBar` behaviour).
- Pills: selecting "All" removes the filter and gets no accent. Other selections get `roster-filter-active`.
- Search filters as you type (local), using the same fields as the real directory.
- Collapsible groups toggle with the heading button (`ChevronRight`, rotated 90° when open).
- NPC rows: clicking the row toggles expand, and only one row is open at a time. Chevron rotates 180°.
- Locations: while any filter or search is active, show a flat list with the path in the detail line. With no filter, show the tree with rails.
- Chapters: Show/Hide toggles the read run. "Unread" filters to `state === 'unread'`.
- Empty results use the existing `RosterEmpty` filter copy, without an action.
- State is local and resets on reload. It isn't persisted and isn't put in the URL.

## State (per example instance)
`query`, `statusFilter` (`'all'` | key), a secondary filter (`relationship` / `type` / `location` / `source` / chapter `mode`), `expandedId` (NPC), collapsed-group set, chapter `runExpanded`. Exactly what each `*Directory` already holds, which is why reusing the directories is the preferred route.

## Data
- Proposed fixture: `example-campaign.proposed.ts` in this folder, a drop-in replacement for `src/shared/example-campaign/example-campaign.ts`. The type changes it needs are listed at the top of the file. Summary: `ExampleNPC` gains `description` and `race`; `ExampleRumour` gains `convertedToQuest`; locations grow from 2 to 10 and NPCs from 3 to 10; quests 10, rumours 10, chapters 14.
- Keep `src/pages/home/signed-out-example.ts` consistent. Home's stat strip says NPCs 23, Locations 9, Open quests 4, Chapter 14. Either update it to 10 / 10 / 5 / 14, or derive the numbers from the fixture's lengths (recommended, so they can't drift).
- **Fixture correction:** "Find Brother Aldous" was `completed` while Aldous is `missing`. The proposal makes the quest `active`.
- Add a consistency test (see `DATA-DECISION.md`).

## Design Tokens (dark → light comes from the same names)
| Role | Token / class | Dark |
|---|---|---|
| Page bg | `--surface-page-bg` | #201B16 |
| Card bg / border | `card` (`--surface-card-bg` / `-border`) | #2A2520 / #3B3630 |
| Band bg / border / on / on-muted | `--surface-band-*` | #14100B / #29241F / #F3EBE3 / #ABA39B |
| Sunken (progress track) | `progress-container` | #15110C |
| Ink / secondary / muted | `--surface-card-on` / `-on-muted` / `typography-muted` | #E9E1D9 / #AEA69F / #9E978F |
| Accent | `--accent-ink` | #D69253 |
| Outline border | `--action-outline-border` | #8C857D |
| Valence ink 0–3 | `valence-0..3` | #7EAB7A / #A59B45 / #CC7F30 / #E16566 |
| Valence fill 0–3 | `bg-valence-0..3` | #568153 / #81761A / #A86000 / #BE4649 |
| Disposition | `disposition-*` | friendly #7EAB7A, neutral #AEA69F, hostile #E16566, unknown #748EC7 |
| Expanded row / current chapter | `bg-secondary` / `bg-accent` | ≈ #342F2A / #3F3A34 |
| Entity palette 0–7 | `entity-sigil[data-sigil-index]` | #613A37 #594124 #454A26 #2A503C #1B4F54 #2F4963 #484061 #5A3B50 |

Type: headings Zilla Slab (600/700), body Archivo (400/500/600). Page h1 is about 34px/1.2, group h3 18px/28px, row name 16px Zilla 600, detail and cells 14px/20px. Row padding `roster-row` 14px 20px; sigil 28px, `rounded-md`. Radius 6px (`--border-radius-md`).

The sigil colours in the mockup are assigned by hand. In the app they come from `sigilIndexFor(id)`, so they will differ, and that's expected.

## Assets
Icons are Lucide (`Lock`, `Search`, `ChevronDown`, `ChevronRight`, `Check`, `Scroll`), already a dependency. Fonts are `@fontsource/archivo` and `@fontsource/zilla-slab`, already installed. No images.

## Files
- `Signed-out Examples.dc.html`: the mockups (open in a browser; needs `support.js` beside it).
- `support.js`: runtime for the mockup file only. **Not for the app.**
- `example-campaign.proposed.ts`: proposed fixture.
- `DATA-DECISION.md`: static vs Firestore, and the tests to add.

Source files read for this design: `SignedOutHome.tsx`, `GatedContent.tsx`, `GatedPageState.tsx`, `gated-page-copy.ts`, `Roster.tsx`, `EntitySigil.tsx`, `NPCRowCells.tsx`, `NPCDirectory.tsx`, `NPCExample.tsx`, `LocationRowCells.tsx`, `LocationExample.tsx`, `location-presentation.ts`, `QuestRowCells.tsx`, `QuestExample.tsx`, `QuestDirectory.tsx`, `quest-presentation.ts`, `RumorRowCells.tsx`, `RumorExample.tsx`, `RumorDirectory.tsx`, `rumor-presentation.ts`, `RumorComposer.tsx`, `ChapterList.tsx`, `ChapterExample.tsx`, `ChaptersPage.tsx`, `chapter-progress.ts`, `example-campaign.ts`, `signed-out-example.ts`, `components.css`, `colour-schema.json`, `token-values.baseline.json`.
