// src/core/utils/entity-sigil.ts
// Deterministic identity marks for campaign entities.
//
// The same NPC or location should look like itself everywhere it appears --
// lists, activity, quests, notes -- so a mark is derived from the entity's id
// rather than stored. That costs one function and a palette instead of any art,
// and it is what makes a long list scannable rather than uniform.

/**
 * How many distinct hues a mark can take.
 *
 * Deliberately a constant rather than `palette.length`. If the index were
 * `hash % palette.length`, appending a ninth hue would renumber every entity in
 * the campaign at once -- every mark in the product would change colour on
 * deploy. With a fixed count, appending an entry is inert until this constant is
 * raised, which makes growing the palette a visible decision instead of a
 * side effect. Reordering the palette still changes existing marks; that is the
 * documented trade and why order is part of the contract.
 *
 * Themes must define at least this many palette entries.
 */
export const SIGIL_BUCKET_COUNT = 8;

/**
 * FNV-1a, 32-bit.
 *
 * Chosen because it is fully specified, dependency-free and identical in every
 * JavaScript engine, which is what "the same entity produces the same mark
 * everywhere, across reloads" actually requires. `String.prototype.hashCode`
 * does not exist, and anything seeded or locale-dependent would drift between
 * a user's devices.
 */
const fnv1a = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // Multiply by the 32-bit FNV prime (16777619) using shifts, so the result
    // stays within the range Math.imul-free arithmetic handles predictably.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to unsigned so the modulo below never sees a negative.
  return hash >>> 0;
};

/**
 * The palette index for an entity id. Stable for a given id, forever.
 *
 * @param entityId - The entity's document id (a slug, e.g. `odile-marrow`).
 * @returns An integer in `[0, SIGIL_BUCKET_COUNT)`.
 */
export const sigilIndexFor = (entityId: string): number =>
  fnv1a(entityId) % SIGIL_BUCKET_COUNT;

/**
 * A stable pick among `count` things for an id, by the same hash as the
 * sigils: the same id gets the same index on every device, forever, as long
 * as `count` does not change.
 *
 * @param id - Any document id.
 * @param count - How many things there are to pick from; at least 1.
 * @returns An integer in `[0, count)`.
 */
export const stableIndexFor = (id: string, count: number): number => fnv1a(id) % count;

/**
 * The letter shown inside the mark.
 *
 * Taken from the display name rather than the id, because the id is a slug and
 * may have been disambiguated with a numeric suffix on collision -- the reader
 * should see the name's initial, not the slug's.
 *
 * Falls back to a neutral glyph when a name has no letter or digit at all, so
 * the mark never renders empty.
 *
 * @param displayName - The entity's name or title.
 * @returns A single uppercase character.
 */
export const sigilInitialFor = (displayName: string): string => {
  const match = (displayName ?? "").match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : "·";
};

/** The CSS variable holding the hue for a given index. */
export const sigilVariableFor = (index: number): string =>
  `--entity-palette-${index}`;
