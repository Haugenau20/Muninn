// src/shared/components/quick-add/useQuickAddCreate.ts
import { useCallback } from "react";
import {
  useNPCs,
  useQuests,
  useLocations,
  useMergeIntoRecord,
  useLinkPrivacy,
  planMerge,
  describeMerge,
} from "features/campaign-entities";
import { useNotes } from "features/collaboration";
import type { CreateAlongside, CreateOptions } from "core/types/common";
import {
  resolveNameToId,
  resolveNamesToIds,
  type NamedRecord,
} from "shared/utils/resolve-name-to-id";
import {
  QUICK_ADD_SPECS,
  type QuickAddCarry,
  type QuickAddEntity,
  type QuickAddValues,
} from "./quickAddSpecs";

/**
 * What a create needs beyond the two typed fields.
 *
 * `noteId`/`entityId` are note conversion's existing handoff and are passed
 * straight through to `convertInto`, which commits the note's mark with the
 * record (T088).
 */
export interface QuickAddCreateOptions {
  noteId?: string;
  entityId?: string;
  /** Extracted fields the two-field surface does not show. See `QuickAddCarry`. */
  carry?: QuickAddCarry;
  /**
   * The answer to "already exists" (T163). Without one the create stops at
   * a name a record already carries, with a `SameNameError`. `merge` adds
   * what was typed to that record instead; `createAnyway` creates it all the
   * same, a second record of the name if the name was kept.
   */
  sameName?: { merge: string } | { createAnyway: true };
  /** Create it in the author's private space (T163). */
  private?: boolean;
}

/**
 * Replace the carry's name-shaped fields with the ids the document stores.
 *
 * Exported for its own tests: this is the step that decides whether a
 * converted record links to anything, and it is worth being able to state its
 * behaviour without mounting three providers.
 *
 * Three fields per entity, all of them prose arriving where an id belongs:
 *
 * - a **location**'s `parentId` carries `parentLocation` — "The Ashen Vale", not an
 *   id. Unresolved, it becomes `""`, which is what `buildDocument` already
 *   writes for a top-level place; the place shows under "Unplaced", honestly,
 *   rather than holding a reference to nothing.
 * - a **quest**'s `relatedNPCIds` carries `relatedNPCNames`. Names that do not
 *   resolve are dropped rather than stored, because stored they render as
 *   "Someone no longer in the directory" for a person who is right there.
 * - an **NPC**'s and a **quest**'s `locationId` is derived from the `location`
 *   name the model gave. The name stays in `location`, which is a prose field
 *   by contract (`NPCDetailPage`: "`NPC.location` describes; `locationId` is
 *   what resolves"), so this adds a link without moving the text.
 */
/**
 * A location reference that may already be an id, or may be a name.
 *
 * Both reach this path. *Add a place inside* passes a real `parentId` through
 * `QuickAddDialog`; note conversion passes `parentLocation`, which is prose.
 * `splitInitialData` cannot tell them apart -- it sees one `parentId` key --
 * so the question is settled here, against the loaded collection: a value that
 * *is* an id of a known location is one, and anything else is tried as a name.
 */
export function resolveLocationRef(
  value: unknown,
  locations: readonly NamedRecord[]
): string {
  if (typeof value !== "string" || !value.trim()) return "";
  // A provider mid-load hands back an empty list, and a caller may hand back
  // nothing at all. Neither is a reason to throw on the write path.
  if (!Array.isArray(locations)) return "";
  if (locations.some((location) => location?.id === value)) return value;
  return resolveNameToId(value, locations);
}

