// src/pages/locations/LocationDetailPage.tsx
import React, { useMemo, useState } from 'react';
import { TEXT_LIMITS } from 'core/constants/textLimits';
import { useLocation as useRouterLocation, useParams } from 'react-router-dom';
import { ArrowUpRight, X } from 'lucide-react';
import Typography from 'core/components/Typography';
import Button from 'core/components/Button';
import Select from 'core/components/Select';
import EntitySigil from 'core/components/EntitySigil';
import { entityImagePrefix } from 'core/services/firebase/storage/ImageStorageService';
import {
  useLocations,
  useNPCs,
  useQuests,
  useRumors,
  createLinkActions,
  useLinkPrivacy,
  useRecordNotesPath,
  npcIdsOfLocation,
  questIdsOfLocation,
  rumorIdsOfLocation,
  useRecordNotes,
  editRecordNote,
  deleteRecordNote,
  WhereThisSits,
  DeleteLocationDialog,
  buildLocationIndex,
  insideCountOf,
  ancestorPathOf,
  formatLocationType,
  formatLocationStatus,
  KNOWLEDGE_OPTIONS,
} from 'features/campaign-entities';
import type { Location, LocationNote, LocationType, LocationStatus, StoredNote } from 'features/campaign-entities';
import type { RecordChange } from 'core/types/common';
import { useUser, useGroups, useCampaigns } from 'features/user-management';
import AttributionInfo from 'shared/components/AttributionInfo';
import { useImageAttachment } from 'shared/hooks/useImageAttachment';
import AttachTray from 'shared/components/attach-tray/AttachTray';
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
import { useQuickAdd } from 'shared/context/QuickAddContext';
import { useNavigation } from 'shared/context/NavigationContext';
import { formatNoteDate, toNoteDate } from 'shared/utils/dateFormatter';
import { getUserName, getActiveCharacterName } from 'core/utils/user-utils';
import { InlineEditor } from 'shared/components/inline-edit';
import { editedText } from 'shared/utils/edit-conflict';
import { rumorTitleText } from 'features/campaign-entities';
import { useInlineEditing } from 'shared/hooks/useInlineEditing';

/** The eight kinds a place can be, as the select offers them. */
const TYPE_OPTIONS: LocationType[] = [
  'region',
  'city',
  'town',
  'village',
  'dungeon',
  'landmark',
  'building',
  'poi',
];

/** What points at this place, from the three collections that can. */
interface InboundLink {
  key: string;
  id: string;
  name: string;
  detail: string;
  href: string;
}

/**
 * The designed not-found. A bad id is an ordinary event -- a stale bookmark, a
 * deleted place, a link shared after the fact -- so it gets a designed state
 * and a way onward rather than a blank page.
 */
const LocationNotFound: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <div className="card rounded-lg p-10 flex flex-col items-center text-center gap-3">
    <Typography variant="h3">No place with that id</Typography>
    <Typography color="secondary" className="max-w-md">
      It may have been deleted, or the link may point at a different campaign.
    </Typography>
    <Button variant="outline" onClick={onBack} className="mt-2">
      Back to Locations
    </Button>
  </div>
);

/**
 * One location, in full, at `/locations/:locationId`.
 *
 * The page exists because **a row cannot hold a tree** (§2.2). The directory's
 * answer to "what is inside this?" was to expand a parent into a full record
 * card, print a "Locations in X" heading, and nest a *child record card* inside
 * it -- two records at identical weight, unbounded as depth grows, and the
 * clumsiness this whole phase was opened to fix.
 *
 * Everything here is edited where it is read (§7). There is no link to
 * `/locations/edit/:id` from this page, by design; the route itself is `15-8`'s
 * to retire.
 *
 * **What this page deliberately does not do**, both of which the visual
 * reference shows:
 *
 * - No per-field attribution. The reference prints "DungeonMaster · 31 May"
 *   under the description; `ContentAttribution` holds created-by and
 *   last-modified-by and **nothing in between** (§8), so a line under one
 *   field would be inventing a history the data does not carry.
 * - No gallery. One picture heads the page (T021); anything more is a
 *   different feature.
 */
