# Firestore data model review (T119)

Written 2026-10-07 against `main` at `b78d72f`, for the maintainer to read before anything changes.
Since then F4 (which collections, a name on every record, a limit on every text field), F7's
global admin and F2's client cache have been done; those sections describe what is left.

**How this was measured.** Everything below was read in the code unless it says otherwise.
"Run" means it was run: against the dev emulator after a fresh `manage-dev-data.ps1 -Action
generate`, or in the dev app in Chrome. Production was **not** read: not its data, its sizes or its
indexes. The open questions that only production can answer are listed in
[What production has to answer](#what-production-has-to-answer).

## Summary

The model is sound for what it was built for: one table of friends with one campaign of a few
hundred records. Security has had most of the attention, and it shows. Membership, roles and
deletion are server-side, and the rules are pinned by tests. What has had little attention is
**shape and size**. Nothing bounds how much a client reads, how big a document grows or what a
member may write into it, and several relationships are stored twice with nothing keeping the two
copies in step.

In the order worth doing:

1. **Store each relationship once** ([F1](#f1-relationships-are-stored-twice-or-one-way-only)).
   A link added on an NPC's page does not show on the quest's page. This is the one finding players
   can see today.
2. **Turn on the client cache, then page the reads** ([F2](#f2-every-read-is-a-whole-collection)).
   Today every page load re-reads every collection it listens to, in full.
3. **Move growing lists out of their parent document** ([F3](#f3-some-documents-grow-without-bound)):
   notes on NPCs, locations and rumors, and the saga.
4. **Stamp attribution and time on the server side of the trust line**
   ([F5](#f5-attribution-is-written-and-believed-from-the-client),
   [F6](#f6-time-is-stored-three-ways)).

Firestore is still the right store. See [From scratch](#from-scratch).

---

## The model as it is

### Paths

```
users/{uid}                              global profile: email, groups[], activeGroupId,
                                         preferences, entityExtractionUsage
groups/{g}                               name, description, createdBy, crest, deleting
├── users/{uid}                          group profile: username, role, characters[],
│   │                                    activeCampaignId, activeCharacterId
│   ├── notes/{noteId}                   private notes (campaignId is a FIELD, not the path)
│   └── story-progress/{campaignId}      private reading position
├── usernames/{lowercased name}          reservation: userId, originalUsername
├── registrationTokens/{token}           invitations: used, expiresAt, createdBy, notes
├── pendingUploads/{id}                  image lease ledger (T084)
├── releasedImages/{id}                  image release ledger (T084)
├── campaignDeletions/{c}                server only: deletions to resume (T037)
└── campaigns/{c}                        name, description, isActive, banner, deleting
    ├── npcs/{slug}
    ├── locations/{slug}
    ├── quests/{slug}
    ├── rumors/{slug}
    ├── chapters/{id}                    one document per chapter, full text inside
    └── saga/sagaData                    the whole saga in ONE document
```

Server-only top-level collections (no client rule, so the final deny covers them):
`signUpReservations`, `deviceSignIns`, `contactThrottle`, `groupDeletions`.

### Who writes what

- **Cloud Functions** write membership and administration: `createGroup`, `redeemInvitation`,
  `setMemberRole`, `removeUserFromGroup`, `deleteGroup`, `deleteCampaign`, `deleteUser`, and the
  AI usage counters in `entityExtraction`. The rules refuse those fields to clients
  (`firestore.rules.prod:437`, `:487`).
- **The client** writes all campaign content, through `DocumentService`
  (`core/services/firebase/data/DocumentService.ts`). `createDocument` (`:185`) spreads
  attribution built in `core/attribution/attribution.ts` over the caller's data. Updates go
  field by field (T083). List changes run in a transaction (`updateDocumentAfterReading`, `:298`).
- **Ids** of NPCs, quests, rumors, locations and campaigns are slugs of the name
  (`core/utils/entity-id.ts:42`, `CampaignService.ts:74`), claimed with an atomic create (T081).
  Notes and chapters take generated ids.

### How it is read

- Every entity list is a **whole-collection listener**: `useCampaignCollection`
  (`shared/hooks/useCampaignCollection.ts`), opened while a page needs it (`PERF-03`). There is no
  `limit`, `orderBy` or `startAfter` anywhere in `src/`. The only filtered query is notes by
  `campaignId` (`NoteContext.tsx:112`); the other queries filter on one field
  (`DocumentService.queryFromServer`, `queryDocuments`).
- **The Firestore client has no persistent cache.** `BaseFirebaseService.ts:63` calls
  `getFirestore(app)`, which keeps its cache in memory. A reload or a new tab therefore starts every
  listener from nothing and is billed one read per document.
- **Search loads everything.** `SearchContext.tsx:159-164` opens the chapters, NPCs, locations,
  quests, rumors and notes listeners and indexes them in the browser.
- **The saga is one document**, read and written whole (`useSagaData.ts:58`, `:124`).

### What a sample campaign weighs

Run against the regenerated dev emulator (JSON size of each document's data):

| Collection | Documents | Average | Largest |
|---|---|---|---|
| npcs | 46 | 1.0 KB | 1.2 KB |
| quests | 20 | 1.4 KB | 1.6 KB |
| locations | 26 | 0.8 KB | 0.8 KB |
| rumors | 20 | 0.8 KB | 0.9 KB |
| chapters | 62 | 0.8 KB | 1.2 KB |
| saga | 4 | 1.0 KB | 1.1 KB |

Sample data is small by construction, so this says nothing about production. A real chapter of
3,000 words is about 18 KB, so a hundred of them is about 1.8 MB, all downloaded whenever the
story or search is opened.

---

## Findings

Each finding gives what is stored, the evidence for it, what happens at scale, and what to do.

### F1. Relationships are stored twice, or one way only

| Relationship | Stored on | Read on |
|---|---|---|
| NPC ↔ quest | `NPC.connections.relatedQuests` **and** `Quest.relatedNPCIds` | each detail page reads and writes only its own half (`NPCDetailPage.tsx:503`, `QuestDetailPage.tsx:611`) |
| NPC ↔ location | `NPC.locationId` **and** `Location.connectedNPCs` | the location page shows both and labels the disagreement ("recorded as being here", `LocationDetailPage.tsx:234`) |
| location ↔ quest | `Quest.locationId`, `Quest.keyLocations[].locationId` **and** `Location.relatedQuests` | the quest page shows locations that list it as "points at this quest" (`QuestDetailPage.tsx:256`) |
| rumor → location | `Rumor.locationId` **and** `Rumor.relatedLocations` | both, OR-ed (`LocationDetailPage.tsx:222`) |
| NPC → NPC | `NPC.connections.relatedNPCs` on one side only | the other NPC's page does not show it (`NPCDetailPage.tsx:360`; read in the code, not run) |
| rumor → NPC | `Rumor.relatedNPCs` only | derived on the NPC page (`NPCDetailPage.tsx:403`): **the right pattern** |

**Consequence.** A link made on one page is missing from the other (NPC ↔ quest). Where both
halves are shown, players see two answers. Deleting a record leaves its id in every list that
named it: `deleteNPC` removes the document and its portrait and nothing else
(`NPCContext.tsx:179`). Readers drop ids that resolve to nothing, so this is invisible but
permanent.

**Recommendation.** One owner per relationship, and the other side derived on read, as rumor →
NPC already is. Keep `Quest.relatedNPCIds` (the quest page is where a party plans) and derive
"quests this NPC is in". Keep `NPC.locationId` and derive "people here". Keep `Quest.locationId`
and `keyLocations` and derive the location's quests. Keep `Rumor.relatedLocations` and fold
`locationId` into it, or the reverse. Decide whether NPC → NPC is symmetric. If it is, store it
once and show it on both pages.

**Migration.** Read-only first: an audit in the shape of `audit-location-ids.js` that counts the
pairs where the two halves disagree. Then a script with a dry run and a revert that merges each
removed half into the kept one. The frontend reads the merged field before the write paths change.
No rule changes are needed.

### F2. Every read is a whole collection

**Consequence at scale.** Reads grow with campaign size times page loads, and nothing bounds
either. Opening a campaign of 1,000 records with search costs about 1,000 reads per load, and
each reload costs as much again because of the memory cache. Firestore's free tier is 50,000
reads a day per project. One such campaign spends it in fifty loads. Download size grows the same
way, mostly through chapter text. A slow phone pays for the whole story to search one NPC.

Three design choices depend on having everything in the browser, so paging cannot simply be
switched on:

- **Search** indexes client-side (`SearchContext.tsx`).
- **Slug ids** check for collisions against the loaded list (`generateUniqueEntityId`'s `isTaken`,
  `entity-id.ts`), with the atomic create as the backstop.
- **Derived links** (F1's recommendation, and the inbound lists already on the detail pages)
  filter other whole collections.

**Recommendation, in order of cost:**

1. **Done (2026-10-08), for remembered sessions only**: `core/services/firebase/core/firestoreCache.ts`.
   A session the user did not ask to keep gets the memory cache, and signing out deletes the
   persistent one. **Enable `persistentLocalCache`** in `initializeFirestore`. A resumed listener is then billed
   only for documents that changed since the cache was written, as long as it resumes within
   Firestore's resume window (30 minutes, per Firebase's billing documentation; not measured
   here). This is one call. It needs a check of the multi-tab manager against the app's
   per-tab campaign switching, and a decision on what a signed-out shared computer keeps.
2. **Split chapter text from chapter metadata**: `chapters/{id}` keeps title, order and summary,
   and `chapterText/{id}` holds the body, read when a chapter is opened. Search then needs a
   summary, not the book.
3. **Page the directories** once campaigns are big enough to need it. The derived lists then need
   queries (`where('relatedNPCIds', 'array-contains', id)`), which those single-owner fields
   support.

### F3. Some documents grow without bound

- **Notes inside records**: `NPC.notes`, `Location.notes`, `Rumor.notes`. Each append rewrites
  the record in a transaction (`NPCContext.tsx:105`, T083). `RumorNote` carries the full
  attribution block per note (`rumors/types.ts:11`).
- **The saga** is a single document, `saga/sagaData`.
- **Chapters** hold their full text.

Firestore refuses a document over 1 MiB. A heavily annotated NPC or a long saga reaches it
eventually, and then every write to that record fails, edits that do not touch the notes
included. Each append also re-sends the whole record to every listener. Long before the limit,
transactions on the same record contend when several players annotate it at once.

**Recommendation.** Notes become a subcollection (`npcs/{id}/notes/{noteId}`), read when the record
is opened. The saga becomes sections, as chapters already are. Chapter text moves out (F2).

### F4. Lists and counts are what is left unbounded

The rules name the six kinds of record a campaign holds (`namingField`) and refuse any other
collection. A new record must carry its `name` or `title` as text, no client creates a group
document, and every text field has a limit (`textFits`; the app's `TEXT_LIMITS` in
`src/core/constants/textLimits.ts`, which the forms and `DocumentService` enforce first): a line
200 characters, a text 10,000, a chapter 200,000, the saga 500,000.

Two things no rule can bound. **What is inside a list** -- a record's notes, a quest's objectives,
a location's features -- since rules cannot look into one; the app caps each entry it writes, but a
client that skips the app is stopped only by Firestore's 1 MiB per document. And **how many
records** a member writes, since rules cannot count.

**Recommendation.** Nothing more in the rules. F3 (notes as subcollections) turns each note into a
document whose text is capped on its own; paging (F2) bounds what each member downloads, however
many records there are; and any member can delete junk.

### F5. Attribution is written and believed from the client

`createdBy`, `createdByUsername`, `modifiedBy`, `dateAdded` and `dateModified` are built in the
browser (`attribution.ts:32`) and no rule checks them. Any member can create a record "by" another
member, or rewrite who created an existing one. The rules' own comment says "the audit trail
survives" (`firestore.rules.prod:46`). It survives only as long as nobody edits it.

The usernames and character names in attribution are copied at write time and never refreshed.
After a rename, old records show the old name. That may be what is wanted ("who wrote it then"),
but nothing records it as a decision.

**Recommendation.** In the rules: on create, `createdBy == request.auth.uid` and
`modifiedBy == request.auth.uid`; on update, `createdBy` and `dateAdded` unchanged and
`modifiedBy == request.auth.uid`. Times move to `request.time` (F6). Decide whether names in
attribution are snapshots (keep as is) or resolved from the uid when read.

### F6. Time is stored three ways

- **Firestore Timestamps**: `groups/{g}.createdAt`, group profiles' `joinedAt`, `usernames`,
  `registrationTokens` (`createGroup.ts:63,92,122`; the client's `new Date()` in
  `CampaignService.ts:86` and `InvitationService.ts:64`). The types say `Date | string`
  (`core/types/user.ts`).
- **ISO strings from the client clock**: all attribution, `StoredImage.uploadedAt`, AI usage resets.
- **`YYYY-MM-DD` strings**: notes inside records (T001).

A client with a wrong clock writes wrong times, and nothing orders the three kinds against each
other.

**Recommendation.** Timestamps from the server (`serverTimestamp()`, checked as `request.time` in
the rules) for every *when-it-happened* field. Keep `YYYY-MM-DD` only where a calendar day is
meant (a note's in-game date). The planned rename of `dateAdded` to `createdAt`
(`database-field-alignment.md`) belongs in the same migration, so records are rewritten once.

### F7. Membership is stored twice

A user is in a group when `users/{uid}.groups` lists it (what every rule reads,
`isGroupMember`, `firestore.rules.prod:318`) and when `groups/{g}/users/{uid}` exists (the roster,
which holds `role`). Only Cloud Functions write either, so they agree as long as every function is
correct. T080 was a case where they did not. Every rule evaluation that needs membership also
reads the whole global profile.

**Recommendation.** Not urgent; it is correct today. From scratch, membership is one document,
`groups/{g}/members/{uid}` with the role, checked with `exists()`.

**Done differently (T136, 2026-10-11).** The group profile itself became that document: the rules
check that `groups/{g}/users/{uid}` exists, the app lists a user's groups by the profiles' `userId`,
and the array is no longer written. A separate `members` document would have left two per member.
See [membership-design.md](membership-design.md).

### F8. The index file is stale and not deployed

`firestore.indexes.json` declares 20 composite indexes for queries the client never makes. Every
query filters on one field with no `orderBy`, and those need no composite index. The deploy
leaves the file out (`--only firestore:rules,storage`). What production has is **unknown**.
Unused indexes cost storage and write latency on every write to the fields they cover.

**Recommendation.** Read production's indexes (below). Then make the file say exactly what is
needed, which is probably nothing until paging (F2) brings `orderBy`. Then decide whether the
deploy includes it.

### F9. Leftovers from earlier shapes

- The free-text `location` alongside `locationId`. Settled by T079 (2026-10-08): production's
  documents without an id were given one, and `location` is now only shown, never looked up.
- `Quest.importantNPCs`, deleted in `15-5`, still sits on older documents. Nothing reads it.
- Slug ids lose every character outside `a-z0-9`: "Éowyn" becomes `owyn` and "Þjóðólfr"
  becomes `j-lfr`. They also keep the original name after a rename. Harmless to the data (ids are
  opaque) but visible in URLs.
- Private notes name their campaign in a field, not the path. `deleteCampaign` therefore has to
  search every member's notes. It does, but a path would make the campaign own its notes.

---

## What is worth changing, and how

| # | Change | Layers | Production migration | Size |
|---|---|---|---|---|
| 1 | One owner per relationship (F1) | frontend | merge halves with a script (dry run, revert) | M |
| 2 | `persistentLocalCache` (F2) | frontend | none | S |
| 3 | Server-stamped attribution and times, `createdAt` rename (F5, F6) | frontend, then rules | rewrite every record once | M |
| 4 | Chapter text and saga split (F2, F3) | frontend, rules | move text to the new documents | M |
| 5 | Notes as subcollections (F3) | frontend, rules, `deleteCampaign` | move array entries out | M |
| 6 | Index file matches reality (F8) | config | none | S |
| 7 | One membership document (F7) | functions, rules, frontend | copy, then switch the rules | L |

**How a migration runs here.** Production holds real campaigns, so every data change is a script
in `firebase/functions/scripts/`, in the shape of `audit-location-ids.js`: read-only by default,
`--apply` to write, `--revert` from a saved manifest, run by the maintainer with their own gcloud
login. The order is fixed by the deploy (functions, then rules, then frontend). A change that
renames or moves a field ships in three steps: the frontend reads both shapes; the script
rewrites; a later frontend drops the old shape. A rule that refuses the old shape comes after
that, in its own merge.

1 and 2 are independent and are the cheapest visible wins. 3 and 5 are best done together, so
records are rewritten once.

---

## From scratch

**Is Firestore still the right store?** Yes. The app is a shared journal with live updates between
players at one table, offline tolerance and per-group access control. Firestore listeners and
rules give all three with no server to run, at a size where per-operation billing stays small. A
relational store (Cloud SQL, or Postgres through Supabase) would make F1's links and F2's queries
natural. In exchange it would need an API layer for access control, a realtime channel and a
migration of Auth and Storage. That is a rewrite for problems that F1 to F6 solve in place.
Reconsider only if the product grows cross-campaign reporting or full-text search beyond what a
per-campaign index can hold. Even then, search can be added beside Firestore without moving off
it.

The Firestore location was fixed when the project was created and cannot change (see T118). That
is a reason to keep this project, not to move.

**What the model would be if built today:**

```
users/{uid}                       email, preferences (nothing that grants access)
groups/{g}                        name, createdBy, createdAt (server time)
├── members/{uid}                 role, username, characters[], joinedAt   ← THE membership
├── usernames/{name}              reservation
├── invitations/{token}           (server-written)
└── campaigns/{c}
    ├── npcs/{autoId}             slug as a field if pretty URLs are wanted
    │   └── notes/{autoId}
    ├── locations/{autoId}        parentId
    │   └── notes/{autoId}
    ├── quests/{autoId}           npcIds[], locationId, keyLocations[]
    ├── rumors/{autoId}           npcIds[], locationIds[]
    │   └── notes/{autoId}
    ├── chapters/{autoId}         title, order, summary
    ├── chapterText/{chapterId}   content
    ├── sagaSections/{autoId}
    └── members/{uid}/            private per campaign:
        ├── notes/{autoId}
        └── progress              reading position
```

Its rules:

- Membership is `exists(/groups/{g}/members/{uid})`. Only functions write it.
- Each collection is named, with its required fields and sizes checked.
- Attribution is checked against `request.auth.uid` and `request.time`.
- Every relationship has one owner field, and the reverse is a query.
- Every *when* is a server Timestamp.

Clients use the persistent cache and paged directories. The search index is a small per-campaign
summary document, or a search service if campaigns outgrow it.

Most of this is reachable from today's model by the eight changes above, without moving anything.
The exceptions are private data under the campaign rather than the user, and auto ids. Neither is
worth a migration on its own.

---

## Answers (maintainer, 2026-10-08)

The structure itself was decided in `backend-structure-options.md`: R2, Firestore restructured.

1. **NPC → NPC links run both ways.** "Aragorn knows Arwen" is stored once and shown on both pages.
2. **Names in attribution are the author's name now.** A record stores who wrote it
   (`createdBy`, and `createdByCharacterId`, which it already writes) and the names are looked up
   when it is shown, so a renamed character is renamed everywhere. The name stored at writing time
   stays only as the fallback for an author who has left the group and has no profile to look up.
   Only the id is something the rules can check (F5); a group of at most 10 members makes the
   lookup one read of its profiles.
3. **Every link is two-way and editable from either page.** The owner only decides where a link
   is stored: adding the quest on the NPC's page and adding the NPC on the quest's page have the
   same outcome. The maintainer's original reason for links by name (naming an NPC in a quest
   before creating them) is already met by the attach tray's "add one" hatch, which creates the
   record through quick add and links it without leaving the form (`AttachTray.tsx`). **An NPC
   may be linked to several places**, not one: F1's proposal kept the single `NPC.locationId`,
   which this replaces with a list (confirmed by the maintainer).

## What production has to answer

These are read-only. Nothing here can be measured from the repo:

- **Indexes**: `npx firebase firestore:indexes --project dnd-campaign-companion` from `firebase/`.
- **How big real campaigns are**: documents per collection, the largest documents, the longest
  `notes` arrays and the longest saga. An extension of `audit-location-ids.js` can report all of
  it without printing any content.
- **How often F1's two halves disagree**: the same kind of audit.
