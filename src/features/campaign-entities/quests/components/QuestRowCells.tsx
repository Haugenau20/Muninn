import React from 'react';
import clsx from 'clsx';
import { QuestStatus } from '../types';
import Typography from '../../../../core/components/Typography';
import { RosterName, RosterStatus, type RosterStatusTone } from 'core/components/Roster';

/** Column template shared by every row, so the columns line up across groups. */
export const QUEST_ROW_GRID =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.7fr)_130px_190px_26px]';

/**
 * Quest state on the shared valence ramp, best to worst.
 *
 * Completed is stop 0 and failed is stop 3 -- the ends of the ramp, which
 * resolve to the same values `outcome.succeeded` and `outcome.failed.ink`
 * always had, so a quest looks exactly as it did. Active is the middle rather
 * than the accent now, because the accent means "interactive" everywhere else
 * and a quest that is merely open is not an action.
 */
const STATUS_TONE: Record<QuestStatus, RosterStatusTone> = {
  completed: 'valence-0',
  active: 'valence-1',
  failed: 'valence-3',
};

/**
 * The progress bar's fill, per state.
 *
 * Spelled out rather than built as `progress-bar-${quest.status}`. A class
 * name assembled from a variable is invisible to grep, which is how a token
 * survives a migration that was supposed to delete it -- and this phase has
 * now been bitten by exactly that twice.
 */
const PROGRESS_FILL: Record<QuestStatus, string> = {
  active: 'progress-bar-open',
  completed: 'progress-bar-succeeded',
  failed: 'progress-bar-failed',
};

/** What a collapsed quest row shows, and nothing it does not. */
export interface QuestRowFacts {
  title: string;
  status: QuestStatus;
  /** Where it happens, already resolved to a name. */
  locationName?: string;
  objectivesDone: number;
  objectivesTotal: number;
}

/**
 * The cells of a collapsed quest row: title and place, state, objective
 * progress. Laid out on {@link QUEST_ROW_GRID}.
 *
 * A component of its own so the directory and the example under an empty one
 * (`QuestExample`, T150) draw the same row.
 */
const QuestRowCells: React.FC<{ quest: QuestRowFacts }> = ({ quest }) => {
  const { objectivesDone, objectivesTotal } = quest;

  return (
    <>
      {/* Where it happens is the line under the title, as an
          NPC's title is: every directory row is two lines. */}
      <RosterName name={quest.title} detail={quest.locationName} />

      <RosterStatus tone={STATUS_TONE[quest.status]}>
        {quest.status.charAt(0).toUpperCase() + quest.status.slice(1)}
      </RosterStatus>

      {/* Objective progress -- the detail that makes quests more than a
          plain roster entry, so it stays visible on the collapsed row. */}
      <div className="hidden md:flex flex-col gap-1 min-w-0">
        <Typography variant="body-sm" color="secondary" className="text-sm">
          {objectivesTotal > 0
            ? `${objectivesDone} of ${objectivesTotal} objectives`
            : 'No objectives'}
        </Typography>
        {objectivesTotal > 0 && (
          <div className="w-full rounded-full h-1.5 progress-container">
            <div
              className={clsx('rounded-full h-1.5', PROGRESS_FILL[quest.status])}
              style={{ width: `${(objectivesDone / objectivesTotal) * 100}%` }}
            />
          </div>
        )}
      </div>
    </>
  );
};

export default QuestRowCells;
