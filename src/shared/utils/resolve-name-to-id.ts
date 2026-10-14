// src/shared/utils/resolve-name-to-id.ts

/**
 * The shape this needs of a record: an id, and the name a reader would use.
 *
 * Deliberately structural rather than a union of `NPC | Location`. The matching
 * rule has nothing to do with either domain, and naming them here would make a
 * `shared/` utility depend on two features to do string comparison.
 */
export interface NamedRecord {
  id: string;
  name: string;
}

/**
 * Turn a name the extractor produced into an id the product can store.
 *
 * The extraction model has never seen the NPC directory or the location tree,
 * so everything relational it returns is prose: `parentLocation` is "The
 * Ashen Vale", and a quest's people are names. Those were written straight into
 * id-shaped fields — `Location.parentId`, `Quest.relatedNPCIds` — where every
 * consumer looked them up and found nothing, and where a dangling `parentId`
 * additionally filed the new place under "Unplaced".
 *
 * **A single exact match wins; anything else returns an empty string.** Both
 * failure modes — no match, and more than one — fail closed, because a wrong
 * link is worse than an absent one. An absent link is visible and one action
 * to fix; a wrong one silently asserts a connection the session never made.
 * Creating a record for an unmatched name was considered and rejected: one
 * misspelling would become a permanent duplicate place.
 *
 * Matching is trimmed and case-insensitive, because a model varies both
 * freely, but never partial — "Vale" must not match "The Ashen Vale", or a name
 * would link to whichever record happened to contain the word.
 */
export const resolveNameToId = (
  name: unknown,
  records: readonly NamedRecord[]
): string => {
  if (typeof name !== 'string') return '';

  const needle = name.trim().toLowerCase();
  if (!needle) return '';
  if (!Array.isArray(records)) return '';

  const matches = records.filter(
    (record) =>
      typeof record?.name === 'string' &&
      record.name.trim().toLowerCase() === needle
  );

  // Exactly one, or nothing. Two records answering to the same name is a
  // question for the reader, not something to resolve by picking the first.
  if (matches.length !== 1) return '';
  return typeof matches[0].id === 'string' ? matches[0].id : '';
};

/**
 * The same rule over a list, keeping only what resolved.
 *
 * Unresolved names are **dropped, not carried through**. Keeping them was the
 * defect: `relatedNPCIds` held names verbatim, so a quest's people list was
 * full of entries that resolved to nothing and rendered as "Someone no longer
 * in the directory".
 *
 * Duplicates are collapsed — two spellings of one name are one relationship.
 */
export const resolveNamesToIds = (
  names: unknown,
  records: readonly NamedRecord[]
): string[] => {
  if (!Array.isArray(names)) return [];

  const ids = names
    .map((name) => resolveNameToId(name, records))
    .filter((id): id is string => Boolean(id));

  return Array.from(new Set(ids));
};
