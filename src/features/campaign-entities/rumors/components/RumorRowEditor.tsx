// src/features/campaign-entities/rumors/components/RumorRowEditor.tsx
import React, { useEffect, useRef, useState } from 'react';
import PublishButton from 'shared/components/private/PublishButton';
import { usePublish } from '../../shared/private/usePublish';
import { TEXT_LIMITS } from 'core/constants/textLimits';
import Button from 'core/components/Button';
import Input from 'core/components/Input';
import Typography from 'core/components/Typography';
import AttachTray from 'shared/components/attach-tray/AttachTray';
import {
  attachRefs,
  type AttachKind,
  type AttachSources,
} from 'shared/components/attach-tray/attachCandidates';
import StateLadder from 'shared/components/row-controls/StateLadder';
import { formatCalendarDate } from 'shared/utils/dateFormatter';
import { recordTimes } from 'core/attribution';
import useCreatorName from 'shared/hooks/useCreatorName';
import { Rumor, RumorNote, RumorStatus, SourceType } from '../types';
import { useCampaignRecordNotes } from '../../shared/recordNotes';
import {
  RUMOR_STATUS_OPTIONS,
  SOURCE_OPTIONS,
  formatRumorStatus,
  normalizeRumorStatus,
} from '../utils/rumor-presentation';
import { rumorTitleText, UNTITLED_RUMOR } from '../utils/rumor-title';
import { deriveTitle } from 'shared/utils/derived-title';

/**
 * The typed half of a rumour: what a reader can change and then discard.
 *
 * Held by the **directory**, not by this component, keyed by rumour id. That
 * is the whole point of the arrangement: filtering, sorting, or another
 * player's status change re-renders the list underneath an open editor, and a
 * draft living in the editor's own state dies with it. `15-7` item 8 names
 * this as the failure most likely to bite, and it is the one thing here that
 * could not be fixed after the fact by a careful reader.
 */
export interface RumorDraft {
  title: string;
  content: string;
  /** Absent until somebody says where it came from. See `Rumor.sourceType`. */
  sourceType?: SourceType | null;
  sourceName: string;
  sourceNpcId?: string;
}

/**
 * Has this draft actually changed anything?
 *
 * Lives beside `RumorDraft` rather than inside the editor because **two
 * places need the same answer**: the editor, to decide whether Save is
 * offered, and the directory, to mark a row as carrying unsaved text and to
 * arm the leave-the-page guard. Two copies of this comparison drifting apart
 * is exactly how an "unsaved" marker starts lying.
 */
export const isDraftDirty = (rumor: Rumor, draft?: RumorDraft): boolean => {
  if (!draft) return false;
  return (
    draft.title !== (rumor.title ?? '') ||
    draft.content !== (rumor.content ?? '') ||
    (draft.sourceType ?? null) !== (rumor.sourceType ?? null) ||
    draft.sourceName !== (rumor.sourceName ?? '') ||
    (draft.sourceNpcId ?? '') !== (rumor.sourceNpcId ?? '')
  );
};

export const draftFromRumor = (rumor: Rumor): RumorDraft => ({
  title: rumor.title ?? '',
  content: rumor.content ?? '',
  sourceType: rumor.sourceType,
  sourceName: rumor.sourceName ?? '',
  sourceNpcId: rumor.sourceNpcId,
});

export interface RumorRowEditorProps {
  rumor: Rumor;
  /** The live draft for this rumour, or `undefined` before anything is typed. */
  draft?: RumorDraft;
  onDraftChange: (patch: Partial<RumorDraft>) => void;
  /** Must reject on failure — nothing here claims success before it resolves. */
  onSave: (draft: RumorDraft) => Promise<void>;
  /** Discard the draft and close the row. */
  onCollapse: () => void;
  onDelete: () => Promise<void>;
  onStatusChange: (status: RumorStatus) => Promise<unknown>;
  /** Attach and detach write immediately, as every other tray in the app does. */
  onAttach: (id: string, kind: AttachKind) => Promise<unknown>;
  onDetach: (id: string, kind: AttachKind) => Promise<unknown>;
  sources: AttachSources;
  /** Take the caret on mount — true for a rumour just created by the composer. */
  autoFocus?: boolean;
  /** Where to go from a converted rumour. */
  onOpenQuest?: (questId: string) => void;
  /**
   * The group this row will move to once it closes, when that is not the group
   * it is currently sitting in. See `RumorDirectory`'s `pinnedGroup`: the row
   * holds its place while open so a status change cannot throw it across the
   * page mid-edit, and this is how it says so rather than quietly lying.
   */
  movesTo?: RumorStatus | null;
}

