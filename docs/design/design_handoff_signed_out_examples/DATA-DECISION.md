# Example data: static in code, not in Firestore

**Decision:** keep the example campaign as a static, typed fixture in `src/shared/example-campaign/`. Don't add an "example data" collection to Firestore.

## Why
1. **No public read path.** Signed-out visitors aren't authenticated. A Firestore-backed example needs a rule that lets anyone read something. That's a new surface in a rules file that has already had holes (the notes rule, legacy fields). Static data has nothing to secure.
2. **Cost and abuse.** Every anonymous page view would be a billed read that anyone can repeat in a script. A static chunk from Hosting costs nothing per view.
3. **First paint.** These are the first pages a stranger sees. Static rows render immediately. Firestore adds SDK start-up, a round trip and a skeleton, which is the "looks empty or broken" impression we're trying to avoid.
4. **No drift.** The fixture's types are `Pick`s of the real `NPC` / `Quest` / `Location` / `Rumor` types, so a renamed field breaks the build. The types also have no author field, so the example can't credit an invented person. Firestore documents could drift silently, and nothing would stop a `createdBy` being added.
5. **Reviewed and tested.** Changes go through a PR and are covered by `example-campaign.test.ts`. Console edits leave no record.
6. **Same everywhere.** The emulators, e2e tests and preview channels get the same example with no seeding.
7. **Already decided.** The fixture's own comment says it is "never derived from live data and never fetched".

## When to revisit
Only if someone who isn't a developer needs to edit the example without a deploy, or if per-locale or A/B variants are wanted. Even then, the next step is a JSON file served from Hosting, not Firestore.

## Do alongside the bigger fixture
- **Lazy-load it.** Import the `*Example` components (and with them the fixture) through `React.lazy` from the gated branch, so members never download about 10 KB of example prose.
- **Derive Home's numbers.** In `signed-out-example.ts`, compute `stats` from `EXAMPLE_CAMPAIGN` lengths and statuses instead of typing them. Today Home claims 23 NPCs and 9 locations, while the lists show 3 and 2.
- **Add a consistency test** (`example-campaign.test.ts`):
  - every `npc.locationId`, `quest.locationId` and `location.parentId` resolves to a location in the fixture;
  - parents are listed before their children (`LocationExample` relies on this);
  - every id starts `example-` and is unique;
  - `rumour.sourceName` for `sourceType: 'npc'` names an NPC in the fixture;
  - no quest is `completed` while an NPC named in its title is `missing` (the check that would have caught "Find Brother Aldous");
  - Home's derived stats equal the fixture's counts;
  - the chapter `order` values run 1..n without gaps, and exactly one chapter has `isCurrent`.
