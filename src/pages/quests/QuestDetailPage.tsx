// src/pages/quests/QuestDetailPage.tsx
import React, { useMemo, useState } from 'react';
import { TEXT_LIMITS } from 'core/constants/textLimits';
import { useLocation as useRouterLocation, useParams } from 'react-router-dom';
import { ArrowUpRight, X } from 'lucide-react';
import Typography from 'core/components/Typography';
import Button from 'core/components/Button';
import EntitySigil from 'core/components/EntitySigil';
import {
  useQuests,
  useNPCs,
  useLocations,
  useRumors,
  resolveLocation,
  resolveLocationName,
  resolveKeyPlace,
  QuestObjectives,
  DeleteQuestDialog,
  formatQuestStatus,
  objectiveProgressOf,
  QUEST_STATUS_OPTIONS,
  rumorTitleText,
  createLinkActions,
  useLinkPrivacy,
  useRecordNotesPath,
  npcIdsOfQuest,
  locationIdsOfNpc,
  useRecordNotes,
  editRecordNote,
  deleteRecordNote,
} from 'features/campaign-entities';
import type { Quest, QuestStatus, QuestLocation, QuestNote, StoredNote } from 'features/campaign-entities';
import type { RecordChange } from 'core/types/common';
import { useNotes, displayTitle as noteDisplayTitle } from 'features/collaboration';
import { useUser } from 'features/user-management';
import { getUserName, getActiveCharacterName } from 'core/utils/user-utils';
import AttributionInfo from 'shared/components/AttributionInfo';
import AttachTray from 'shared/components/attach-tray/AttachTray';
import PrivateNotice from 'shared/components/private/PrivateNotice';
import { attachRefs } from 'shared/components/attach-tray/attachCandidates';
import StateLadder from 'shared/components/row-controls/StateLadder';
import {
  EntityFact,
  EntityNotes,
  EntityPageShell,
  EntityPageSection,
  EntityProse,
  FieldPrompt,
} from 'shared/components/entity-page';
import { usePageGate, GatedContent } from 'shared/components/gated';
import { useNavigation } from 'shared/context/NavigationContext';
import { formatNoteDate, toNoteDate } from 'shared/utils/dateFormatter';
import { InlineEditor } from 'shared/components/inline-edit';
import { editedText } from 'shared/utils/edit-conflict';
import { useInlineEditing } from 'shared/hooks/useInlineEditing';

/** What points at this quest, from the three collections that can. */
interface InboundLink {
  key: string;
  id: string;
  name: string;
  detail: string;
  href: string;
}

/** The prep lists, which are all the same shape: a heading and free text lines. */
type PrepField = 'leads' | 'complications' | 'rewards';

const PREP_FIELDS: {
  key: PrepField;
  title: string;
  prompt: string;
  another: string;
  placeholder: string;
}[] = [
  {
    key: 'leads',
    title: 'Leads',
    prompt: 'Where does the party start looking?',
    another: 'Add another lead',
    placeholder: 'The door can only be opened on Durin’s Day',
  },
  {
    key: 'complications',
    title: 'Complications',
    prompt: 'What could go wrong?',
    another: 'Add another complication',
    placeholder: 'The magistrate wants the ledger too',
  },
  {
    key: 'rewards',
    title: 'Rewards',
    prompt: 'What is in it for them?',
    another: 'Add another reward',
    placeholder: 'The Arkenstone',
  },
];

/**
 * The designed not-found. A bad id is an ordinary event -- a stale bookmark, a
 * deleted quest, a link shared after the fact -- so it gets a designed state
 * and a way onward rather than a blank page.
 */
const QuestNotFound: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <div className="card rounded-lg p-10 flex flex-col items-center text-center gap-3">
    <Typography variant="h3">No quest with that id</Typography>
    <Typography color="secondary" className="max-w-md">
      It may have been deleted, or the link may point at a different campaign.
    </Typography>
    <Button variant="outline" onClick={onBack} className="mt-2">
      Back to Quests
    </Button>
  </div>
);

