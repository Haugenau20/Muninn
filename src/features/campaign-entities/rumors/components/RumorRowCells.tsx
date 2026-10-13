import React from 'react';
import { Scroll } from 'lucide-react';
import { Rumor } from '../types';
import Typography from '../../../../core/components/Typography';
import { RosterName, RosterStatus } from 'core/components/Roster';
import {
  RUMOR_STATUS_TONE,
  formatRumorStatus,
  formatSourceType,
  normalizeRumorStatus,
} from '../utils/rumor-presentation';

/** Column template shared by every row, so the columns line up across groups. */
export const RUMOR_ROW_GRID =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.6fr)_128px_128px_150px_26px]';

/** What a collapsed rumour row shows, and nothing it does not. */
export interface RumorRowFacts {
  /** The title shown, or the placeholder an untitled rumour gets. */
  name: string;
  /** No title of its own: the name is the placeholder, drawn muted. */
  untitled: boolean;
  sourceName?: string;
  status: Rumor['status'];
  sourceType?: Rumor['sourceType'];
  convertedToQuest: boolean;
  /** An edit held across a route change and not saved yet. */
  unsaved: boolean;
}

/**
 * The cells of a collapsed rumour row: title and source, status, source type,
 * whether it became a quest. Laid out on {@link RUMOR_ROW_GRID}.
 *
 * A component of its own so the directory and the example a signed-out
 * visitor sees (`RumorExample`, T150) draw the same row.
 */
const RumorRowCells: React.FC<{ rumor: RumorRowFacts }> = ({ rumor }) => (
  <>
    {/* The "Quest" pill that sat by the name is gone: the last cell
        in the same row already reads "Converted to quest", so the
        pill was the same fact a second time, in a box. */}
    <RosterName
      name={rumor.name}
      // An unnamed rumour reads as unfinished rather than as
      // a record actually called "Untitled rumour".
      muted={rumor.untitled}
      detail={rumor.sourceName}
      badge={
        /*
          Loud on purpose. Keeping a draft across a route change
          is only an improvement if the row says it is holding
          one -- otherwise persistence is just a quieter way to
          lose work, because you would believe you had saved.
        */
        rumor.unsaved ? (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-xs feedback-warning-edge chip-toggle chip-toggle-selected">
            Unsaved
          </span>
        ) : undefined
      }
    />

    {/*
      A false rumour is red and struck through: the strike keeps
      it apart from confirmed without relying on hue alone.
    */}
    <RosterStatus
      tone={RUMOR_STATUS_TONE[normalizeRumorStatus(rumor.status)]}
      negated={normalizeRumorStatus(rumor.status) === 'false'}
    >
      {formatRumorStatus(rumor.status)}
    </RosterStatus>

    {/* Source type, stated once and plainly -- it was a filled chip
        saying what a plain label says. An em dash means nobody has
        said where this came from. */}
    <Typography
      variant="body-sm"
      color="secondary"
      className="hidden md:block justify-self-start text-sm"
    >
      {formatSourceType(rumor.sourceType)}
    </Typography>

    <Typography
      variant="body-sm"
      color="secondary"
      className="hidden md:flex items-center gap-1.5 text-sm truncate"
    >
      {rumor.convertedToQuest ? (
        <>
          <Scroll size={13} className="shrink-0" aria-hidden="true" />
          Converted to quest
        </>
      ) : (
        '—'
      )}
    </Typography>
  </>
);

export default RumorRowCells;
