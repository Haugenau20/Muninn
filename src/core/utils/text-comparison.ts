// src/core/utils/text-comparison.ts

/**
 * Normalize text for consistent comparison: lower case, a leading article
 * dropped, and every run of punctuation and space one dash.
 *
 * "The Grog", "grog" and "Grog." all come out `grog`. The notes' reference
 * finder and links panel compare entity names with it, and since T163 the
 * check for a record that already exists under a name does too, so the two
 * agree on what "the same name" means.
 *
 * @param text The name or title to normalise
 */
export const normalizeTextForComparison = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '') // Remove leading articles
    .replace(/[.,!?;:\s]+/g, '-') // Replace punctuation and spaces with dashes
    .replace(/^-+|-+$/g, '') // Remove leading/trailing dashes
    .trim();
};
