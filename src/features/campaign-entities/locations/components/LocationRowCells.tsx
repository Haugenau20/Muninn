// src/features/campaign-entities/locations/components/LocationRowCells.tsx
import React from 'react';
import Typography from 'core/components/Typography';
import { RosterName, RosterStatus } from 'core/components/Roster';
import { Location } from '../types';
import {
  formatLocationStatus,
  formatLocationType,
  STATUS_TONE,
} from '../utils/location-presentation';

/**
 * Every column after the name is a fixed width, so a nested row's indent comes
 * out of the name alone and its knowledge step and counts stay under the ones
 * above it.
 */
export const LOCATION_ROW_GRID =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_112px_200px_26px]';

/**
 * What a place holds, as the row's last cell says it: "2 inside · 1 NPC".
 * Empty when it holds nothing.
 */
export const describeInside = (insideCount: number, npcCount: number, questCount: number): string =>
  [
    insideCount ? `${insideCount} inside` : undefined,
    npcCount ? `${npcCount} NPC${npcCount === 1 ? '' : 's'}` : undefined,
    questCount ? `${questCount} quest${questCount === 1 ? '' : 's'}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

/** What a collapsed location row shows, and nothing it does not. */
export type LocationRowFacts = Pick<Location, 'name' | 'type' | 'status'>;

export interface LocationRowCellsProps {
  location: LocationRowFacts;
  /** "Beleriand · Gondolin" -- shown only in the flattened search results. */
  path?: string;
  /** What the place holds, from {@link describeInside}. */
  inside: string;
}

/**
 * The cells of a collapsed location row: name and type, knowledge step, what
 * it holds. Laid out on {@link LOCATION_ROW_GRID}.
 *
 * A component of its own so the tree and the example under an empty one
 * (`LocationExample`, T150) draw the same row.
 */
const LocationRowCells: React.FC<LocationRowCellsProps> = ({ location, path, inside }) => (
  <>
    <RosterName
      name={location.name}
      detail={
        <>
          {formatLocationType(location.type)}
          {path && (
            // Only in the flattened search results: a hit with no path is a
            // name with no context (§6.1).
            <>
              {' · '}
              <span>in {path}</span>
            </>
          )}
        </>
      }
    />

    <RosterStatus tone={STATUS_TONE[location.status]}>
      {formatLocationStatus(location.status)}
    </RosterStatus>

    <Typography
      variant="body-sm"
      color="secondary"
      className="hidden md:block text-sm truncate"
    >
      {inside}
    </Typography>
  </>
);

export default LocationRowCells;
