// src/features/user-management/auth/utils/next-label.ts

/**
 * The top-level sections a `next` path can name, in the words the navigation
 * uses for them.
 *
 * A closed list on purpose. The alternative -- prettifying whatever segment is
 * in the URL -- turns `/npcs/odile-marrow` into "Npcs Odile Marrow", and an id into
 * something that looks like a name but is not one.
 */
const SECTION_LABELS: Record<string, string> = {
  story: 'the story',
  quests: 'Quests',
  npcs: 'NPCs',
  locations: 'Locations',
  rumors: 'Rumours',
  notes: 'Notes',
  profile: 'your profile',
  admin: 'group administration',
  contact: 'the contact page',
  privacy: 'the privacy policy',
};

/**
 * Name the place a validated `next` path leads to, for the sign-in band.
 *
 * Returns `null` when the destination cannot be named, and the caller omits
 * the line rather than printing a path. "You were heading to
 * /locations/edit/cinderford" is worse than saying nothing: it shows the reader
 * a URL they did not type and cannot act on.
 *
 * @param next A path already validated by `safeNextPath`
 * @returns A human label, or `null`
 */
export function nextLabel(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/')) return null;

  const [firstSegment] = next.slice(1).split(/[/?#]/);
  if (!firstSegment) return null;

  return SECTION_LABELS[firstSegment.toLowerCase()] ?? null;
}

export default nextLabel;