/**
 * One quest, in full, at `/quests/:questId`.
 *
 * **A quest is the most linked-to record in the product and had no address.**
 * Rumours convert into them, NPCs and locations relate to them, notes mention
 * them, Home lists them -- and every one of those links landed on the directory
 * with a row highlighted, because there was nowhere else to send them. A rumour
 * could be converted into a quest and then not refer to it.
 *
 * The page also takes the prep material off the row. Background, leads,
 * complications, rewards and the level range are read once, while prepping --
 * which is when you are here -- and they are what made the expanded quest row
 * about 1,100px tall (§3). The row keeps the four facts you can read while
 * scanning five of them; everything else lives here, in full and not behind a
 * reveal.
 *
 * **What this page deliberately does not do**, all three of which `S3` draws:
 *
 * - No per-objective history. The reference prints "gandlaf ticked *Find the
 *   secret door* · last session"; `ContentAttribution` holds created-by and
 *   last-modified-by and **nothing in between** (§8). A line like that
 *   would be inventing a history the data does not carry.
 * - No per-field credit under the description, for the same reason.
 * - No second NPC list. `importantNPCs` is deleted (`D15.7`) -- two fields for
 *   one relationship, both rendered, is why the same people appeared twice on
 *   one card.
 */
const QuestDetailPage: React.FC = () => {
  const { questId } = useParams<{ questId: string }>();
  /**
   * `15-1`'s contract: quick add navigates here with `quickAddFocus` naming
   * the first unwritten field. A quest's is `objectives`, and a quest created
   * through quick add has a title, a line and nothing else.
   */
  const quickAddFocus = (useRouterLocation().state as { quickAddFocus?: string } | null)
    ?.quickAddFocus;
  const { navigateToPage } = useNavigation();

  const {
    quests,
    isLoading,
    loadError,
    refreshQuests,
    updateQuest,
    updateQuestStatus,
    updateQuestObjective,
    addQuestObjective,
    editQuestObjective,
    moveQuestObjective,
    markQuestCompleted,
    addQuestNote,
    deleteQuest,
  } = useQuests();
  const { npcs, updateNPC } = useNPCs();
  const { locations, createLocation, updateLocation } = useLocations();
  // Where the quest lives: its notes sit under it (T163).
  const questsPath = useRecordNotesPath('quest', questId);
  const linkPrivacy = useLinkPrivacy();
  const { rumors, updateRumor } = useRumors();
  const { notes } = useNotes();
  const { activeGroupUserProfile } = useUser();
  // The quest's own notes, documents under it (T163); `notes` above are the
  // player's session notes, read for what points here.
  const questNotes = useRecordNotes<QuestNote>(questsPath, questId);

  const quest = quests.find((candidate) => candidate.id === questId);

  // `isLoading` folds into the gate's resolving state: `quests` is empty while
  // auth and the campaign restore, and without this the page would claim "no
  // quest with that id" for the found-but-not-yet-loaded case.
  const gate = usePageGate('quests', {
    /*
      The data hook now draws the line between "nothing to show yet" and "a
      fetch is in flight" for every consumer at once -- the rule, and the
      measurement behind it, are on `useQuestData`. What this adds is the
      narrower question a detail page asks: not "is the list loaded" but "is
      *this* record loaded", so the page never claims "no such record" for
      one that is simply still on its way.
    */
    loading: isLoading && !quest,
    error: loadError,
    onRetry: () => {
      void refreshQuests();
    },
  });

  // Closing an editor hands focus back to what opened it (A11Y-007).
  const { editing, setEditing, closeEditor, triggerRef } = useInlineEditing<
    'title' | 'status' | 'description' | 'background' | 'levelRange' | 'place' | PrepField
  >();

  /**
   * The quest's location, as a name.
   *
   * Item 10: **resolve every id to a name.** The quest card printed two
   * location ids as though they were labels, and one of them was wrong
   * besides.
   *
   * `resolveLocationName` names the place `locationId` points at, else
   * returns the stored free text or id verbatim, deliberately (#1412): a
   * reference to a place that no longer exists has to stay visible rather
   * than be prettified into something real or quietly vanish.
   *
   * Both rules hold here at once. A reference that resolves is a name; one
   * that does not is shown *as a broken reference* -- "nowhere — no such
   * place" -- which is neither a label nor a disappearance.
   */
  const resolvedName = useMemo(
    () =>
      quest
        ? resolveLocationName({ locationId: quest.locationId, location: quest.location }, locations)
        : undefined,
    [quest, locations]
  );

  const locationRecord = useMemo(
    () => (quest ? resolveLocation(quest, locations) : undefined),
    [locations, quest]
  );

  const locationName = resolvedName
    ? locationRecord
      ? resolvedName
      : `${resolvedName} — no such place`
    : undefined;

  /**
   * The people on the quest, resolved to records: the quest's own list (T131).
   */
  const personIds = useMemo(() => (quest ? npcIdsOfQuest(quest) : []), [quest]);
  const people = useMemo(
    () => personIds.map((id) => ({ id, npc: npcs.find((candidate) => candidate.id === id) })),
    [personIds, npcs]
  );

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
  const linkPerson = (id: string) =>
    quest ? links.link({ kind: 'quest', id: quest.id }, { kind: 'npc', id }) : Promise.resolve();
  const unlinkPerson = (id: string) =>
    quest ? links.unlink({ kind: 'quest', id: quest.id }, { kind: 'npc', id }) : Promise.resolve();

  /** Where a person is, for their line in the list: their first place, or their free text. */
  const whereIs = (npc: NonNullable<(typeof people)[number]['npc']>) => {
    const firstPlace = locations.find((location) => location.id === locationIdsOfNpc(npc, locations)[0]);
    return firstPlace?.name ?? resolveLocationName({ locationId: npc.locationId, location: npc.location }, locations);
  };

  /**
   * What points here -- derived, read-only, and the reason a quest earns a page
   * (item 6). These are other records' references to this one, and the place to
   * change a rumour's conversion is that rumour.
   */
  const inbound = useMemo<InboundLink[]>(() => {
    if (!quest) return [];
    const out: InboundLink[] = [];

    (rumors ?? [])
      .filter((rumor) => rumor.convertedToQuestId === quest.id)
      .forEach((rumor) =>
        out.push({
          key: `rumor-${rumor.id}`,
          id: rumor.id,
          name: rumorTitleText(rumor),
          detail: `rumour, ${rumor.status} — became this quest`,
          href: `/rumors?highlight=${rumor.id}`,
        })
      );

    // A note counts as pointing here only when its extracted entity was
    // actually converted into *this* quest. Matching the title against note
    // text would be a guess, and a guess in a derived list reads exactly like
    // a fact.
    (notes ?? [])
      .filter((note) =>
        note.extractedEntities?.some(
          (entity) => entity.type === 'quest' && entity.convertedToId === quest.id
        )
      )
      .forEach((note) =>
        out.push({
          key: `note-${note.id}`,
          id: note.id,
          name: noteDisplayTitle(note) ?? 'Untitled note',
          detail: 'note, mentions this quest',
          href: `/notes/${note.id}`,
        })
      );

    return out;
  }, [quest, rumors, notes]);

  /** What the delete dialog names as losing a link. */
  const deletionLosses = useMemo(() => {
    const losses = inbound.map((link) => `${link.name} — ${link.detail}`);
    const attached = people.filter((entry) => entry.npc).length;
    if (attached > 0) {
      losses.push(`${attached} ${attached === 1 ? 'person is' : 'people are'} attached to it`);
    }
    return losses;
  }, [inbound, people]);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const addNote = async (text: string) => {
    if (!quest) return;
    // The acting character, or their username when they have no character --
    // the same actor `core/attribution` credits for the record itself.
    const author =
      getActiveCharacterName(activeGroupUserProfile) ||
      getUserName(activeGroupUserProfile) ||
      undefined;
    await addQuestNote(quest.id, {
      date: toNoteDate(),
      text,
      ...(author ? { author } : {}),
    });
  };

  /**
   * A note is changed in its own document; one another player changed first
   * is refused rather than overwritten (T083).
   */
  const editNote = async (note: StoredNote<QuestNote>, text: string) => {
    if (!questsPath || !quest) return;
    await editRecordNote(questsPath, quest.id, note.noteId, 'text', note.text, text);
  };
  const deleteNote = async (note: StoredNote<QuestNote>) => {
    if (!questsPath || !quest) return;
    await deleteRecordNote(questsPath, quest.id, note.noteId);
  };

  // Every write re-reads the collection rather than patching state locally: if
  // another player changed the same record first, the refetch is where that
  // becomes visible. `updateQuest` already does that read and awaits it
  // (`QuestContext`), so asking again here fetched the whole collection twice
  // for one edit (PERF-06). Only what `change` names is written (T083): the
  // copy may be behind the server, so a list worked out from the old one goes
  // as a function and is worked out from the record the server holds.
  const save = async (change: RecordChange<Quest>) => {
    if (!quest) return;
    await updateQuest(quest.id, change);
  };

  /** Append one line to a prep list. */
  const addTo = (field: PrepField) => (value: string) =>
    save((current) => ({ [field]: [...(current[field] ?? []), value] }) as Partial<Quest>);

  const removeFrom = (field: PrepField, value: string) =>
    save((current) => ({
      [field]: (current[field] ?? []).filter((entry) => entry !== value),
    }) as Partial<Quest>);

  /**
   * The location a place already is, if any (#1421): by the id stored when it
   * was added, else -- for places added before that -- by its name.
   */
  const placeLocation = (place: QuestLocation) => resolveKeyPlace(place, locations);

  /**
   * A place inside the quest becomes a real location -- the same promotion a
   * location's features get (§6.4, item 5).
   *
   * They stay free text until then: these are prep notes about places inside
   * the quest's location, mostly never visited, and promoting them all would
   * fill the location tree with stubs nobody has been to.
   */
  const promotePlace = async (place: QuestLocation) => {
    if (!quest || !questsPath) return;
    // The place points at the new location in the same commit as the
    // location is created (T088): as a second write, a failure left the
    // location behind and the place still offering to be promoted again.
    const newId = await createLocation({
      name: place.name,
      type: 'poi',
      status: 'known',
      description: place.description ?? '',
      // Inside the quest's own location when there is one: a secret door is a
      // place inside the Drowned Archive, not a region of its own.
      parentId: locationRecord?.id ?? '',
      features: [],
      connectedNPCs: [],
      // The quest owns the link (T131): the place stays on it, now pointing
      // at the location it became.
      notes: [],
      tags: [],
    }, {
      collection: questsPath,
      id: quest.id,
      change: (current, createdId) => {
        if (!current) throw new Error('Quest not found');
        return {
          keyLocations: (current.keyLocations ?? []).map((entry: QuestLocation) =>
            entry.name === place.name && !entry.locationId ? { ...entry, locationId: createdId } : entry
          ),
        };
      },
    // A private quest's place becomes a private location (T163).
    }, ...(quest.isPrivate ? [{ private: true }] : []));
    navigateToPage(`/locations/${newId}`);
  };

  const handleDelete = async () => {
    if (!quest) return;
    await deleteQuest(quest.id);
    navigateToPage('/quests');
  };

  const canAct = gate.canAct;
  const progress = objectiveProgressOf(quest?.objectives);

  return (
    <>
      {gate.state !== 'ready' || !quest ? (
        <div className="max-w-7xl mx-auto px-4 py-8">
          <Typography variant="h1" className="mb-8">
            Quest
          </Typography>
          <GatedContent gate={gate}>
            <QuestNotFound onBack={() => navigateToPage('/quests')} />
          </GatedContent>
        </div>
      ) : (
        <EntityPageShell
          breadcrumb={[{ label: 'Quests', href: '/quests' }, { label: quest.title }]}
          entityId={quest.id}
          name={quest.title}
          notice={quest.isPrivate ? <PrivateNotice /> : undefined}
          heading={
            editing === 'title' ? (
              <InlineEditor
                label="Title"
                rows={1}
                initialValue={quest.title}
                submitLabel="Save title"
                maxLength={TEXT_LIMITS.line}
                onSubmit={(value, openedWith) => save(editedText('title', value, openedWith))}
                onSaved={closeEditor}
                onCancel={closeEditor}
              />
            ) : canAct ? (
              // The title itself is the target, as on the NPC page.
              <button
                type="button"
                ref={triggerRef('title')}
                aria-label={`Edit the title ${quest.title}`}
                onClick={() => setEditing('title')}
                className="text-left rounded-md px-1 -mx-1 selectable-item"
              >
                <Typography variant="h1" className="break-words">
                  {quest.title}
                </Typography>
              </button>
            ) : undefined
          }
          subtitle={locationName && <Typography color="secondary">At {locationName}</Typography>}
          actions={
            canAct && (
              <>
                {quest.status === 'active' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void markQuestCompleted(quest.id)}
                  >
                    Mark completed
                  </Button>
                )}
                {/* The dialog says what else loses a link. */}
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
            <>
              <EntityFact
                label="Status"
                editor={
                  editing === 'status' && (
                    <StateLadder
                      label="Status"
                      options={QUEST_STATUS_OPTIONS}
                      value={quest.status}
                      ariaLabel={`Status of ${quest.title}`}
                      onChange={(status: QuestStatus) =>
                        updateQuestStatus(quest.id, status).then(closeEditor)
                      }
                    />
                  )
                }
                onEdit={canAct ? () => setEditing('status') : undefined}
                triggerRef={triggerRef('status')}
              >
                <Typography variant="body-sm" className="font-medium">
                  {formatQuestStatus(quest.status)}
                </Typography>
              </EntityFact>

              <EntityFact label="Objectives">
                <Typography variant="body-sm">
                  {progress.total > 0 ? `${progress.completed} of ${progress.total} done` : 'None yet'}
                </Typography>
              </EntityFact>

              <EntityFact
                label="Level range"
                editor={
                  editing === 'levelRange' && (
                    <InlineEditor
                      label="Level range"
                      rows={1}
                      initialValue={quest.levelRange ?? ''}
                      optional
                      submitLabel="Save level range"
                      maxLength={TEXT_LIMITS.line}
                      placeholder="7–9"
                      onSubmit={(value) => save({ levelRange: value })}
                      onSaved={closeEditor}
                      onCancel={closeEditor}
                    />
                  )
                }
                onEdit={canAct ? () => setEditing('levelRange') : undefined}
                triggerRef={triggerRef('levelRange')}
                prompt="What levels is it pitched at?"
              >
                {quest.levelRange && <Typography variant="body-sm">{quest.levelRange}</Typography>}
              </EntityFact>

              <EntityFact label="Completed">
                <Typography variant="body-sm">
                  {quest.status === 'completed'
                    ? quest.dateCompleted
                      ? formatNoteDate(quest.dateCompleted)
                      : 'Yes'
                    : 'Not yet'}
                </Typography>
              </EntityFact>
            </>
          }
          aside={
            <>
              {/* ---------------------------- who is in it --------------------------- */}
              <EntityPageSection
                title="Who is in it"
                muted
                count={people.length || undefined}
                empty={
                  !canAct ? (
                    <Typography variant="body-sm" color="muted" className="italic">
                      Nobody attached yet
                    </Typography>
                  ) : undefined
                }
              >
                {people.length ? (
                  <ul className="flex flex-col gap-1 list-none p-0 m-0">
                    {people.map(({ id, npc }) => (
                      <li
                        key={id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 selectable-item"
                      >
                        {npc ? (
                          <>
                            <EntitySigil entityId={npc.id} name={npc.name} size={20} />
                            <button
                              type="button"
                              onClick={() => navigateToPage(`/npcs/${npc.id}`)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <span className="font-heading block truncate">{npc.name}</span>
                              {/*
                                Occupation and where they are: what tells two
                                NPCs apart (item 4). "Odile Marrow ·
                                Ferrywoman" is the line `S3`
                                draws.
                              */}
                              <Typography
                                variant="body-sm"
                                color="secondary"
                                className="block text-xs truncate"
                              >
                                {[npc.occupation || npc.title, whereIs(npc)]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </Typography>
                            </button>
                          </>
                        ) : (
                          // A reference that no longer resolves says so; it
                          // never prints the id as though it were a name.
                          <Typography
                            variant="body-sm"
                            color="secondary"
                            className="italic flex-1 min-w-0"
                          >
                            Someone no longer in the directory
                          </Typography>
                        )}
                        {canAct && (
                          <button
                            type="button"
                            aria-label={`Remove ${npc ? npc.name : 'this person'} from ${quest.title}`}
                            onClick={() => void unlinkPerson(id)}
                            className="button-ghost rounded-full p-1 shrink-0"
                          >
                            <X size={14} aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {canAct && (
                  <AttachTray
                    kinds={['npc']}
                    sources={{ npc: npcs, location: locations }}
                    attached={attachRefs('npc', personIds)}
                    // The list above already names each person, with their
                    // occupation and where they are. Chips under it would be
                    // the same person twice.
                    showAttachedChips={false}
                    ariaLabel={`the people in ${quest.title}`}
                    onAttach={(id) => void linkPerson(id)}
                    onDetach={(id) => void unlinkPerson(id)}
                  />
                )}
              </EntityPageSection>

              {/* ---------------------------- where it happens ----------------------- */}
              <EntityPageSection
                title="Where it happens"
                muted
                empty={
                  !canAct ? (
                    <Typography variant="body-sm" color="muted" className="italic">
                      No place recorded
                    </Typography>
                  ) : undefined
                }
              >
                {/*
                  `15-8` found this had nowhere to live. A quest's `locationId`
                  was edited by `QuestFormSections`' own single-location tray,
                  and when that form was deleted the field became readable --
                  it is in the line under the title -- and unwritable. One
                  relation, so attaching replaces rather than adds.
                */}
                {locationName && (
                  <Typography variant="body-sm">{locationName}</Typography>
                )}
                {canAct && (
                  <AttachTray
                    kinds={['location']}
                    sources={{ npc: npcs, location: locations }}
                    attached={attachRefs('location', [quest.locationId])}
                    single
                    showAttachedChips={false}
                    ariaLabel={`where ${quest.title} happens`}
                    onAttach={(id) => {
                      const place = locations.find((candidate) => candidate.id === id);
                      void save({ locationId: id, location: place?.name ?? '' });
                    }}
                    onDetach={() => void save({ locationId: '', location: '' })}
                  />
                )}
              </EntityPageSection>

              {/* -------------------------- what points here ------------------------ */}
              <EntityPageSection
                title="What points here"
                muted
                empty={
                  <Typography variant="body-sm" color="muted" className="italic">
                    Nothing points here yet
                  </Typography>
                }
              >
                {inbound.length ? (
                  <>
                    <ul className="flex flex-col gap-0.5 list-none p-0 m-0">
                      {inbound.map((link) => (
                        <li key={link.key}>
                          <button
                            type="button"
                            onClick={() => navigateToPage(link.href)}
                            className="w-full flex items-center gap-2 text-left rounded-md px-2 py-1.5 selectable-item"
                          >
                            <EntitySigil entityId={link.id} name={link.name} size={20} />
                            <span className="min-w-0">
                              <span className="font-heading block truncate">{link.name}</span>
                              <Typography
                                variant="body-sm"
                                color="secondary"
                                className="block text-xs truncate"
                              >
                                {link.detail}
                              </Typography>
                            </span>
                            <ArrowUpRight
                              size={14}
                              aria-hidden="true"
                              className="ml-auto shrink-0"
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <Typography variant="body-sm" color="muted" className="text-xs">
                      Derived, not authored — change these where they are written.
                    </Typography>
                  </>
                ) : null}
              </EntityPageSection>

              {/* ------------------------------ the record -------------------------- */}
              <EntityPageSection title="Record" muted>
                {/*
                  Created and last-modified are the only two points
                  `ContentAttribution` holds. Two facts, stated -- not a
                  timeline, and never per objective (§8).
                */}
                <AttributionInfo item={quest} />
              </EntityPageSection>
            </>
          }
        >
          {/* --------------------- what the party was asked to do --------------------- */}
          <EntityProse
            label="What the party was asked to do"
            editor={
              editing === 'description' && (
                <InlineEditor
                  label="Description"
                  helperText="What the party agreed to, in a sentence or two."
                  initialValue={quest.description ?? ''}
                  submitLabel="Save description"
                  maxLength={TEXT_LIMITS.text}
                  onSubmit={(value, openedWith) => save(editedText('description', value, openedWith))}
                  onSaved={closeEditor}
                  onCancel={closeEditor}
                />
              )
            }
            onEdit={canAct ? () => setEditing('description') : undefined}
            triggerRef={triggerRef('description')}
            prompt="What was the party asked to do?"
          >
            {quest.description && (
              <Typography className="text-lg leading-relaxed">{quest.description}</Typography>
            )}
          </EntityProse>

          {/* ------------------------------- objectives ------------------------------- */}
          <QuestObjectives
            quest={quest}
            canAct={canAct}
            onToggle={(objectiveId, completed) =>
              updateQuestObjective(quest.id, objectiveId, completed)
            }
            onAdd={(description) => addQuestObjective(quest.id, description)}
            onEdit={(objectiveId, description, openedWith) =>
              editQuestObjective(quest.id, objectiveId, description, openedWith)
            }
            onMove={(objectiveId, direction) =>
              moveQuestObjective(quest.id, objectiveId, direction)
            }
            onComplete={() => markQuestCompleted(quest.id)}
            focusAdd={quickAddFocus === 'objectives' && (quest.objectives ?? []).length === 0}
          />

          {/* ---------------------------------- prep ---------------------------------- */}
          <EntityProse
            label="Background"
            editor={
              editing === 'background' && (
                <InlineEditor
                  label="Background"
                  helperText="How this came about, and what the party already knows."
                  initialValue={quest.background ?? ''}
                  optional
                  submitLabel="Save background"
                  maxLength={TEXT_LIMITS.text}
                  onSubmit={(value, openedWith) => save(editedText('background', value, openedWith))}
                  onSaved={closeEditor}
                  onCancel={closeEditor}
                />
              )
            }
            onEdit={canAct ? () => setEditing('background') : undefined}
            triggerRef={triggerRef('background')}
            prompt="How did this come about?"
            empty="No background written yet"
          >
            {quest.background && (
              // Serif: the running prose of the page, in the campaign's voice.
              <Typography className="font-serif italic text-lg leading-relaxed">
                {quest.background}
              </Typography>
            )}
          </EntityProse>

          {PREP_FIELDS.map((field) => {
            const entries = quest[field.key] ?? [];
            return (
              <EntityPageSection
                key={field.key}
                title={field.title}
                count={entries.length || undefined}
              >
                {entries.length ? (
                  <ul className="flex flex-col divide-y card-divider list-none p-0 m-0">
                    {entries.map((entry) => (
                      <li
                        key={entry}
                        className="flex items-center gap-3 py-2 first:pt-0 last:pb-0 min-h-[44px] sm:min-h-[38px]"
                      >
                        <Typography className="flex-1 min-w-0">{entry}</Typography>
                        {canAct && (
                          <button
                            type="button"
                            aria-label={`Remove ${entry}`}
                            onClick={() => void removeFrom(field.key, entry)}
                            className="button-ghost rounded-full p-1 shrink-0"
                          >
                            <X size={14} aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {canAct &&
                  (editing === field.key ? (
                    <InlineEditor
                      label={field.title}
                      rows={1}
                      submitLabel={`Add to ${field.title.toLowerCase()}`}
                      maxLength={TEXT_LIMITS.text}
                      placeholder={field.placeholder}
                      clearOnSave
                      onSubmit={addTo(field.key)}
                      onSaved={() => undefined}
                      onCancel={closeEditor}
                    />
                  ) : (
                    <FieldPrompt ref={triggerRef(field.key)} onClick={() => setEditing(field.key)}>
                      {entries.length ? field.another : field.prompt}
                    </FieldPrompt>
                  ))}
              </EntityPageSection>
            );
          })}

          {/* ------------------------- places inside this quest ----------------------- */}
          <EntityPageSection
            title="Places inside this quest"
            count={(quest.keyLocations ?? []).length || undefined}
          >
            {(quest.keyLocations ?? []).length ? (
              <ul className="flex flex-col divide-y card-divider list-none p-0 m-0">
                {(quest.keyLocations ?? []).map((place) => {
                  /*
                    A place that is already a location (#1421) links to it,
                    under the location's current name, and cannot be promoted:
                    that would make a second one. Quests written before places
                    were prep notes list whole locations here, by name.
                  */
                  const existing = placeLocation(place);
                  const shownName = existing ? existing.name : place.name;
                  const text = (
                    <>
                      <Typography className="font-heading block truncate">{shownName}</Typography>
                      {place.description && (
                        <Typography variant="body-sm" color="secondary" className="block">
                          {place.description}
                        </Typography>
                      )}
                    </>
                  );
                  return (
                    <li
                      key={place.name}
                      className="flex items-center gap-3 py-2 first:pt-0 last:pb-0 min-h-[44px] sm:min-h-[38px]"
                    >
                      {existing ? (
                        <button
                          type="button"
                          onClick={() => navigateToPage(`/locations/${existing.id}`)}
                          className="flex-1 min-w-0 text-left"
                        >
                          {text}
                        </button>
                      ) : (
                        <span className="flex-1 min-w-0">{text}</span>
                      )}
                      {canAct && (
                        <>
                          {!existing && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void promotePlace(place)}
                            >
                              Make it a location
                            </Button>
                          )}
                          <button
                            type="button"
                            aria-label={`Remove ${shownName}`}
                            onClick={() =>
                              void save((current) => ({
                                keyLocations: (current.keyLocations ?? []).filter(
                                  (entry) => entry.name !== place.name
                                ),
                              }))
                            }
                            className="button-ghost rounded-full p-1 shrink-0"
                          >
                            <X size={14} aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {canAct &&
              (editing === 'place' ? (
                <InlineEditor
                  label="Add a place"
                  helperText="Free text. A place becomes a location of its own only when you promote it."
                  rows={1}
                  submitLabel="Add place"
                  maxLength={TEXT_LIMITS.line}
                  placeholder="Secret door"
                  clearOnSave
                  onSubmit={(value) => {
                    // Naming a location the campaign already has stores its
                    // id, so the link survives that location being renamed.
                    const existing = resolveKeyPlace({ name: value }, locations);
                    return save((current) => ({
                      keyLocations: [
                        ...(current.keyLocations ?? []),
                        existing
                          ? { name: value, description: '', locationId: existing.id }
                          : { name: value, description: '' },
                      ],
                    }));
                  }}
                  onSaved={() => undefined}
                  onCancel={closeEditor}
                />
              ) : (
                <FieldPrompt ref={triggerRef('place')} onClick={() => setEditing('place')}>
                  {(quest.keyLocations ?? []).length
                    ? 'Add another place'
                    : 'Where does this quest happen?'}
                </FieldPrompt>
              ))}

            <Typography variant="body-sm" color="muted" className="text-xs">
              These stay free text — notes about places inside the quest’s location, not records of
              their own. Promoting one is how it becomes a location when the party gets there; one
              that already is a location links to it.
            </Typography>
          </EntityPageSection>

          {/* --------------------------------- notes -------------------------------- */}
          <EntityNotes
            notes={questNotes}
            canEdit={canAct}
            onAdd={addNote}
            onEdit={editNote}
            onDelete={deleteNote}
            placeholder="What happened on this quest, and when"
          />
        </EntityPageShell>
      )}

      {quest && (
        <DeleteQuestDialog
          isOpen={confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          title={quest.title}
          losses={deletionLosses}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
};

export default QuestDetailPage;
