// src/features/campaign-entities/locations/components/LocationTreeRow.tsx
import React from 'react';
import { RosterRow } from 'core/components/Roster';
import { Location } from '../types';
import LocationRowCells, { LOCATION_ROW_GRID, describeInside } from './LocationRowCells';

export interface LocationTreeRowProps {
  location: Location;
  /** Logical depth. Keeps counting past four; the indent does not. */
  depth: number;
  expanded: boolean;
  /** Opens the row: the summary, and then whatever is inside it. */
  onToggle: () => void;
  highlighted?: boolean;
  /** "Beleriand · Gondolin" -- shown only in the flattened search results. */
  path?: string;
  insideCount: number;
  npcCount: number;
  questCount: number;
  /** The bounded summary, rendered under the row when it is open. */
  summary?: React.ReactNode;
  /** The rows for what is inside, rendered after the summary. */
  children?: React.ReactNode;
  /** A control before the row -- the batch actions' checkbox (T017). */
  leadingControl?: React.ReactNode;
  /** Ticked in selection mode. */
  selected?: boolean;
  /** The first row of its list, which draws no rule above it. */
  isFirst?: boolean;
}

/**
 * One place, at every depth, in the same row an NPC, a quest and a rumour
 * get: `RosterRow`, with the place's type on the line under its name and the
 * hierarchy carried by indent and a hairline rail.
 *
 * It used to draw a row of its own -- a twisty on the left, a smaller mark,
 * everything on one line -- and the location list read as a different
 * product from the three beside it (T063, reported with screenshots
 * 2026-10-06). The row is now the shared one, and only the cells are this
 * directory's.
 *
 * **The row opens the row.** A place with nothing inside still has its
 * summary to open into (§1.3), and the way to its page is *More info* inside
 * that summary (D41 -- the collapsed row is the highest-frequency surface and
 * does not get a second control).
 *
 * Rules inside a card, not cards inside cards: a parent's rows sit under it,
 * indented, rather than in a child record card (design language §5).
 */
export const LocationTreeRow: React.FC<LocationTreeRowProps> = ({
  location,
  depth,
  expanded,
  onToggle,
  highlighted = false,
  path,
  insideCount,
  npcCount,
  questCount,
  summary,
  children,
  leadingControl,
  selected = false,
  isFirst = false,
}) => {
  return (
    <RosterRow
      id={`location-${location.id}`}
      entityId={location.id}
      entityName={location.name}
      gridClassName={LOCATION_ROW_GRID}
      toggleLabel={location.name}
      depth={depth}
      expanded={expanded}
      onToggle={onToggle}
      expandedContent={summary}
      highlighted={highlighted}
      selected={selected}
      leadingControl={leadingControl}
      isFirst={isFirst}
      nested={expanded ? children : undefined}
    >
      <LocationRowCells
        location={location}
        path={path}
        inside={describeInside(insideCount, npcCount, questCount)}
      />
    </RosterRow>
  );
};

export default LocationTreeRow;