/** The uppercase micro-label each part of the row is introduced by. */
const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography
    variant="body-sm"
    color="muted"
    className="text-[11px] font-semibold uppercase tracking-wider"
  >
    {children}
  </Typography>
);

/**
 * One rumour, in full, inside its own row.
 *
 * **This is the entity that gets no page** (§2.1). A rumour is seven fields,
 * one of which is a paragraph, and its two real operations -- combine, and
 * convert to a quest -- already act on a selection in the list. Nothing in the
 * campaign points at a rumour, so there is no link that needs an address. What
 * it needed was to stop sending someone to `/rumors/edit/:id` to change
 * "unconfirmed" to "confirmed".
 *
 * So §1.3's bound on an expanded row -- four facts, readable while scanning
 * five of them -- **does not apply here**, and this is the one place in the
 * phase where that is true: there is no page holding the remainder, so the row
 * holds all of it.
 *
 * Two kinds of write live side by side, deliberately:
 *
 * - **The typed fields** (title, what was heard, who exactly) are a draft with
 *   a Save, because they are one thought and half of it is not worth writing.
 * - **The ladder and the trays** write immediately, because each is a single
 *   act with its own result, and because "confirm this rumour" must be one
 *   click from the list (the gate says so).
 */
export const RumorRowEditor: React.FC<RumorRowEditorProps> = ({
  rumor,
  draft,
  onDraftChange,
  onSave,
  onCollapse,
  onDelete,
  onStatusChange,
  onAttach,
  onDetach,
  sources,
  autoFocus = false,
  onOpenQuest,
  movesTo = null,
}) => {
  const current = draft ?? draftFromRumor(rumor);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'failed' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const publish = usePublish();
  const titleRef = useRef<HTMLInputElement>(null);
  // Named as the rumour's attribution names it everywhere else (T124).
  const recordedBy = useCreatorName(rumor);
  // Its notes: their own documents (T133), read only while the row is open.
  const notes = useCampaignRecordNotes<RumorNote>('rumors', rumor.id);

  // A rumour the composer just created opens with the caret in the *title*.
  // This was the content field, back when the composer took a title and left
  // the body empty; both ends have swapped. What was heard is already
  // recorded, so the only thing still missing is a short name for it — and
  // that can be left blank, which is why this is a caret and not a
  // requirement.
  useEffect(() => {
    if (autoFocus) {
      titleRef.current?.focus();
    }
  }, [autoFocus]);

  /**
   * Has anybody said where this came from?
   *
   * `sourceType` is now genuinely absent until someone picks one -- including
   * *Other*, which is a real answer meaning "none of the other four" rather
   * than the create form's old default for "nobody said". A legacy record
   * carrying a name but no kind still counts as chosen, because hiding written
   * text would be worse than showing it under an unchosen heading.
   */
  const sourceChosen = Boolean(current.sourceType) || Boolean(current.sourceName);

  /**
   * What the row will call this rumour if the title is left empty — shown as
   * the field's placeholder so the consequence of leaving it blank is visible
   * while you are deciding whether to.
   */
  const derivedTitle = deriveTitle(current.content) || UNTITLED_RUMOR;

  /** What this rumour is called in the labels screen readers announce. */
  const name = rumorTitleText(rumor);

  const dirty = isDraftDirty(rumor, current);

  const handleSave = async () => {
    // A title is no longer required -- the list names an untitled rumour from
    // its content. What cannot be saved is a rumour that says nothing at all,
    // which is the only state from which no row could be rendered.
    if (!current.title.trim() && !current.content.trim()) {
      setError('A rumour needs something written down.');
      setSaveState('failed');
      return;
    }
    setSaveState('saving');
    setError(null);
    try {
      await onSave({ ...current, title: current.title.trim() });
      setSaveState('saved');
    } catch (err) {
      // The typed value is untouched on purpose (§7).
      setSaveState('failed');
      setError(err instanceof Error ? err.message : 'Could not save. Your text is still here.');
    }
  };

  const attached = [
    ...attachRefs('npc', rumor.relatedNPCs ?? []),
    ...attachRefs('location', [...(rumor.relatedLocations ?? []), rumor.locationId]),
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-7 pt-4">
      {/* ------------------------------ the record ----------------------------- */}
      <div className="flex flex-col gap-4">
        {/*
          What was heard comes first now, because it is what the composer
          wrote and what the record actually is. The title below it is the
          shorter name you give it afterwards, if you ever do.
        */}
        <div className="flex flex-col gap-1.5">
          <Input
            isTextArea
            rows={3}
            label="What was heard"
            placeholder="Drovers coming down from Harrowgate say the Ironmouth road is busy again after dark."
            value={current.content}
            maxLength={TEXT_LIMITS.text}
            onChange={(event) => onDraftChange({ content: event.target.value })}
            disabled={saveState === 'saving'}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Input
            ref={titleRef as React.Ref<HTMLInputElement>}
            label="Call it"
            // Not a suggestion to type -- a preview of what the list will
            // show if this is left empty, which is a perfectly good outcome.
            placeholder={derivedTitle}
            value={current.title}
            maxLength={TEXT_LIMITS.line}
            onChange={(event) => onDraftChange({ title: event.target.value })}
            disabled={saveState === 'saving'}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Heard from</FieldLabel>
            {/*
              Four buttons, not a select (item 4). A dropdown for four short
              options hides three of them behind a click and says nothing the
              buttons do not.
            */}
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Heard from">
              {SOURCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={current.sourceType === option.value}
                  onClick={() => {
                    // Pressing the chosen kind again clears it. Every one of
                    // the five is now a real answer, so "nobody has said yet"
                    // needs a way back -- otherwise the first accidental tap
                    // is permanent.
                    // `null`, not `undefined`: this value reaches Firestore on
                    // Save, and an undefined there throws. See `Rumor.sourceType`.
                    const next =
                      current.sourceType === option.value ? null : option.value;
                    onDraftChange({
                      sourceType: next,
                      // Changing the kind away from an NPC drops the id: it
                      // named a record that no longer describes the source.
                      ...(next === 'npc' ? {} : { sourceNpcId: undefined }),
                    });
                  }}
                  // 44px on a phone, as the ladder beside it is.
                  className={`px-3 py-1 rounded-full text-sm min-h-[44px] sm:min-h-[32px] chip-toggle ${
                    current.sourceType === option.value ? 'chip-toggle-selected' : ''
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/*
            "Who exactly" appears only once a kind is chosen, and becomes an
            NPC picker when the kind is *An NPC* (item 3). That conditional
            already existed in `RumorForm` and is carried over rather than
            reinvented.
          */}
          {sourceChosen && (
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Who exactly</FieldLabel>
              {current.sourceType === 'npc' ? (
                <AttachTray
                  kinds={['npc']}
                  sources={sources}
                  attached={attachRefs('npc', [current.sourceNpcId])}
                  single
                  ariaLabel={`the source of ${name}`}
                  onAttach={(id) => {
                    const npc = (sources.npc ?? []).find((candidate: any) => candidate.id === id);
                    onDraftChange({ sourceNpcId: id, sourceName: npc?.name ?? '' });
                  }}
                  onDetach={() => onDraftChange({ sourceNpcId: undefined, sourceName: '' })}
                />
              ) : (
                <Input
                  // Named by the heading above it rather than by a second
                  // label repeating the same three words.
                  aria-label="Who exactly"
                  placeholder="Trader on the East Road"
                  value={current.sourceName}
                  maxLength={TEXT_LIMITS.line}
                  onChange={(event) => onDraftChange({ sourceName: event.target.value })}
                  disabled={saveState === 'saving'}
                />
              )}
            </div>
          )}
        </div>

        {/*
          Status is the knowledge ladder, not a verdict, and it writes on the
          click rather than waiting for Save: confirming a rumour mid-session
          is the one thing this list exists for.
        */}
        <div className="flex flex-col gap-1.5">
          <StateLadder
            label="Is it true?"
            options={RUMOR_STATUS_OPTIONS}
            value={normalizeRumorStatus(rumor.status)}
            ariaLabel={`Status of ${name}`}
            onChange={onStatusChange}
          />
          {/*
            Said out loud, because the row is deliberately in the wrong group
            for as long as it is open. Without this the list would be showing
            a rumour marked Confirmed under an Unconfirmed heading and saying
            nothing about it.
          */}
          {movesTo && (
            <Typography variant="body-sm" color="muted" className="text-xs">
              {`Moves to ${formatRumorStatus(movesTo)} when you close this.`}
            </Typography>
          )}
        </div>

        <div className="border-t divider pt-3 flex items-center gap-3 flex-wrap">
          <Button
            size="sm"
            className="min-h-[44px] sm:min-h-[32px]"
            onClick={() => void handleSave()}
            disabled={saveState === 'saving' || !dirty}
          >
            {saveState === 'saving' ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-[44px] sm:min-h-[32px]"
            onClick={onCollapse}
            disabled={saveState === 'saving'}
          >
            Collapse
          </Button>

          <span role="status" aria-live="polite" className="min-h-[1rem]">
            {saveState === 'saved' && !dirty && (
              <Typography variant="body-sm" color="secondary">
                Saved
              </Typography>
            )}
          </span>

          <div className="ml-auto flex items-center gap-2">
            {/* A private rumour is published from its row: it has no page (T163). */}
            {rumor.isPrivate && !confirmingDelete && (
              <PublishButton publish={publish} kind="rumor" id={rumor.id} name={name} />
            )}
            {confirmingDelete ? (
              <>
                <Typography variant="body-sm" color="secondary">
                  Delete this rumour for everyone?
                </Typography>
                <Button
                  variant="ghost"
                  size="sm"
                  className="delete-button min-h-[44px] sm:min-h-[32px]"
                  disabled={deleting}
                  onClick={() => {
                    setDeleting(true);
                    setError(null);
                    void onDelete()
                      .catch((err: unknown) =>
                        setError(
                          err instanceof Error ? err.message : 'Could not delete this rumour.'
                        )
                      )
                      .finally(() => {
                        setDeleting(false);
                        setConfirmingDelete(false);
                      });
                  }}
                >
                  {deleting ? 'Deleting…' : `Delete ${name}`}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-[44px] sm:min-h-[32px]"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Keep it
                </Button>
              </>
            ) : (
              /*
                Asked once, in the row rather than in a dialog: a rumour is a
                line of text with no children and nothing pointing at it, so
                the blast radius is the line itself. Phase 14 §1 question 1 --
                this is not a decision *about* the list, it is an act on one
                entry of it.
              */
              <Button
                variant="ghost"
                size="sm"
                className="delete-button min-h-[44px] sm:min-h-[32px]"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            )}
          </div>
        </div>

        {error && (
          <Typography variant="body-sm" color="error" role="alert">
            {error}
          </Typography>
        )}
      </div>

      {/* ------------------------------ points at ------------------------------ */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Points at</FieldLabel>
          {/*
            One tray over people and places, replacing a flat `<select>` of
            every location in the campaign (item 7). It writes immediately, as
            every other tray in the product does.
          */}
          <AttachTray
            kinds={['npc', 'location']}
            sources={sources}
            attached={attached}
            ariaLabel={`what ${name} points at`}
            onAttach={(id, kind) => void onAttach(id, kind)}
            onDetach={(id, kind) => void onDetach(id, kind)}
          />
        </div>

        {notes.length ? (
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Notes</FieldLabel>
            <div className="flex flex-col gap-2">
              {notes.map((note) => (
                <div key={note.noteId} className="flex gap-3 px-3 py-2.5 rounded-md bg-secondary">
                  {/* Formatted, from the one shared helper (item 10, T001). */}
                  <Typography
                    variant="body-sm"
                    color="muted"
                    className="text-xs whitespace-nowrap tabular-nums"
                  >
                    {/* When it was written, by the server's clock (T132). */}
                    {formatCalendarDate(recordTimes(note).created ?? new Date())}
                  </Typography>
                  <Typography variant="body-sm">{note.content}</Typography>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {rumor.convertedToQuestId && onOpenQuest && (
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Became a quest</FieldLabel>
            <button
              type="button"
              onClick={() => onOpenQuest(rumor.convertedToQuestId!)}
              className="flex items-center gap-2 text-left px-2.5 py-1.5 rounded-md selectable-item"
            >
              <Typography variant="body-sm">Open the quest</Typography>
            </button>
          </div>
        )}

        {recordedBy && (
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Recorded by</FieldLabel>
            <Typography variant="body-sm">{recordedBy}</Typography>
          </div>
        )}
      </div>
    </div>
  );
};

export default RumorRowEditor;
