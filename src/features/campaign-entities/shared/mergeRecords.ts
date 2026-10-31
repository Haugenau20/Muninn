// src/features/campaign-entities/shared/mergeRecords.ts
import { TEXT_LIMITS } from 'core/constants/textLimits';
import { toNoteDate } from 'shared/utils/dateFormatter';
import type { SameNameKind } from './sameName';

/**
 * "Add what you know to it" (T163): what a player was about to create, added
 * to the record of the same name that turned out to exist.
 *
 * Nothing the existing record holds is overwritten. A field it leaves empty
 * is filled, a list (links, affiliations, objectives) gains what it lacks,
 * and a field both fill differently goes into a note under it, signed by the
 * writer. The same plan is worked out twice: from the client's copy, for the
 * dialog to say what will be added, and inside the transaction from the copy
 * the server holds, for what is written.
 */

type Fields = Record<string, unknown>;

/** A field of free text: filled when empty, else noted when it differs. */
interface TextRule {
  field: string;
  label: string;
}

/**
 * A field with a value from a set: filled when the record has none, noted
 * when both say something different. `defaults` are what a create writes
 * when nobody chose (quick add's "alive", "active", "known"): an incoming
 * default says nothing and is left out.
 */
interface ChoiceRule {
  field: string;
  label: string;
  defaults?: readonly string[];
  /** What the note says for the incoming value, when not the value itself. */
  shown?: (incoming: Fields) => string;
}

/** A list: the record gains the entries it lacks. */
interface ListRule {
  /** The field, or `[map, field]` for a list inside a map (`connections`). */
  path: readonly [string] | readonly [string, string];
  label: string;
  /** Whether entries are ids, shown as a count rather than by value. */
  ids?: boolean;
  /** What makes two entries the same; the value itself by default. */
  key?: (entry: unknown) => string;
  /** How an entry reads in the dialog. */
  show?: (entry: unknown) => string;
}

interface KindRules {
  text: readonly TextRule[];
  choice: readonly ChoiceRule[];
  lists: readonly ListRule[];
}

const textKey = (value: unknown): string =>
  (typeof value === 'string' ? value : String(value ?? '')).trim().toLowerCase().replace(/\s+/g, ' ');

const RULES: Record<SameNameKind, KindRules> = {
  npc: {
    text: [
      { field: 'title', label: 'Title' },
      { field: 'race', label: 'Race' },
      { field: 'occupation', label: 'Occupation' },
      { field: 'location', label: 'Where' },
      { field: 'description', label: 'Description' },
      { field: 'appearance', label: 'Appearance' },
      { field: 'personality', label: 'Personality' },
      { field: 'background', label: 'Background' },
    ],
    choice: [
      { field: 'status', label: 'Status', defaults: ['alive', 'unknown'] },
      { field: 'relationship', label: 'Stance', defaults: ['unknown'] },
    ],
    lists: [
      { path: ['connections', 'relatedNPCs'], label: 'people they know', ids: true },
      { path: ['connections', 'affiliations'], label: 'Affiliations', key: textKey },
      { path: ['tags'], label: 'Tags', key: textKey },
    ],
  },
  location: {
    text: [{ field: 'description', label: 'Description' }],
    choice: [
      { field: 'type', label: 'Type', defaults: ['poi'] },
      { field: 'status', label: 'Status', defaults: ['known'] },
    ],
    lists: [
      { path: ['features'], label: 'Features', key: textKey },
      { path: ['connectedNPCs'], label: 'people here', ids: true },
      { path: ['tags'], label: 'Tags', key: textKey },
    ],
  },
  quest: {
    text: [
      { field: 'description', label: 'Description' },
      { field: 'background', label: 'Background' },
      { field: 'levelRange', label: 'Level range' },
      { field: 'location', label: 'Where' },
    ],
    choice: [
      { field: 'status', label: 'Status', defaults: ['active'] },
      { field: 'locationId', label: 'Place', shown: (incoming) => String(incoming.location || incoming.locationId) },
    ],
    lists: [
      {
        path: ['objectives'],
        label: 'Objectives',
        key: (entry) => textKey((entry as { description?: string })?.description),
        show: (entry) => String((entry as { description?: string })?.description ?? ''),
      },
      { path: ['leads'], label: 'Leads', key: textKey },
      {
        path: ['keyLocations'],
        label: 'Places inside it',
        key: (entry) => textKey((entry as { name?: string })?.name),
        show: (entry) => String((entry as { name?: string })?.name ?? ''),
      },
      { path: ['relatedNPCIds'], label: 'people', ids: true },
      { path: ['complications'], label: 'Complications', key: textKey },
      { path: ['rewards'], label: 'Rewards', key: textKey },
    ],
  },
  rumor: {
    text: [
      { field: 'content', label: 'What was said' },
      { field: 'sourceName', label: 'Heard from' },
      { field: 'location', label: 'Where' },
    ],
    choice: [
      { field: 'status', label: 'Status', defaults: ['unconfirmed'] },
      { field: 'sourceType', label: 'Kind of source' },
      { field: 'sourceNpcId', label: 'Source', shown: (incoming) => String(incoming.sourceName || incoming.sourceNpcId) },
      { field: 'locationId', label: 'Heard at', shown: (incoming) => String(incoming.location || incoming.locationId) },
    ],
    lists: [
      { path: ['relatedNPCs'], label: 'people', ids: true },
      { path: ['relatedLocations'], label: 'places', ids: true },
    ],
  },
};

