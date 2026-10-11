# One membership document (T136): design

Written 2026-10-11 against `main` at `bfac3e1`; approved by the maintainer in conversation the same
day. It carries out change 7 of the [data model review](data-model-review.md#f7-membership-is-stored-twice)
(F7), but not in the shape the review sketched: see [Why not `members`](#why-not-a-new-members-collection).

## Goal

Membership is stored once. Access, the group list and the functions all read the same record, so
the two can no longer disagree, and no rule reads the account's global profile to decide
membership. Both, fully (maintainer, 2026-10-11): the `groups` array goes entirely.

## Today

A user is in group `g` when **both** of these hold, and nothing but correct functions keeps them
in step:

| Copy | Read by | Written by |
|---|---|---|
| `users/{uid}.groups` (array) | `isGroupMember` (`firestore.rules.prod:338`, 37 uses); Storage's `isGroupMember` (`storage.rules.prod:59`); the group switcher (`GroupService.getGroups`, `FirebaseContext.loadGroups:338`); `createCampaign:114`; `redeemInvitation:136`; `planAccountDeletion:88` and `deleteAccount:144`; `finishGroupDeletion:61` | `createGroup:194`, `redeemInvitation:157`, `removeUserFromGroup:82`, `finishGroupDeletion:66`; the dev generator (`userGenerator.ts:146`) and the e2e seed (`seed.ts:113`) |
| `groups/{g}/users/{uid}` (the group profile) | `isGroupAdmin` (`role`); the roster; everything that credits a member by name | the same functions; only functions create or delete it |

The group profile is already one document per member, already holds `role`, and its `userId`
field is written by `createGroup` and `redeemInvitation` and is outside the client's update
allowlist (`firestore.rules.prod:633`). It also carries the username and characters, and the
member's private `notes` and `story-progress` live beneath it.

## Design

### The model

A user is a member of `g` exactly when `groups/{g}/users/{uid}` exists. Its `role` decides admin,
as now. `users/{uid}.groups` stops meaning anything and is then removed. `users/{uid}.activeGroupId`
stays.

### Rules

**Firestore** (`firestore.rules.prod`):

```
function isGroupMember(groupId) {
  return isSignedIn() &&
         exists(/databases/$(database)/documents/groups/$(groupId)/users/$(request.auth.uid));
}
```

`isGroupAdmin` already `get`s the same document. Firestore bills a document that one request's
rules read more than once as a single read, so a write that checks both member and admin costs
one read instead of two, and no check reads the global profile.

One new rule lets a user list their own group profiles across groups:

```
match /{path=**}/users/{profileId} {
  allow list: if isSignedIn() && resource.data.userId == request.auth.uid;
}
```

- **list only**, never `get`, and only profiles whose `userId` is the caller: their own, which they
  can already read as members.
- A recursive match also applies to ordinary paths, so its reach is pinned by tests:
  - top-level `users/{uid}` documents have no `userId` field (`UserProfile` has `id`), so it grants
    nothing there;
  - on a group's roster (`groups/{g}/users`), someone outside the group can list only a profile of
    their own, which exists only if they are a member;
  - `notes` and `story-progress` sit deeper than `users/{profileId}` and do not match.

**Storage** (`storage.rules.prod`): `isGroupMember` becomes
`isSignedIn() && firestore.exists(profilePath)`, one cross-service read instead of an `exists` and
a `get` of the global profile.

### The index

`collectionGroup("users").where("userId", "==", uid)` needs a single-field index on `userId` at
collection-group scope. It is recorded in `firestore.indexes.json` as a `fieldOverride` beside the
existing `users.username` one; an override replaces the field's automatic indexes, so it lists the
collection-scope ascending index too.

**The deploy does not push indexes** (`--only firestore:rules,storage`; T135), and deploying the
file as it stands would also create its 20 unused indexes. The maintainer creates this one index
in production by hand (Firebase console, Firestore → Indexes → Single field → Add exemption, or
`gcloud firestore indexes fields update userId --collection-group=users --enable-index`) **before
step 2 merges**. The emulators enforce no indexes, so no test can catch it missing; the live
symptom would be every sign-in failing to list its groups.

### Reads

- **The group switcher**: `GroupService.getGroups()` runs the collection-group query, takes each
  group id from the profile's path (`ref.parent.parent.id`), then reads the group documents as
  now. `FirebaseContext.loadGroups` stops passing `profile.groups`.
- **`createCampaign`**: membership is the group profile existing; the transaction already reads it.
- **`redeemInvitation`**: "already a member" is the group profile existing; it already reads it.
- **Account deletion** (`planAccountDeletion`, `deleteAccount`, and through them
  `scripts/delete-account.js`): the groups come from the same collection-group query, through the
  Admin SDK and the same index. A retry then finds whatever profiles a failed run left behind,
  rather than relying on the global profile being deleted last.
- **Group deletion** (`finishGroupDeletion`), stage 1: access still ends before anything is emptied,
  now by deleting the group's member profile **documents** (shallow, by a `BulkWriter`), which
  closes `isGroupMember` and `isGroupAdmin` at once. `activeGroupId` is cleared through
  `users.where("activeGroupId", "==", g)`, an automatic single-field index. What lies beneath the
  profiles goes in the following `recursiveDelete`, which finds descendants whether or not their
  parent still exists, so a retry still finishes. Stages 2 to 5 are unchanged.

### Cost at scale

Loading a user's groups at sign-in becomes one query (a read per group) plus the group documents,
where it was the global profile (read anyway) plus the group documents: N more reads per sign-in,
N the number of groups, usually one or two. Every rule evaluation that checks membership stops
reading the global profile, and writes that check member and admin read one document instead of
two, so reads fall overall.

## Rollout

Four merges, each additive before the next removes, as every data change here ships (TODO.md,
"How every data change ships"). Every step leaves the live site working whichever of its parts
has deployed.

### Step 1: the audit, the index and the list rule

- **`firebase/functions/scripts/audit-membership.js`**, in the shape of `audit-location-ids.js`:
  read-only by default, `--apply` to repair, `--revert` from the saved manifest, `--emulator`. It
  reads every `users/{uid}` and every group profile (a collection-group read of `users`, skipping
  documents with no parent group) and reports:
  - **(a) an array entry with no group profile**: that person loses access at step 3. Listed for
    the maintainer to resolve (re-invite, or accept the loss). `--apply` leaves it: repairing it
    would mean inventing a username and a role.
  - **(b) a group profile whose `userId` is missing or is not its document id**: the list query
    would miss it. `--apply` sets it to the document id.
  - **(c) a group profile its owner's array does not list**: on the roster without access today;
    gains access at step 3. Listed for the maintainer to resolve (remove them, or accept it).

  Every current writer keeps the copies in step, so zero of each is expected. The script is there
  to show that, not to assume it.
- The list rule and the index `fieldOverride`.
- **Maintainer, after the merge**: create the index in production; run the audit; resolve any (a)
  or (c).

### Step 2: everything reads profiles

Every read in [Reads](#reads). The functions still write the array, so the live rules, which still
read it, keep working. Requires the production index.

### Step 3: the rules switch

`isGroupMember` becomes `exists()` in both rule files, in its own merge after step 2 has shipped
(a rule may rely only on what is live). **Maintainer**: run the audit again just before it merges.

### Step 4: the array goes

- `createGroup`, `redeemInvitation`, `removeUserFromGroup` and `finishGroupDeletion` stop writing
  `groups`; they still set or clear `activeGroupId`.
- `groups` leaves `UserProfile`, `UserService`, the dev generator and the e2e seed.
- A script, with a revert file, deletes the field from every `users/{uid}` (a mode of the audit
  script or one of its own; the plan decides). **Maintainer**: run it after the merge.
- No rule changes: `groups` is already outside the client's update allowlist
  (`firestore.rules.prod:583`).
- Account deletion releases a user's names with one collection-group query on
  `usernames.userId`, not group by group. Its group profiles go before its batch
  commits, so that a failed note deletion leaves the account whole; a retry
  after a failed commit then has no profile, and since this step no array, to
  find the groups by. **Maintainer**: create that collection-group index
  before step 4 merges, as for `users.userId`.

## Testing

- **`test/rules/firestore-rules-prod.test.ts`**: access granted by a profile without an array entry,
  refused by an array entry without a profile; the list rule's three edges above. The `RULES_FILE`
  control: the step 3 tests fail against `HEAD`'s rules.
- **`test/rules/storage-rules-prod.test.ts`**: the same member cases, with the same control.
- **Functions suites** for `createCampaign`, `redeemInvitation`, account deletion and group
  deletion, including a deletion that fails part-way and is retried.
- **`auditMembership.test.ts`**: each mismatch seeded, reported, and repaired or listed; `--revert`
  restores.
- **Client unit tests** for `getGroups` and `loadGroups`.
- **e2e**: the sign-in and join journeys run on the production rules, so steps 2 to 4 each run
  `npm --prefix firebase run test:e2e`.

## Why not a new `members` collection

The review proposed `groups/{g}/members/{uid}` with the role. The group profile would still have
to exist for the username, the characters and the private documents beneath it, so each member
would keep two documents that must be created and deleted together: the array traded for another
copy. Moving the whole of `groups/{g}/users` to `members` would avoid the collection-group name
clash, but moves every member's private notes and reading progress to new paths, the largest
migration of the three for a tidier name. The clash itself is harmless: top-level profiles carry
no `userId`, so the query never matches them.

## Rolling back

- **Steps 1 and 2** can each be reverted alone: the array is still written and still what the
  rules read.
- **Step 3**: revert the rule change; the array is still written, so the old rules hold. Once
  step 4 has shipped this no longer holds: anyone who joined since has no array entry, so the
  arrays must first be rebuilt from the profiles (the audit's (c) list is exactly them).
- **Step 4**: `--revert` from the removal script's manifest restores the arrays; a revert of the
  merge restores the writes.
