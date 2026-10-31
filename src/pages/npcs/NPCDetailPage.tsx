// src/pages/npcs/NPCDetailPage.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TEXT_LIMITS } from 'core/constants/textLimits';
import { useParams } from 'react-router-dom';
import Typography from 'core/components/Typography';
import Button from 'core/components/Button';
import EntitySigil from 'core/components/EntitySigil';
import {
  useNPCs,
  useQuests,
  useRumors,
  useLocations,
  createLinkActions,
  useLinkPrivacy,
  useRecordNotesPath,
  locationIdsOfNpc,
  resolveLocationName,
  npcIdsOfNpc,
  questIdsOfNpc,
  rumorIdsOfNpc,
  useRecordNotes,
  editRecordNote,
  deleteRecordNote,
} from 'features/campaign-entities';
import type { StoredNote } from 'features/campaign-entities';
import type { NPC, NPCNote, NPCRelationship, NPCStatus } from 'features/campaign-entities';
import type { RecordChange } from 'core/types/common';
import { useUser, useGroups, useCampaigns } from 'features/user-management';
import AttributionInfo from 'shared/components/AttributionInfo';
import { useImageAttachment } from 'shared/hooks/useImageAttachment';
import { entityImagePrefix } from 'core/services/firebase/storage/ImageStorageService';
import { toNoteDate } from 'shared/utils/dateFormatter';
import Breadcrumb from 'shared/components/Breadcrumb';
import DeleteConfirmationDialog from 'shared/components/DeleteConfirmationDialog';
import { usePageGate, GatedContent } from 'shared/components/gated';
import { useNavigation } from 'shared/context/NavigationContext';
import { getUserName, getActiveCharacterName } from 'core/utils/user-utils';
import { InlineEditor } from 'shared/components/inline-edit';
import { editedText } from 'shared/utils/edit-conflict';
import {
  EntityFact,
  EntityNotes,
  EntityPageSection,
  EntityPageShell,
  EntityProse,
  FieldLabel,
  FieldPrompt,
} from 'shared/components/entity-page';
import AttachTray from 'shared/components/attach-tray/AttachTray';
import PrivateNotice from 'shared/components/private/PrivateNotice';
import { attachRefs, type AttachKind } from 'shared/components/attach-tray/attachCandidates';
import StateLadder from 'shared/components/row-controls/StateLadder';
import { Pencil, X } from 'lucide-react';
import { rumorTitleText } from 'features/campaign-entities';

/** Sentence-cases one of the short enum values the type stores lowercase. */
/**
 * NPC presence, which carries no hue.
 *
 * Alive was green and deceased was red, which reads a death as an error. It is
 * a fact about the world with no valence, so alive is plain ink and deceased
 * is muted ink; only genuine uncertainty takes a hue. Schema section 3.
 *
 * Written out rather than interpolated into `npc-status-${status}`. The old
 * form was a class name assembled from a variable, which no compiler and no
 * grep can see -- the token it referenced could have been deleted underneath
 * it and nothing would have failed until someone looked at the page.
 */
const PRESENCE_CLASS: Record<string, string> = {
  alive: 'valence-0',
  unknown: 'valence-1',
  missing: 'valence-2',
  deceased: 'valence-3',
};

/**
 * Disposition *is* valenced, and that is not a contradiction: presence is a
 * fact about the world, while an NPC's stance toward the party has valence
 * from the only point of view the record keeps.
 */
const DISPOSITION_CLASS: Record<string, string> = {
  friendly: 'disposition-friendly',
  neutral: 'disposition-neutral',
  hostile: 'disposition-hostile',
  unknown: 'disposition-unknown',
};

const capitalise = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

/**
 * The two ladders the header strip opens, best to worst -- the same order the
 * class maps above rank them in, so the control and the colour agree.
 *
 * Neither option carries a class name. `15-4` removed `StateLadder`'s
 * `selectedClassName` prop: the selected chip says "this is the current one",
 * and the state's own hue belongs to the *word*, which is what the strip
 * renders when the ladder is closed.
 */
const PRESENCE_OPTIONS: Array<{ value: NPCStatus; label: string }> = [
  { value: 'alive', label: 'Alive' },
  { value: 'unknown', label: 'Unknown' },
  { value: 'missing', label: 'Missing' },
  { value: 'deceased', label: 'Deceased' },
];

const STANCE_OPTIONS: Array<{ value: NPCRelationship; label: string }> = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'hostile', label: 'Hostile' },
  { value: 'unknown', label: 'Unknown' },
];

/**
 * Everything on this page that can be opened for editing.
 *
 * `tag` is not one of them: the tag control adds a value rather than editing
 * one, so *Edit all fields* leaves it closed -- opening a blank composer is not
 * editing anything.
 */
type EditableField =
  | 'name'
  | 'title'
  | 'description'
  | 'appearance'
  | 'personality'
  | 'background'
  | 'status'
  | 'relationship'
  | 'occupation'
  | 'race';