export function resolveCarriedNames(
  entity: QuickAddEntity,
  carry: QuickAddCarry | undefined,
  npcs: readonly NamedRecord[],
  locations: readonly NamedRecord[]
): QuickAddCarry | undefined {
  if (!carry) return carry;

  const knownNPCs = Array.isArray(npcs) ? npcs : [];
  const knownLocations = Array.isArray(locations) ? locations : [];
  const resolved: QuickAddCarry = { ...carry };

  if (entity === "location") {
    resolved.parentId = resolveLocationRef(carry.parentId, knownLocations);
  }

  if (entity === "quest") {
    // The schema's field is `relatedNPCNames`; the document's is
    // `relatedNPCIds`. They were the same key for as long as the mismatch
    // went unnoticed.
    resolved.relatedNPCIds = resolveNamesToIds(carry.relatedNPCNames, knownNPCs);
    delete resolved.relatedNPCNames;
  }

  if (entity === "npc" || entity === "quest") {
    const locationId = resolveNameToId(carry.location, knownLocations);
    if (locationId) resolved.locationId = locationId;
  }

  return resolved;
}

/** What one quick-add surface is about to create, as far as its reads go. */
export interface QuickAddReads {
  entity: QuickAddEntity;
  /** A location created inside another, by id. */
  parentId?: string;
  /** The note whose detection this converts. */
  noteId?: string;
  carry?: QuickAddCarry;
}

/**
 * Which collections a create will actually read.
 *
 * Only what turns a carried name into an id, or marks the source note. A
 * plain create reads none: it only writes. Opening all four lists on every
 * mount cost four listeners -- every NPC, quest, location and note in the
 * campaign -- for a surface that may be cancelled, and a released listener
 * stays open for five minutes (PERF2-003).
 *
 * @param reads What the surface is about to create
 */
export function listsToRead({ entity, parentId, noteId, carry }: QuickAddReads): {
  npcs: boolean;
  quests: boolean;
  locations: boolean;
  notes: boolean;
} {
  return {
    // Its own kind's list always (T163): the name is checked against the
    // records the client holds before anything is written.
    npcs: entity === "npc" || (entity === "quest" && carry?.relatedNPCNames !== undefined),
    quests: entity === "quest",
    locations:
      entity === "location" || Boolean(carry?.location),
    notes: Boolean(noteId),
  };
}

/**
 * The one write path behind all three quick-add mounts.
 *
 * All four contexts are read unconditionally -- hooks cannot be called behind
 * a branch -- but a collection's listener is opened only when `reads` says
 * the create needs it (see {@link listsToRead}). Without `reads`, every list
 * is opened, as it was before.
 *
 * Returns the new record's id, which is what `Create & open` navigates to.
 * Nothing is caught here: a rejected write must reach the caller so the
 * surface can keep the typed text and say what happened (§7).
 */