const LocationDetailPage: React.FC = () => {
  const { locationId } = useParams<{ locationId: string }>();
  /**
   * `15-1`'s contract: quick add navigates here with `quickAddFocus` naming the
   * first unwritten field, and the page consumes it. A location's is `parent`.
   *
   * Honoured only when the record actually has none. *Add a place inside* sets
   * the parent before the record exists, and sending someone who just chose a
   * parent straight to the control for choosing one would be the software
   * ignoring what it was just told.
   */
  const quickAddFocus = (useRouterLocation().state as { quickAddFocus?: string } | null)
    ?.quickAddFocus;
  const { navigateToPage } = useNavigation();
  const { openQuickAdd } = useQuickAdd();
  const { activeGroupUserProfile } = useUser();
  const { activeGroupId } = useGroups();
  const { activeCampaignId } = useCampaigns();

  const {
    locations,
    isLoading,
    loadError,
    refreshLocations,
    updateLocation,
    updateLocationNote,
    updateLocationStatus,
    moveLocation,
    deleteLocation,
    createLocation,
  } = useLocations();
  // Where the place lives: its notes sit under it (T163).
  const locationsPath = useRecordNotesPath('location', locationId);
  const linkPrivacy = useLinkPrivacy();
  // The notes: their own documents (T133).
  const notes = useRecordNotes<LocationNote>(locationsPath, locationId);
  const { npcs, updateNPC } = useNPCs();
  const { quests, updateQuest } = useQuests();
  const { rumors, updateRumor } = useRumors();

  const location = locations.find((candidate) => candidate.id === locationId);

  // `isLoading` folds into the gate's resolving state: `locations` is empty
  // while auth and the campaign restore, and without this the page would claim
  // "no place with that id" for the found-but-not-yet-loaded case.
  const gate = usePageGate('locations', {
    /*
      The data hook now draws the line between "nothing to show yet" and "a
      fetch is in flight" for every consumer at once -- the rule, and the
      measurement behind it, are on `useQuestData`. What this adds is the
      narrower question a detail page asks: not "is the list loaded" but "is
      *this* record loaded", so the page never claims "no such record" for
      one that is simply still on its way.
    */
    loading: isLoading && !location,
    error: loadError,
    onRetry: () => {
      void refreshLocations();
    },
  });

  // Closing an editor hands focus back to what opened it (A11Y-007).
  const { editing, setEditing, closeEditor, triggerRef } = useInlineEditing<
    'name' | 'status' | 'type' | 'description' | 'feature' | 'tag'
  >();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const index = useMemo(() => buildLocationIndex(locations), [locations]);
  const insideCount = location ? insideCountOf(index, location.id) : 0;
  const ancestors = useMemo(
    () => (location ? ancestorPathOf(locations, location.id) : []),
    [locations, location]
  );
  const parentName = ancestors.length ? ancestors[ancestors.length - 1].name : undefined;

  /**
   * The people linked to this place, resolved to records: its own list
   * (T131). A person's own record once named a place too, and the two were
   * shown apart, the second as "recorded as being here", because they
   * disagreed; a link is one thing now, stored once.
   */
  const personIds = useMemo(() => (location ? npcIdsOfLocation(location) : []), [location]);
  const peopleHere = useMemo(
    () =>
      personIds
        .map((id) => npcs.find((npc) => npc.id === id))
        .filter((npc): npc is NonNullable<typeof npc> => Boolean(npc)),
    [personIds, npcs]
  );

  const questIds = useMemo(() => (location ? questIdsOfLocation(location, quests) : []), [location, quests]);
  const rumorIds = useMemo(() => (location ? rumorIdsOfLocation(location, rumors ?? []) : []), [location, rumors]);

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
  const here = location ? { kind: 'location' as const, id: location.id } : null;

  /**
   * The quests and rumours linked to this place -- the one list §3 says a
   * *row* can never hold without becoming a card again. Linked from either
   * side (T131): a quest stores its places, a rumour the places it concerns,
   * and this page adds and removes them as well as listing them.
   */
  const inbound = useMemo<InboundLink[]>(() => {
    if (!location) return [];
    const out: InboundLink[] = [];

    questIds
      .map((id) => quests.find((quest) => quest.id === id))
      .filter((quest): quest is NonNullable<typeof quest> => Boolean(quest))
      .forEach((quest) =>
        out.push({
          key: `quest-${quest.id}`,
          id: quest.id,
          name: quest.title,
          detail: `quest, ${quest.status}`,
          href: `/quests/${quest.id}`,
        })
      );

    rumorIds
      .map((id) => (rumors ?? []).find((rumor) => rumor.id === id))
      .filter((rumor): rumor is NonNullable<typeof rumor> => Boolean(rumor))
      .forEach((rumor) =>
        out.push({
          key: `rumor-${rumor.id}`,
          id: rumor.id,
          name: rumorTitleText(rumor),
          detail: `rumour, ${rumor.status}`,
          href: `/rumors?highlight=${rumor.id}`,
        })
      );

    return out;
  }, [location, questIds, quests, rumorIds, rumors]);

  // Nothing is patched locally after a write: the page shows the listener's
  // copy, which carries both this write and any other player's (T032). That
  // copy can be behind the server, so a list worked out from the old one goes
  // as a function and is worked out from the record the server holds (T083).
  const save = async (change: RecordChange<Location>) => {
    if (!location) return;
    await updateLocation(location.id, change);
  };

  const picture = useImageAttachment({
    prefix:
      location && activeGroupId && activeCampaignId
        ? entityImagePrefix(activeGroupId, activeCampaignId, 'locations', location.id)
        : null,
    current: location?.image,
    save: (image) => save({ image }),
  });

  const addNote = async (text: string) => {
    if (!location) return;
    const author =
      getActiveCharacterName(activeGroupUserProfile) ||
      getUserName(activeGroupUserProfile) ||
      undefined;
    // The context stamps the date itself.
    await updateLocationNote(location.id, {
      date: toNoteDate(),
      text,
      ...(author ? { author } : {}),
    });
  };

  /**
   * A note is changed in its own document (T133); one another player changed
   * first is refused rather than overwritten (T083).
   */
  const editNote = async (note: StoredNote<LocationNote>, text: string) => {
    if (!locationsPath || !location) return;
    await editRecordNote(locationsPath, location.id, note.noteId, 'text', note.text, text);
  };
  const deleteNote = async (note: StoredNote<LocationNote>) => {
    if (!locationsPath || !location) return;
    await deleteRecordNote(locationsPath, location.id, note.noteId);
  };

  /**
   * A feature becomes a real place (§6.4, item 7).
   *
   * `features` are free text on the record and children are documents; they are
   * different things, and this is the one action that moves a name across --
   * for when the party actually arrives somewhere that was a line of scenery.
   */
  const promoteFeature = async (feature: string) => {
    if (!location || !locationsPath) return;
    // The feature comes off this place in the same commit as the new place is
    // created (T088): as a second write, a failure left the new place behind
    // and the feature still offering to be promoted again.
    await createLocation({
      name: feature,
      type: 'poi',
      status: 'known',
      description: '',
      parentId: location.id,
      features: [],
      connectedNPCs: [],
      notes: [],
      tags: [],
    }, {
      collection: locationsPath,
      id: location.id,
      change: (current) => {
        if (!current) throw new Error('Location not found');
        return { features: (current.features ?? []).filter((f: string) => f !== feature) };
      },
    // A place inside a private one is private too (T163).
    }, ...(location.isPrivate ? [{ private: true }] : []));
  };

  const handleDelete = async (childStrategy: Parameters<typeof deleteLocation>[1]) => {
    if (!location) return;
    await deleteLocation(location.id, childStrategy);
    navigateToPage('/locations');
  };

  // A place being deleted takes no edit -- the rules refuse every one (T088)
  // -- so none is offered; only finishing the deletion is.
  const canAct = gate.canAct && !location?.deleting;

  return (
    <>
      {gate.state !== 'ready' || !location ? (
        <div className="max-w-7xl mx-auto px-4 py-8">
          <Typography variant="h1" className="mb-8">
            Location
          </Typography>
          <GatedContent gate={gate}>
            <LocationNotFound onBack={() => navigateToPage('/locations')} />
          </GatedContent>
        </div>
      ) : (
        <EntityPageShell
          breadcrumb={[
            { label: 'Locations', href: '/locations' },
            ...ancestors.map((ancestor) => ({
              label: ancestor.name,
              href: `/locations/${ancestor.id}`,
            })),
            { label: location.name },
          ]}
          entityId={location.id}
          name={location.name}
          image={location.image}
          imageAlt={location.name}
          imageShape="wide"
          imageUpload={
            // No picture on a private place yet: its file would be stored
            // where every member reads it (T163).
            canAct && !location.isPrivate
              ? { subject: 'picture', onUpload: picture.upload, onRemove: picture.remove }
              : undefined
          }
          heading={
            editing === 'name' ? (
              <InlineEditor
                label="Name"
                rows={1}
                initialValue={location.name}
                submitLabel="Save name"
                maxLength={TEXT_LIMITS.line}
                onSubmit={(value, openedWith) => save(editedText('name', value, openedWith))}
                onSaved={closeEditor}
                onCancel={closeEditor}
              />
            ) : canAct ? (
              // The name itself is the target, as on the NPC page.
              <button
                type="button"
                ref={triggerRef('name')}
                aria-label={`Edit the name ${location.name}`}
                onClick={() => setEditing('name')}
                className="text-left rounded-md px-1 -mx-1 selectable-item"
              >
                <Typography variant="h1" className="break-words">
                  {location.name}
                </Typography>
              </button>
            ) : undefined
          }
          subtitle={
            parentName && <Typography color="secondary">In {parentName}</Typography>
          }
          actions={
            canAct && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openQuickAdd('location', { parentId: location.id })}
                >
                  Add a place inside
                </Button>
                {/* The dialog asks what happens to the places inside. */}
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
          notice={
            // A deletion that failed partway leaves its mark, and the rules
            // refuse every edit to a marked place (T088): the one thing left to
            // do is finish it, the way it started.
            gate.canAct &&
            location.deleting && (
              <div className="flex items-center gap-3 flex-wrap">
                <Typography variant="body-sm" color="secondary">
                  Deleting {location.name} stopped partway. It takes no changes
                  until it is finished.
                </Typography>
                <Button
                  variant="ghost"
                  size="sm"
                  className="delete-button"
                  onClick={() => {
                    setFinishError(null);
                    handleDelete(location.deleting).catch((err: unknown) =>
                      setFinishError(err instanceof Error ? err.message : 'Could not finish deleting')
                    );
                  }}
                >
                  Finish deleting
                </Button>
                {finishError && (
                  <Typography variant="body-sm" color="error" role="alert">
                    {finishError}
                  </Typography>
                )}
              </div>
            )
          }
          facts={
            <>
              <EntityFact
                label="Knowledge"
                editor={
                  editing === 'status' && (
                    <StateLadder
                      label="Knowledge"
                      options={KNOWLEDGE_OPTIONS}
                      value={location.status}
                      ariaLabel={`Knowledge of ${location.name}`}
                      onChange={(status: LocationStatus) =>
                        updateLocationStatus(location.id, status).then(closeEditor)
                      }
                    />
                  )
                }
                onEdit={canAct ? () => setEditing('status') : undefined}
                triggerRef={triggerRef('status')}
              >
                <Typography variant="body-sm" className="font-medium">
                  {formatLocationStatus(location.status)}
                </Typography>
              </EntityFact>

              <EntityFact
                label="Type"
                editor={
                  editing === 'type' && (
                    <Select
                      label="Type"
                      size="sm"
                      autoFocus
                      value={location.type}
                      onChange={(event) =>
                        void save({ type: event.target.value as LocationType }).then(closeEditor)
                      }
                      onBlur={closeEditor}
                    >
                      {TYPE_OPTIONS.map((type) => (
                        <option key={type} value={type}>
                          {formatLocationType(type)}
                        </option>
                      ))}
                    </Select>
                  )
                }
                onEdit={canAct ? () => setEditing('type') : undefined}
                triggerRef={triggerRef('type')}
              >
                <Typography variant="body-sm">{formatLocationType(location.type)}</Typography>
              </EntityFact>

              <EntityFact label="Inside">
                <Typography variant="body-sm">
                  {insideCount > 0
                    ? `${insideCount} place${insideCount === 1 ? '' : 's'}`
                    : 'Nothing yet'}
                </Typography>
              </EntityFact>

              <EntityFact label="Last visited">
                {location.lastVisited && (
                  <Typography variant="body-sm">{formatNoteDate(location.lastVisited)}</Typography>
                )}
              </EntityFact>
            </>
          }
          aside={
            <>
              {/* ---------------------------- who is here --------------------------- */}
              <EntityPageSection
                title="Who is here"
                muted
                count={peopleHere.length || undefined}
                empty={
                  !canAct ? (
                    <Typography variant="body-sm" color="muted" className="italic">
                      Nobody recorded here yet
                    </Typography>
                  ) : undefined
                }
              >
                {peopleHere.length ? (
                  <ul className="flex flex-col gap-1 list-none p-0 m-0">
                    {peopleHere.map((npc) => (
                      <li
                        key={npc.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 selectable-item"
                      >
                        <EntitySigil entityId={npc.id} name={npc.name} size={20} />
                        <button
                          type="button"
                          onClick={() => navigateToPage(`/npcs/${npc.id}`)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="font-heading block truncate">{npc.name}</span>
                          {npc.title && (
                            <Typography
                              variant="body-sm"
                              color="secondary"
                              className="block text-xs truncate"
                            >
                              {npc.title}
                            </Typography>
                          )}
                        </button>
                        {canAct && (
                          <button
                            type="button"
                            aria-label={`Remove ${npc.name} from ${location.name}`}
                            onClick={() => here && void links.unlink(here, { kind: 'npc', id: npc.id })}
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
                    // `15-4` passed `[]` here to stop the tray drawing chips
                    // under the list that already names everyone. The side
                    // effect was that the tray then offered "Attach" beside
                    // someone who was already attached. `15-5` gave the tray a
                    // way to say both things at once.
                    attached={attachRefs('npc', personIds)}
                    showAttachedChips={false}
                    ariaLabel={`the people in ${location.name}`}
                    onAttach={(id) => here && void links.link(here, { kind: 'npc', id })}
                    onDetach={(id) => here && void links.unlink(here, { kind: 'npc', id })}
                  />
                )}
              </EntityPageSection>

              {/* ------------------------- quests and rumours ----------------------- */}
              <EntityPageSection
                title="Quests and rumours"
                muted
                count={inbound.length || undefined}
                empty={
                  !canAct ? (
                    <Typography variant="body-sm" color="muted" className="italic">
                      No quest or rumour is linked here yet
                    </Typography>
                  ) : undefined
                }
              >
                {inbound.length ? (
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
                          <ArrowUpRight size={14} aria-hidden="true" className="ml-auto shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {canAct && (
                  <AttachTray
                    kinds={['quest', 'rumor']}
                    sources={{ npc: npcs, location: locations, quest: quests, rumor: rumors ?? [] }}
                    attached={[...attachRefs('quest', questIds), ...attachRefs('rumor', rumorIds)]}
                    showAttachedChips={false}
                    ariaLabel={`the quests and rumours of ${location.name}`}
                    onAttach={(id, kind) => here && void links.link(here, { kind, id })}
                    onDetach={(id, kind) => here && void links.unlink(here, { kind, id })}
                  />
                )}
              </EntityPageSection>

              {/* -------------------------------- tags ------------------------------ */}
              <EntityPageSection title="Tags" muted>
                <div className="flex flex-wrap gap-2">
                  {(location.tags ?? []).map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full chip text-xs"
                    >
                      {tag}
                      {canAct && (
                        <button
                          type="button"
                          aria-label={`Remove the tag ${tag}`}
                          onClick={() =>
                            void save((current) => ({
                              tags: (current.tags ?? []).filter((t) => t !== tag),
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

                {canAct &&
                  (editing === 'tag' ? (
                    <InlineEditor
                      label="Add a tag"
                      rows={1}
                      submitLabel="Add tag"
                      maxLength={TEXT_LIMITS.line}
                      placeholder="hidden"
                      clearOnSave
                      onSubmit={(value) =>
                        save((current) => ({
                          tags: Array.from(new Set([...(current.tags ?? []), value])),
                        }))
                      }
                      onSaved={closeEditor}
                      onCancel={closeEditor}
                    />
                  ) : (
                    <FieldPrompt ref={triggerRef('tag')} onClick={() => setEditing('tag')}>
                      {(location.tags ?? []).length
                        ? 'Add another tag'
                        : 'How would you find this place again?'}
                    </FieldPrompt>
                  ))}
              </EntityPageSection>

              {/* ------------------------------ the record -------------------------- */}
              <EntityPageSection title="Record" muted>
                {/*
                  Created and last-modified are the only two points
                  `ContentAttribution` holds. Two facts, stated -- not a
                  timeline (§8).
                */}
                <AttributionInfo item={location} />
              </EntityPageSection>
            </>
          }
        >
          {/* ------------------------------- description ------------------------------ */}
          <EntityProse
            label="Description"
            editor={
              editing === 'description' && (
                <InlineEditor
                  label="Description"
                  helperText="A sentence or two about the place itself."
                  initialValue={location.description ?? ''}
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
            prompt="What is this place?"
          >
            {location.description && (
              // Serif: the one piece of running prose the page carries.
              <Typography className="font-serif italic text-lg leading-relaxed">
                {location.description}
              </Typography>
            )}
          </EntityProse>

          {/* ----------------------------- where this sits ---------------------------- */}
          <WhereThisSits
            location={location}
            locations={locations}
            canAct={canAct}
            onMove={(parentId) => moveLocation(location.id, parentId)}
            onAddInside={() => openQuickAdd('location', { parentId: location.id })}
            onOpen={(id) => navigateToPage(`/locations/${id}`)}
            focusParent={canAct && quickAddFocus === 'parent' && !location.parentId}
          />

          {/* ----------------------------- notable features --------------------------- */}
          <EntityPageSection
            title="Notable features"
            count={(location.features ?? []).length || undefined}
          >
            {(location.features ?? []).length ? (
              <ul className="flex flex-col divide-y card-divider list-none p-0 m-0">
                {(location.features ?? []).map((feature) => (
                  <li
                    key={feature}
                    className="flex items-center gap-3 py-2 first:pt-0 last:pb-0 min-h-[44px] sm:min-h-[38px]"
                  >
                    <Typography className="flex-1 min-w-0">{feature}</Typography>
                    {canAct && (
                      <>
                        {/*
                          §6.4: features are free text and children are
                          documents. Promote is the one action that moves a
                          name across, for when the party actually arrives.
                        */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void promoteFeature(feature)}
                        >
                          Make it a place
                        </Button>
                        <button
                          type="button"
                          aria-label={`Remove the feature ${feature}`}
                          onClick={() =>
                            void save((current) => ({
                              features: (current.features ?? []).filter(
                                (f) => f !== feature
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
                ))}
              </ul>
            ) : null}

            {canAct &&
              (editing === 'feature' ? (
                <InlineEditor
                  label="Add a feature"
                  helperText="Free text. A feature becomes a place of its own only when you promote it."
                  rows={1}
                  submitLabel="Add feature"
                  maxLength={TEXT_LIMITS.line}
                  placeholder="Seven gates"
                  clearOnSave
                  onSubmit={(value) =>
                    save((current) => ({ features: [...(current.features ?? []), value] }))
                  }
                  onSaved={closeEditor}
                  onCancel={closeEditor}
                />
              ) : (
                <FieldPrompt ref={triggerRef('feature')} onClick={() => setEditing('feature')}>
                  {(location.features ?? []).length
                    ? 'Add another feature'
                    : 'What would the party notice first?'}
                </FieldPrompt>
              ))}
          </EntityPageSection>

          {/* --------------------------------- notes -------------------------------- */}
          <EntityNotes
            notes={notes}
            canEdit={canAct}
            onAdd={addNote}
            onEdit={editNote}
            onDelete={deleteNote}
            placeholder="What happened here, and when"
          />
        </EntityPageShell>
      )}

      {location && (
        <DeleteLocationDialog
          isOpen={confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          name={location.name}
          childCount={insideCount}
          grandparentName={parentName}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
};

export default LocationDetailPage;