const EVERY_FIELD: EditableField[] = [
  'name',
  'title',
  'description',
  'appearance',
  'personality',
  'background',
  'status',
  'relationship',
  'occupation',
  'race',
];

/**
 * The three prose blocks, and the question each asks when it is empty.
 *
 * §10: prompts are **questions, not labels**. An NPC nobody has written up yet
 * must look new rather than broken (design language §8, §12.7) -- and this page
 * used to drop the whole card when all three were empty, so the fields were
 * not merely blank, they were invisible.
 */
const PROSE_BLOCKS: {
  field: Extract<EditableField, 'appearance' | 'personality' | 'background'>;
  label: string;
  prompt: string;
  helper: string;
}[] = [
  {
    field: 'appearance',
    label: 'Appearance',
    prompt: 'What do they look like?',
    helper: 'What the party would notice on meeting them.',
  },
  {
    field: 'personality',
    label: 'Personality',
    prompt: 'How do they treat the party?',
    helper: 'How they behave, and what they want.',
  },
  {
    field: 'background',
    label: 'Background',
    prompt: 'Where do they come from?',
    helper: 'What happened before the party met them.',
  },
];


/** The kinds of thing an NPC can be connected to, in the order they are shown. */
/** An NPC with no `connections` stored yet. */
const NO_CONNECTIONS = { relatedNPCs: [], affiliations: [] };

const RELATION_GROUPS = [
  { kind: 'people', label: 'People' },
  { kind: 'places', label: 'Places' },
  { kind: 'affiliations', label: 'Affiliations' },
  { kind: 'quests', label: 'Quests' },
  { kind: 'rumors', label: 'Rumours' },
] as const;

type RelationKind = (typeof RELATION_GROUPS)[number]['kind'];

interface Relation {
  key: string;
  id: string;
  name: string;
  kind: RelationKind;
  /**
   * What this row adds beyond its heading -- an associate's title, a quest's
   * status. Absent where the heading has already said everything: an
   * affiliation under "Affiliations" does not also need "Claims membership",
   * which is the type stated twice.
   */
  detail?: string;
  /** Empty when there is nowhere to go, as for a free-text affiliation. */
  href: string;
}

/**
 * The designed not-found. A bad id is an ordinary event -- a stale bookmark, a
 * deleted NPC, a link shared after the fact -- so it gets a designed state and
 * a way onward rather than a blank page.
 */
const NPCNotFound: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <div className="card rounded-lg p-10 flex flex-col items-center text-center gap-3">
    <Typography variant="h3">No NPC with that id</Typography>
    <Typography color="secondary" className="max-w-md">
      It may have been deleted, or the link may point at a different campaign.
    </Typography>
    <Button variant="outline" onClick={onBack} className="mt-2">
      Back to NPCs
    </Button>
  </div>
);

/**
 * One NPC, in full.
 *
 * The page exists because six fields were write-only: `appearance`,
 * `personality`, `background` and all three `connections.*` arrays are
 * collected by both forms, written to Firestore, and were rendered nowhere
 * (D61). Nothing here is missing from the directory row, and nothing left the
 * row to get here -- what the page adds is the whole note history rather than a
 * truncated one, every relationship in a single list, and somewhere to write.
 *
 * Laid out as a stack of cards beside a sidebar rather than one slab of
 * labelled values. Each card is one kind of thing, so a reader can skip a whole
 * section at a glance; the first cut put every field in one card and read as a
 * form rather than as a record (D65).
 */