export function useQuickAddCreate(reads?: QuickAddReads) {
  const lists = reads ? listsToRead(reads) : { npcs: true, quests: true, locations: true, notes: true };
  const { addNPC, npcs } = useNPCs({ subscribe: lists.npcs });
  const { addQuest } = useQuests({ subscribe: lists.quests });
  const { createLocation, updateLocation, locations } = useLocations({ subscribe: lists.locations });
  const { convertInto } = useNotes({ subscribe: lists.notes });
  const mergeIntoRecord = useMergeIntoRecord();
  const linkPrivacy = useLinkPrivacy();

  return useCallback(
    async (
      entity: QuickAddEntity,
      values: QuickAddValues,
      options: QuickAddCreateOptions = {}
    ): Promise<string> => {
      /*
        Names become ids here, and nowhere earlier.

        Everything relational the extractor returns is prose -- it has never
        seen the NPC directory or the location tree -- and it was being written
        into id-shaped fields verbatim. `convertEntity` could not fix that: it
        has no access to the loaded collections. This hook already reads both,
        one line above, immediately before the write, which makes it the only
        place the translation can honestly happen.

        `resolveNameToId` fails closed on no match and on an ambiguous one, so
        an unresolved name leaves the id empty rather than dangling. The name
        itself is kept in the prose field it came from (`location`), so nothing
        the session said is lost -- only the false claim of a link.
      */
      // A shared record never names a private one (T163): its names resolve
      // against the campaign's records alone.
      const shared = <T extends { isPrivate?: boolean }>(list: readonly T[]) =>
        options.private ? list : (list ?? []).filter((record) => !record.isPrivate);
      const carry = resolveCarriedNames(entity, options.carry, shared(npcs), shared(locations));
      /*
        `values.parentId` too, and not only the carry. `splitInitialData` lifts
        `parentId` out of `initialData` into the typed values, and
        `buildDocument` gives it precedence -- so resolving only the carry
        would have left the raw name winning, and this whole step doing
        nothing for the one field that provoked it.
      */
      const resolvedValues: QuickAddValues =
        entity === "location" && values.parentId !== undefined
          ? { ...values, parentId: resolveLocationRef(values.parentId, options.private ? locations : shared(locations)) }
          : values;
      const document = QUICK_ADD_SPECS[entity].buildDocument(resolvedValues, carry);

      /*
        A person's place is a link the place owns (T131): it lists who is
        there, and a person may be in several. So the resolved place is not
        written on the NPC, but the NPC added to the place's list once it
        exists. That takes a second write -- the one write beside the create
        is the note's mark -- and a failure there leaves the person with the
        place still named in their prose `location`, nothing lost.
      */
      let placeId: string | undefined;
      if (entity === "npc") {
        const npcDocument = document as { locationId?: string };
        placeId = npcDocument.locationId || undefined;
        npcDocument.locationId = "";
      }

      const { sameName } = options;
      // Asked unless the player already answered (T163).
      const createOptions: CreateOptions = {
        askOnSameName: !sameName,
        ...(options.private ? { private: true } : {}),
      };

      /** The write, with a change to commit alongside it when there is one. */
      const create = (alongside?: CreateAlongside): Promise<string> => {
        // Added to the record of the same name: the note's mark points there.
        if (sameName && "merge" in sameName) {
          return mergeIntoRecord(entity, sameName.merge, document as object, alongside);
        }
        switch (entity) {
          case "npc":
            return addNPC(document as Parameters<typeof addNPC>[0], alongside, createOptions);
          case "quest":
            return addQuest(document as Parameters<typeof addQuest>[0], alongside, createOptions);
          case "location":
            return createLocation(document as Parameters<typeof createLocation>[0], alongside, createOptions);
        }
      };

      // Opened from a note: the record and the note's mark commit together
      // (T088). Created first and marked after, a failed mark left the record
      // behind while the note still offered to convert it again.
      const id = options.noteId && options.entityId
        ? await convertInto(options.noteId, options.entityId, create)
        : await create();

      if (placeId) {
        const place = placeId;
        const sharedPlace = !locations.some((location) => location.id === place && location.isPrivate);
        if (options.private && sharedPlace) {
          // A private person in a shared place: the place must not name them,
          // so the link is held until they are published (T163).
          await linkPrivacy.hold({ kind: "npc", id }, { kind: "location", id: place });
        } else {
          await updateLocation(place, (current) => ({
            connectedNPCs: Array.from(new Set([...(current.connectedNPCs ?? []), id])),
          }));
        }
      }
      return id;
    },
    [addNPC, addQuest, createLocation, updateLocation, convertInto, mergeIntoRecord, linkPrivacy, npcs, locations]
  );
}

/**
 * What "Add what you know to it" would write, for the dialog to list before
 * anything is (T163): worked out from the record as this client holds it,
 * or `null` while that record has not reached it.
 *
 * Reads the lists `useQuickAddCreate` opened; it opens none of its own.
 */
export function useQuickAddMergePreview(entity: QuickAddEntity) {
  const { npcs } = useNPCs({ subscribe: false });
  const { quests } = useQuests({ subscribe: false });
  const { locations } = useLocations({ subscribe: false });

  return useCallback(
    (existingId: string, values: QuickAddValues, carry?: QuickAddCarry): string[] | null => {
      const list: ReadonlyArray<{ id: string }> =
        (entity === "npc" ? npcs : entity === "quest" ? quests : locations) ?? [];
      const existing = list.find((record) => record.id === existingId);
      if (!existing) return null;
      const incoming = QUICK_ADD_SPECS[entity].buildDocument(values, carry);
      return describeMerge(planMerge(entity, existing, incoming as object));
    },
    [entity, npcs, quests, locations]
  );
}

export default useQuickAddCreate;