/** What one merge writes, and what the dialog says about it. */
export interface MergePlan {
  /** The fields written to the existing record: only what it lacked. */
  fields: Fields;
  /** One line per thing added, for the dialog. */
  added: string[];
  /** What both say differently: the incoming value, kept in a note. */
  differing: Array<{ label: string; value: string }>;
}

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

const readList = (record: Fields, path: ListRule['path']): unknown[] => {
  const value = path.length === 1
    ? record[path[0]]
    : (record[path[0]] as Fields | undefined)?.[path[1]];
  return Array.isArray(value) ? value : [];
};

/**
 * Work out what `incoming` adds to `existing`, a record of the same kind.
 *
 * @param kind What kind they are
 * @param existing The record that carries the name, as read
 * @param incoming What the player was about to create
 */
export function planMerge(kind: SameNameKind, existing: object, incoming: object): MergePlan {
  const have = existing as Fields;
  const add = incoming as Fields;
  const rules = RULES[kind];
  const plan: MergePlan = { fields: {}, added: [], differing: [] };

  for (const { field, label } of rules.text) {
    const value = add[field];
    if (isEmpty(value)) continue;
    const text = String(value).trim();
    if (isEmpty(have[field])) {
      plan.fields[field] = text;
      plan.added.push(`${label}: ${text}`);
    } else if (textKey(have[field]) !== textKey(text)) {
      plan.differing.push({ label, value: text });
    }
  }

  for (const { field, label, defaults = [], shown } of rules.choice) {
    const value = add[field];
    if (isEmpty(value) || defaults.includes(String(value))) continue;
    const current = have[field];
    const shownValue = shown ? shown(add) : String(value);
    if (isEmpty(current) || defaults.includes(String(current))) {
      plan.fields[field] = value;
      plan.added.push(`${label}: ${shownValue}`);
    } else if (current !== value) {
      plan.differing.push({ label, value: shownValue });
    }
  }

  for (const rule of rules.lists) {
    const key = rule.key ?? ((entry: unknown) => String(entry));
    const current = readList(have, rule.path);
    const known = new Set(current.map(key));
    const extra: unknown[] = [];
    for (const entry of readList(add, rule.path)) {
      const entryKey = key(entry);
      if (!entryKey || known.has(entryKey)) continue;
      known.add(entryKey);
      extra.push(entry);
    }
    if (extra.length === 0) continue;

    const joined = [...current, ...extra];
    if (rule.path.length === 1) {
      plan.fields[rule.path[0]] = joined;
    } else {
      const [map, field] = rule.path;
      // The whole map, built on the copy read, so a second list in it keeps
      // what this one did not touch.
      const base = (plan.fields[map] ?? have[map] ?? {}) as Fields;
      plan.fields[map] = { ...base, [field]: joined };
    }
    plan.added.push(
      rule.ids
        ? `${extra.length} more ${rule.label}`
        : `${rule.label}: ${extra.map(rule.show ?? String).join(', ')}`
    );
  }

  return plan;
}

/**
 * The note that keeps what differed, or null when nothing did.
 *
 * @param kind The record's kind: a rumour's note is `content`, the others' `text`
 * @param name The name the player was creating it under
 * @param differing What both said differently
 * @param author Who it is from: the acting character, or their username
 */
export function mergeNote(
  kind: SameNameKind,
  name: string,
  differing: MergePlan['differing'],
  author?: string
): Record<string, unknown> | null {
  if (differing.length === 0) return null;
  const text = [
    `Also recorded as “${name.trim()}”:`,
    ...differing.map(({ label, value }) => `${label}: ${value}`),
  ]
    .join('\n')
    // A note holds what one note may (T119); the record keeps its own text.
    .slice(0, TEXT_LIMITS.text);
  if (kind === 'rumor') return { content: text };
  return { date: toNoteDate(), text, ...(author ? { author } : {}) };
}

/** What the dialog lists before anything is written. */
export function describeMerge(plan: MergePlan): string[] {
  return [
    ...plan.added,
    ...(plan.differing.length
      ? [`A note with what it says differently: ${plan.differing.map(({ label }) => label.toLowerCase()).join(', ')}`]
      : []),
  ];
}