const NPCDetailPage: React.FC = () => {
  const { npcId } = useParams<{ npcId: string }>();
  const { navigateToPage } = useNavigation();
  // Reads the provider this page writes through, rather than a second loader
  // of its own. Two independently fetched copies meant a write updated one
  // and the page rendered the other (T046).
  const { npcs, isLoading, loadError, refreshNPCs, updateNPC, updateNPCNote, deleteNPC } = useNPCs();
  const { getQuestById, quests, updateQuest } = useQuests();
  const { rumors, updateRumor } = useRumors();
  const { locations, updateLocation } = useLocations();
  const { activeGroupUserProfile } = useUser();
  const { activeGroupId } = useGroups();
  const { activeCampaignId } = useCampaigns();

  const npc = npcs.find((candidate) => candidate.id === npcId);

  // The notes: their own documents (T133), where the person lives (T163).
  const npcsPath = useRecordNotesPath('npc', npc?.id);
  const linkPrivacy = useLinkPrivacy();
  const notes = useRecordNotes<NPCNote>(npcsPath, npc?.id);

  // `loading` folds into the gate's resolving state: `npcs` is empty while auth
  // and the campaign restore, and without this the page would claim "no NPC
  // with that id" for the found-but-not-yet-loaded case.
  const gate = usePageGate('npcs', {
    /*
      The data hook now draws the line between "nothing to show yet" and "a
      fetch is in flight" for every consumer at once -- the rule, and the
      measurement behind it, are on `useQuestData`. What this adds is the
      narrower question a detail page asks: not "is the list loaded" but "is
      *this* record loaded", so the page never claims "no such record" for
      one that is simply still on its way.
    */
    loading: isLoading && !npc,
    error: loadError,
    onRetry: () => {
      void refreshNPCs();
    },
  });

  /**
   * Which editors are open.
   *
   * A set rather than one field, because this page has two ways in. A section's
   * own control opens **one** editor and closes any other (§7: one field open
   * at a time, which is this file's own behaviour generalised). *Edit all
   * fields* opens all of them at once, which is the "change five things"
   * case the edit route used to serve -- it now serves it here, and navigates
   * nowhere.
   */
  const [editing, setEditing] = useState<ReadonlySet<EditableField>>(new Set());
  const [editingTag, setEditingTag] = useState(false);
  const [editingAffiliation, setEditingAffiliation] = useState(false);
  const [savedField, setSavedField] = useState<EditableField | null>(
    null
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [returnFocus, setReturnFocus] = useState<EditableField | null>(null);
  const triggers = useRef<Partial<Record<EditableField, HTMLButtonElement | null>>>({});

  const isEditing = (field: EditableField) => editing.has(field);
  const openOnly = (field: EditableField) => setEditing(new Set([field]));
  const closeField = (field: EditableField) =>
    setEditing((open) => {
      const next = new Set(open);
      next.delete(field);
      return next;
    });

  // The value changing on screen is the real confirmation; this is the word
  // that goes with it, for anyone who cannot see the change happen.
  useEffect(() => {
    if (!savedField) {
      return;
    }
    const timer = setTimeout(() => setSavedField(null), 4000);
    return () => clearTimeout(timer);
  }, [savedField]);

  // The trigger is unmounted while the editor is open, so focus can only be
  // returned once the commit has put it back in the document. Keyed by field
  // now that every block has one of these.
  useEffect(() => {
    if (!returnFocus) {
      return;
    }
    triggers.current[returnFocus]?.focus();
    setReturnFocus(null);
  }, [returnFocus]);

  /**
   * The places this person is linked to (T131): the places that list them,
   * and the old `locationId` until the migration has run. A person may be
   * in several. Each resolves to a record here, and one that does not is
   * left out, as every link list here drops a dangling id.
   */
  const places = useMemo(
    () =>
      npc
        ? locationIdsOfNpc(npc, locations)
            .map((id) => locations.find((location) => location.id === id))
            .filter((place): place is NonNullable<typeof place> => Boolean(place))
        : [],
    [npc, locations]
  );

  /**
   * The place the subtitle and breadcrumb name: the first linked one, or --
   * for a person with none -- the free text `location`, shown as written.
   */
  const locationName = places[0]?.name ?? (npc
    ? resolveLocationName({ location: npc.location, locationId: npc.locationId }, locations)
    : undefined);

  const locationHref = `/locations?highlight=${encodeURIComponent(
    places[0]?.id || npc?.location || ''
  )}`;

  /** Adds and removes links, each in the field that owns it (T131). */
  const links = createLinkActions({
    npcs,
    quests,
    locations,
    updateNPC,
    updateQuest,
    updateLocation,
    updateRumor,
    // A private record's link to a shared one is held, not written (T163).
    privacy: linkPrivacy,
  });

  /**
   * Every link this NPC has, grouped by what kind of thing it is.
   *
   * One flat list was the first cut and it did not survive contact with a
   * well-connected NPC: twelve rows of people, places, affiliations, quests and
   * rumors in a single column is a bowl, not an answer. The grouping is what
   * lets someone look for a person without reading past four quests.
   *
   * Grouping also removes a redundancy the flat list needed: each row used to
   * carry the reason it was listed, so every affiliation said "Claims
   * membership". Under a heading that says Affiliations, that is the type
   * stated twice. A row now carries only what its heading cannot say -- an
   * associate's title, a quest's status.
   */
  const relationships = useMemo<Relation[]>(() => {
    if (!npc) {
      return [];
    }
    const out: Relation[] = [];

    places.forEach((place) => {
      out.push({
        key: `location-${place.id}`,
        id: place.id,
        name: place.name,
        kind: 'places',
        href: `/locations/${place.id}`,
      });
    });
    // Free text names no record, but it is still where they were last seen.
    if (places.length === 0 && locationName) {
      out.push({
        key: `location-${locationName}`,
        id: npc.location || locationName,
        name: locationName,
        kind: 'places',
        detail: 'Last known location',
        href: locationHref,
      });
    }

    // Both ways: someone who lists this person is linked to them too.
    npcIdsOfNpc(npc, npcs).forEach((id) => {
      const other = npcs.find((candidate) => candidate.id === id);
      if (!other) {
        return;
      }
      out.push({
        key: `npc-${id}`,
        id,
        name: other.name,
        kind: 'people',
        // Their own title, when they have one. "Known associate" would only
        // repeat the heading.
        detail: other.title,
        href: `/npcs/${id}`,
      });
    });

    npc.connections?.affiliations?.forEach((affiliation) => {
      out.push({
        key: `affiliation-${affiliation}`,
        id: affiliation,
        name: affiliation,
        kind: 'affiliations',
        href: '',
      });
    });

    questIdsOfNpc(npc, quests).forEach((id) => {
      const quest = getQuestById(id);
      if (!quest) {
        return;
      }
      out.push({
        key: `quest-${id}`,
        id,
        name: quest.title,
        kind: 'quests',
        detail: capitalise(quest.status),
        href: `/quests/${id}`,
      });
    });

    (rumors ?? [])
      .filter((rumor) => rumor.relatedNPCs?.includes(npc.id))
      .forEach((rumor) => {
        out.push({
          key: `rumor-${rumor.id}`,
          id: rumor.id,
          name: rumorTitleText(rumor),
          kind: 'rumors',
          detail: capitalise(rumor.status),
          href: `/rumors?highlight=${rumor.id}`,
        });
      });

    return out;
  }, [npc, npcs, quests, places, locationName, locationHref, getQuestById, rumors]);

  /**
   * What the tray already has: this NPC's place, their people, their quests,
   * and every rumour that names them.
   *
   * Passed in full rather than left empty so the tray's own rows read
   * "Attached" instead of offering to attach someone who already is -- and so
   * that clicking one of them detaches, which is how a relation is removed
   * from this page at all.
   */
  const attached = useMemo(() => {
    if (!npc) return [];
    return [
      ...attachRefs('location', locationIdsOfNpc(npc, locations)),
      ...attachRefs('npc', npcIdsOfNpc(npc, npcs)),
      ...attachRefs('quest', questIdsOfNpc(npc, quests)),
      ...attachRefs('rumor', rumorIdsOfNpc(npc, rumors ?? [])),
    ];
  }, [npc, npcs, quests, locations, rumors]);

  /**
   * Nothing is patched locally after a write: the page shows the listener's
   * copy (T032), so it shows what was *written* rather than what was typed,
   * and another player's change to the same record arrives the same way.
   * Only what `change` names is written (T083): the copy may be behind the
   * server. A list worked out from the old one goes as a function, so it is
   * worked out from the record the server holds (`RecordChange`).
   */
  const save = async (change: RecordChange<NPC>) => {
    if (!npc) return;
    await updateNPC(npc.id, change);
  };

  /**
   * Change one of the NPC's `connections` lists, worked out from the record the
   * server holds (T083): attaching a quest keeps a person another player
   * attached a moment ago. `connections` is one stored map, so the other two
   * lists are written back from that same record.
   */
  const changeConnections = (
    list: keyof NonNullable<NPC['connections']>,
    next: (ids: string[]) => string[]
  ) =>
    save((current) => {
      const connections = current.connections ?? NO_CONNECTIONS;
      return { connections: { ...connections, [list]: next(connections[list] ?? []) } };
    });

  const portrait = useImageAttachment({
    prefix:
      npc && activeGroupId && activeCampaignId
        ? entityImagePrefix(activeGroupId, activeCampaignId, 'npcs', npc.id)
        : null,
    current: npc?.image,
    save: (image) => save({ image }),
  });

  /** Close one editor, credit the save in words, and take focus back. */
  const afterSave = (field: EditableField) => {
    closeField(field);
    setReturnFocus(field);
    setSavedField(field);
  };

  /**
   * Attach a relation from the rail (§5's tray, `15-2`).
   *
   * Each kind is stored somewhere different, and most of them not on this
   * record: a quest names its people, a place lists who is there, a rumour
   * names who it concerns. `createLinkActions` writes each to the field that
   * owns it (T131), so the link shows on both pages whichever one added it.
   */
  const attachRelation = async (id: string, kind: AttachKind) => {
    if (!npc) return;
    await links.link({ kind: 'npc', id: npc.id }, { kind, id });
  };

  /**
   * Remove one relation, found by its kind. Each collection allocates its own
   * slugs, so a place, a quest and a rumour may all be `watchtower`; searching
   * every field for the bare id removed whichever matched first (DATA-008).
   */
  const detachRelation = async (id: string, kind: AttachKind) => {
    if (!npc) return;
    await links.unlink({ kind: 'npc', id: npc.id }, { kind, id });
  };

  const addNote = async (text: string) => {
    if (!npc) return;
    // The acting character, or their username when they have no character --
    // the same actor `core/attribution` credits for the record itself.
    const author =
      getActiveCharacterName(activeGroupUserProfile) ||
      getUserName(activeGroupUserProfile) ||
      undefined;
    await updateNPCNote(npc.id, {
      date: toNoteDate(),
      text,
      ...(author ? { author } : {}),
    });
  };

  /**
   * A note is changed in its own document (T133); one another player changed
   * first is refused rather than overwritten (T083).
   */
  const editNote = async (note: StoredNote<NPCNote>, text: string) => {
    if (!npcsPath || !npc) return;
    await editRecordNote(npcsPath, npc.id, note.noteId, 'text', note.text, text);
  };
  const deleteNote = async (note: StoredNote<NPCNote>) => {
    if (!npcsPath || !npc) return;
    await deleteRecordNote(npcsPath, npc.id, note.noteId);
  };

  const handleDelete = async () => {
    if (!npc) return;
    await deleteNPC(npc.id);
    setConfirmingDelete(false);
    navigateToPage('/npcs');
  };

  const savedNotice = (field: EditableField) => (
    <span role="status" aria-live="polite">
      {savedField === field && (
        <Typography variant="body-sm" color="secondary">
          Saved
        </Typography>
      )}
    </span>
  );

  const subtitle = [npc?.title, locationName && `from ${locationName}`]
    .filter(Boolean)
    .join(' · ');

  const breadcrumb = [
    { label: 'NPCs', href: '/npcs' },
    ...(locationName ? [{ label: locationName, href: locationHref }] : []),
    { label: npc?.name ?? 'Not found' },
  ];

  const titleTrigger = (node: HTMLButtonElement | null) => {
    triggers.current.title = node;
  };
  /** A fact's opener, kept so focus can return to it once its editor closes. */
  const factTrigger = (field: EditableField) => (node: HTMLElement | null) => {
    triggers.current[field] = node as HTMLButtonElement | null;
  };

  return (
    <>
      {gate.state !== 'ready' || !npc ? (
        <div className="max-w-7xl mx-auto px-4 py-8">
          <Breadcrumb items={breadcrumb} className="mb-6" />
          {/* The page still says what it is in the states where the record
              cannot be loaded -- signed out, no campaign picked, still
              resolving. */}
          {gate.state !== 'ready' && (
            <Typography variant="h1" className="mb-8">
              NPC
            </Typography>
          )}
          <GatedContent gate={gate}>
            <NPCNotFound onBack={() => navigateToPage('/npcs')} />
          </GatedContent>
        </div>
      ) : (
        <EntityPageShell
          breadcrumb={breadcrumb}
          entityId={npc.id}
          name={npc.name}
          notice={npc.isPrivate ? <PrivateNotice /> : undefined}
          // A person is taller than they are wide, so the portrait stands
          // beside the name rather than spanning the page as a location's
          // picture does (T064). Without one the sigil is their picture.
          image={npc.image}
          imageAlt={`Portrait of ${npc.name}`}
          imageShape="tall"
          imageUpload={
            // No portrait on a private person yet: its file would be stored
            // where every member reads it (T163).
            gate.canAct && !npc.isPrivate
              ? { subject: 'portrait', onUpload: portrait.upload, onRemove: portrait.remove }
              : undefined
          }
          heading={
            isEditing('name') ? (
              <InlineEditor
                label="Name"
                rows={1}
                initialValue={npc.name}
                submitLabel="Save name"
                maxLength={TEXT_LIMITS.line}
                onSubmit={(value, openedWith) => save(editedText('name', value, openedWith))}
                onSaved={() => afterSave('name')}
                onCancel={() => {
                  closeField('name');
                  setReturnFocus('name');
                }}
              />
            ) : gate.canAct ? (
              // Click-to-edit rather than another control in the header: the
              // value itself is the target.
              <button
                type="button"
                ref={(node) => {
                  triggers.current.name = node;
                }}
                aria-label={`Edit the name ${npc.name}`}
                onClick={() => openOnly('name')}
                className="text-left rounded-md px-1 -mx-1 selectable-item"
              >
                <Typography variant="h1">{npc.name}</Typography>
              </button>
            ) : undefined
          }
          subtitle={
            isEditing('title') ? (
              <InlineEditor
                label="Title"
                helperText="What they are called — “Magistrate of Harrowgate”, “Wanted in three towns”."
                rows={1}
                initialValue={npc.title ?? ''}
                optional
                submitLabel="Save title"
                maxLength={TEXT_LIMITS.line}
                onSubmit={(value, openedWith) => save(editedText('title', value, openedWith))}
                onSaved={() => afterSave('title')}
                onCancel={() => {
                  closeField('title');
                  setReturnFocus('title');
                }}
              />
            ) : subtitle ? (
              gate.canAct ? (
                <button
                  type="button"
                  ref={titleTrigger}
                  aria-label="Edit the title"
                  onClick={() => openOnly('title')}
                  className="text-left rounded-md px-1 -mx-1 selectable-item"
                >
                  <Typography color="secondary">{subtitle}</Typography>
                </button>
              ) : (
                <Typography color="secondary" className="mt-0.5">
                  {subtitle}
                </Typography>
              )
            ) : (
              gate.canAct && (
                <FieldPrompt ref={titleTrigger} onClick={() => openOnly('title')}>
                  What are they called?
                </FieldPrompt>
              )
            )
          }
          actions={
            gate.canAct && (
              <>
                {/* Quiet: this page's accents are the controls that change
                    something -- Add note and Delete. Opening every editor is
                    not itself a write (D66). "Change five things at once" is a
                    real thing to want, so the button stays and does it here. */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(new Set(EVERY_FIELD))}
                  startIcon={<Pencil className="w-4 h-4" />}
                >
                  Edit all fields
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="delete-button"
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete
                </Button>
              </>
            )
          }
          facts={
            // Hue *and* word for status and disposition. The word carries the
            // fact on its own; the hue only agrees with it (design language §2).
            <>
              <EntityFact
                label="Status"
                editor={
                  isEditing('status') && (
                    <StateLadder
                      label="Status"
                      options={PRESENCE_OPTIONS}
                      value={npc.status}
                      ariaLabel={`Status of ${npc.name}`}
                      onChange={(status: NPCStatus) =>
                        save({ status }).then(() => afterSave('status'))
                      }
                    />
                  )
                }
                onEdit={gate.canAct ? () => openOnly('status') : undefined}
                triggerRef={factTrigger('status')}
              >
                <Typography
                  variant="body-sm"
                  className={`${PRESENCE_CLASS[npc.status] ?? 'valence-1'} font-medium`}
                >
                  {capitalise(npc.status)}
                </Typography>
              </EntityFact>

              <EntityFact
                label="Disposition"
                editor={
                  isEditing('relationship') && (
                    <StateLadder
                      label="Disposition"
                      options={STANCE_OPTIONS}
                      value={npc.relationship}
                      ariaLabel={`Disposition of ${npc.name}`}
                      onChange={(relationship: NPCRelationship) =>
                        save({ relationship }).then(() => afterSave('relationship'))
                      }
                    />
                  )
                }
                onEdit={gate.canAct ? () => openOnly('relationship') : undefined}
                triggerRef={factTrigger('relationship')}
              >
                <Typography
                  variant="body-sm"
                  className={DISPOSITION_CLASS[npc.relationship] ?? 'disposition-unknown'}
                >
                  {capitalise(npc.relationship)}
                </Typography>
              </EntityFact>

              <EntityFact
                label="Role"
                editor={
                  isEditing('occupation') && (
                    <InlineEditor
                      label="Role"
                      rows={1}
                      initialValue={npc.occupation ?? ''}
                      optional
                      submitLabel="Save role"
                      maxLength={TEXT_LIMITS.line}
                      placeholder="Wizard"
                      onSubmit={(value, openedWith) => save(editedText('occupation', value, openedWith))}
                      onSaved={() => afterSave('occupation')}
                      onCancel={() => {
                        closeField('occupation');
                        setReturnFocus('occupation');
                      }}
                    />
                  )
                }
                onEdit={gate.canAct ? () => openOnly('occupation') : undefined}
                triggerRef={factTrigger('occupation')}
                prompt="What do they do?"
              >
                {npc.occupation && <Typography variant="body-sm">{npc.occupation}</Typography>}
              </EntityFact>

              <EntityFact
                label="Race"
                editor={
                  isEditing('race') && (
                    <InlineEditor
                      label="Race"
                      rows={1}
                      initialValue={npc.race ?? ''}
                      optional
                      submitLabel="Save race"
                      maxLength={TEXT_LIMITS.line}
                      placeholder="Maia"
                      onSubmit={(value, openedWith) => save(editedText('race', value, openedWith))}
                      onSaved={() => afterSave('race')}
                      onCancel={() => {
                        closeField('race');
                        setReturnFocus('race');
                      }}
                    />
                  )
                }
                onEdit={gate.canAct ? () => openOnly('race') : undefined}
                triggerRef={factTrigger('race')}
                prompt="What race are they?"
              >
                {npc.race && <Typography variant="body-sm">{npc.race}</Typography>}
              </EntityFact>
            </>
          }
          aside={
            <>
              <EntityPageSection
                muted
                title={`Relationships${
                  relationships.length ? ` · ${relationships.length}` : ''
                }`}
                action={
                  gate.canAct && (
                    /*
                      The rail listed relationships well and offered no way to
                      add one: every link on it had to be made from the other
                      record, or from the edit form. `15-2`'s tray is
                      browse-first -- typing is never the price of attaching
                      something -- and it groups People / Places / Quests /
                      Rumours, which is the grouping this card already uses.

                      It draws no chips of its own: the card below is the list
                      of what is attached, in more detail than a chip can hold.
                    */
                    <AttachTray
                      kinds={['npc', 'location', 'quest', 'rumor']}
                      sources={{
                        npc: npcs.filter((candidate) => candidate.id !== npc.id),
                        location: locations,
                        quest: quests,
                        rumor: rumors ?? [],
                      }}
                      attached={attached}
                      showAttachedChips={false}
                      ariaLabel={`what ${npc.name} is linked to`}
                      onAttach={(id, kind) => void attachRelation(id, kind)}
                      onDetach={(id, kind) => void detachRelation(id, kind)}
                    />
                  )
                }
              >
                {relationships.length ? (
                  <div className="flex flex-col gap-4">
                    {RELATION_GROUPS.map(({ kind, label }) => {
                      const members = relationships.filter(
                        (relation) => relation.kind === kind
                      );
                      if (!members.length) {
                        // A heading over nothing is worse than no heading. The
                        // empty case is said once, for the whole card.
                        return null;
                      }

                      return (
                        <div key={kind} className="flex flex-col gap-1.5">
                          <Typography
                            variant="body-sm"
                            color="muted"
                            className="text-[10px] font-semibold uppercase tracking-wider"
                          >
                            {label}
                          </Typography>

                          <div className="flex flex-col divide-y card-divider">
                            {members.map((relation) => {
                              const body = (
                                <>
                                  <EntitySigil
                                    entityId={relation.id}
                                    name={relation.name}
                                    size={24}
                                  />
                                  <span className="min-w-0">
                                    <Typography
                                      variant="body-sm"
                                      className="block truncate"
                                    >
                                      {relation.name}
                                    </Typography>
                                    {relation.detail && (
                                      <Typography
                                        variant="body-sm"
                                        color="muted"
                                        className="block text-xs truncate"
                                      >
                                        {relation.detail}
                                      </Typography>
                                    )}
                                  </span>
                                </>
                              );

                              // An affiliation is a name, not a record: there is
                              // nowhere to go, so it is not dressed up as
                              // somewhere to click. It is the one relation the
                              // tray cannot offer, which is why it carries its
                              // own remove control (`15-8`).
                              return relation.href ? (
                                <button
                                  key={relation.key}
                                  type="button"
                                  onClick={() => navigateToPage(relation.href)}
                                  className="flex items-center gap-2.5 text-left py-2 first:pt-0 last:pb-0 rounded-md selectable-item"
                                >
                                  {body}
                                </button>
                              ) : (
                                <div
                                  key={relation.key}
                                  className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0"
                                >
                                  {body}
                                  {gate.canAct && relation.kind === 'affiliations' && (
                                    <button
                                      type="button"
                                      aria-label={`Remove the affiliation ${relation.name}`}
                                      onClick={() =>
                                        void changeConnections('affiliations', (names) =>
                                          names.filter((existing) => existing !== relation.name)
                                        )
                                      }
                                      className="button-ghost rounded-full p-1 ml-auto shrink-0"
                                    >
                                      <X size={14} aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Typography variant="body-sm" color="muted" className="italic">
                    Nothing linked yet
                  </Typography>
                )}

                {/*
                  `15-8` found affiliations with nowhere to live: the tray
                  offers records, and an affiliation is free text -- "The
                  Lockwardens", "House Crale" -- so `NPCForm` was the only place it
                  could be written. The tray above handles the four kinds that
                  are records; this handles the one that is not.
                */}
                {gate.canAct &&
                  (editingAffiliation ? (
                    <InlineEditor
                      label="Add an affiliation"
                      helperText="Free text — a company, an order, a house."
                      rows={1}
                      submitLabel="Add affiliation"
                      maxLength={TEXT_LIMITS.line}
                      placeholder="The Lockwardens"
                      clearOnSave
                      onSubmit={(value) =>
                        changeConnections('affiliations', (names) =>
                          Array.from(new Set([...names, value]))
                        )
                      }
                      onSaved={() => setEditingAffiliation(false)}
                      onCancel={() => setEditingAffiliation(false)}
                    />
                  ) : (
                    <FieldPrompt onClick={() => setEditingAffiliation(true)}>
                      {npc.connections?.affiliations?.length
                        ? 'Add another affiliation'
                        : 'What do they belong to?'}
                    </FieldPrompt>
                  ))}
              </EntityPageSection>

              <EntityPageSection title="Tags" muted>
                {npc.tags?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {npc.tags.map((tag, index) => (
                      <span
                        key={`${tag}-${index}`}
                        className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs card typography-secondary"
                      >
                        {tag}
                        {gate.canAct && (
                          <button
                            type="button"
                            aria-label={`Remove the tag ${tag}`}
                            onClick={() =>
                              void save((current) => ({
                                tags: (current.tags ?? []).filter((existing) => existing !== tag),
                              }))
                            }
                            className="button-ghost rounded-full p-0.5"
                          >
                            <X size={12} aria-hidden="true" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  !gate.canAct && (
                    <Typography variant="body-sm" color="muted" className="italic">
                      No tags yet
                    </Typography>
                  )
                )}

                {gate.canAct &&
                  (editingTag ? (
                    <InlineEditor
                      label="Add a tag"
                      rows={1}
                      submitLabel="Add tag"
                      maxLength={TEXT_LIMITS.line}
                      placeholder="wizard"
                      clearOnSave
                      onSubmit={(value) =>
                        save((current) => ({
                          tags: Array.from(new Set([...(current.tags ?? []), value])),
                        }))
                      }
                      onSaved={() => setEditingTag(false)}
                      onCancel={() => setEditingTag(false)}
                    />
                  ) : (
                    <FieldPrompt onClick={() => setEditingTag(true)}>
                      {npc.tags?.length ? 'Add another tag' : 'How would you find them again?'}
                    </FieldPrompt>
                  ))}
              </EntityPageSection>

              <EntityPageSection title="Record" muted>
                {/* Created and last-modified are the only two points
                    `ContentAttribution` holds. Two facts, stated -- not a
                    timeline (Q12). */}
                <AttributionInfo item={npc} />
              </EntityPageSection>
            </>
          }
        >
          {/* ---- Description ---- */}
          <EntityProse
            label="Description"
            editor={
              isEditing('description') && (
                <InlineEditor
                  label="Description"
                  helperText="A sentence or two about who they are."
                  initialValue={npc.description ?? ''}
                  submitLabel="Save description"
                  maxLength={TEXT_LIMITS.text}
                  onSubmit={(value, openedWith) => save(editedText('description', value, openedWith))}
                  onSaved={() => afterSave('description')}
                  onCancel={() => {
                    closeField('description');
                    setReturnFocus('description');
                  }}
                />
              )
            }
            onEdit={gate.canAct ? () => openOnly('description') : undefined}
            triggerRef={(node) => {
              triggers.current.description = node as HTMLButtonElement | null;
            }}
            prompt="Who are they?"
            status={savedNotice('description')}
          >
            {npc.description && (
              // Serif: this is the one piece of running prose the page
              // carries. Everything else is metadata and lists.
              <Typography className="font-serif italic text-lg leading-relaxed">
                {npc.description}
              </Typography>
            )}
          </EntityProse>

          {/* ---- The three fields nothing else in the app renders ----

              A block with nothing in it now asks for something rather than
              disappearing. The card is still dropped entirely when all
              three are empty **and the reader cannot write**: a prompt is
              an invitation, and offering one to someone who is signed out
              would be an invitation to nothing. */}
          {(npc.appearance || npc.personality || npc.background || gate.canAct) && (
            <section className="card rounded-lg p-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
              {PROSE_BLOCKS.map(({ field, label, prompt, helper }) => {
                const value = npc[field];
                return (
                  <div key={field} className="flex flex-col gap-2">
                    {isEditing(field) ? (
                      <InlineEditor
                        label={label}
                        helperText={helper}
                        initialValue={value ?? ''}
                        optional
                        submitLabel={`Save ${label.toLowerCase()}`}
                        maxLength={TEXT_LIMITS.text}
                        onSubmit={(next, openedWith) => save(editedText(field, next, openedWith))}
                        onSaved={() => afterSave(field)}
                        onCancel={() => {
                          closeField(field);
                          setReturnFocus(field);
                        }}
                      />
                    ) : value ? (
                      <>
                        <div className="flex items-center gap-2">
                          <FieldLabel>{label}</FieldLabel>
                          {gate.canAct && (
                            <Button
                              ref={(node: HTMLButtonElement | null) => {
                                triggers.current[field] = node;
                              }}
                              variant="ghost"
                              size="sm"
                              aria-label={`Edit ${label.toLowerCase()}`}
                              onClick={() => openOnly(field)}
                              startIcon={<Pencil className="w-3.5 h-3.5" />}
                            >
                              Edit
                            </Button>
                          )}
                          {savedNotice(field)}
                        </div>
                        <Typography variant="body-sm">{value}</Typography>
                      </>
                    ) : (
                      gate.canAct && (
                        <FieldPrompt
                          ref={(node) => {
                            triggers.current[field] = node;
                          }}
                          onClick={() => openOnly(field)}
                        >
                          {prompt}
                        </FieldPrompt>
                      )
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {/* ---- Notes: the history, then somewhere to add to it ---- */}
          <EntityNotes
            notes={notes}
            canEdit={gate.canAct}
            onAdd={addNote}
            onEdit={editNote}
            onDelete={deleteNote}
          />
        </EntityPageShell>
      )}

      {npc && (
        <DeleteConfirmationDialog
          isOpen={confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
          itemName={npc.name}
          itemType="NPC"
        />
      )}
    </>
  );
};

export default NPCDetailPage;
