// src/features/campaign-entities/shared/sameName.ts
import firebaseServices from 'core/services/firebase';
import { normalizeTextForComparison } from 'core/utils/text-comparison';

/**
 * "Already exists" (T163): a person, place, quest or rumour created under a
 * name one already carries is stopped and offered instead, so the player can
 * open it, add what they know to it, or choose another name. Until then a
 * second "Grog" was created without a word as `grog-2`.
 *
 * Names are the same when `normalizeTextForComparison` makes them so: case,
 * punctuation and a leading article are ignored ("The Grog", "grog."). An
 * empty name matches nothing: a rumour started from the list has no title.
 */

/** The four kinds of record a name can collide in. */
export type SameNameKind = 'npc' | 'location' | 'quest' | 'rumor';

/** The field that holds a record's name. */
export const NAME_FIELD: Record<SameNameKind, 'name' | 'title'> = {
  npc: 'name',
  location: 'name',
  quest: 'title',
  rumor: 'title',
};

/** The record of its kind that already carries a name. */
export class SameNameError extends Error {
  /**
   * @param kind What kind of record it is
   * @param existingId The record that carries the name
   * @param existingName Its name, as it is stored
   */
  constructor(
    readonly kind: SameNameKind,
    readonly existingId: string,
    readonly existingName: string
  ) {
    super(`A record named ${existingName} already exists.`);
    this.name = 'SameNameError';
  }
}

/** Whether two names are the same name, as the check reads them. */
export function isSameName(a: string | undefined | null, b: string | undefined | null): boolean {
  const left = normalizeTextForComparison(a ?? '');
  return left !== '' && left === normalizeTextForComparison(b ?? '');
}

/** The name a record carries, by its kind's field. */
export function nameOf(kind: SameNameKind, record: object): string {
  const value = (record as Record<string, unknown>)[NAME_FIELD[kind]];
  return typeof value === 'string' ? value : '';
}

/**
 * The first record in `records` carrying `name`, if any.
 *
 * @param kind What kind they are
 * @param name The name about to be created
 * @param records The records the client holds
 * @param except Records to leave out (a combine's own sources stay eligible)
 */
export function findSameNamed<T extends { id: string }>(
  kind: SameNameKind,
  name: string,
  records: readonly T[],
  except: readonly string[] = []
): T | undefined {
  return records.find((record) => !except.includes(record.id) && isSameName(nameOf(kind, record), name));
}

/**
 * Refuse with a {@link SameNameError} when a record the client holds already
 * carries the name.
 */
export function assertNoSameNamed<T extends { id: string }>(
  kind: SameNameKind,
  name: string,
  records: readonly T[]
): void {
  const existing = findSameNamed(kind, name, records);
  if (existing) throw new SameNameError(kind, existing.id, nameOf(kind, existing));
}

/**
 * For `createWithUniqueEntityId`'s `onRefused`: the write was refused because
 * the id was taken, by a record the client has not seen yet. Read it, and stop
 * with a {@link SameNameError} when it carries the same name -- created a
 * moment ago by someone else. A record that only shares the slug (renamed
 * since, or a name that slugs alike) lets the next id be tried, as before.
 *
 * @param kind What kind of record is being created
 * @param collectionPath Its collection's full path
 * @param name The name being created
 */
export function stopOnSameNamed(kind: SameNameKind, collectionPath: string, name: string) {
  return async (id: string): Promise<void> => {
    const taken = await firebaseServices.document.getDocument<Record<string, unknown>>(collectionPath, id);
    if (taken && isSameName(nameOf(kind, taken), name)) {
      throw new SameNameError(kind, id, nameOf(kind, taken));
    }
  };
}
