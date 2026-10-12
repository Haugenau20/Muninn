// src/features/campaign-entities/locations/components/LocationExample.tsx
import React from 'react';
import { RosterExample, RosterRow } from 'core/components/Roster';
import { EXAMPLE_CAMPAIGN } from 'shared/example-campaign/example-campaign';
import LocationRowCells, { LOCATION_ROW_GRID, describeInside } from './LocationRowCells';

const { locations, npcs, quests } = EXAMPLE_CAMPAIGN;

/** How deep a place sits in the example's tree; the example is shallow. */
const depthOf = (id: string | undefined): number => {
  const parent = locations.find((place) => place.id === id)?.parentId;
  return parent ? 1 + depthOf(parent) : 0;
};

/**
 * The example campaign's places, under the location list's empty state
 * (T150): the rows the tree draws, inert, so a new campaign can see what this
 * page will hold -- a town indented inside its region included. The fixture
 * lists each parent before what is inside it.
 */
const LocationExample: React.FC = () => (
  <RosterExample>
    {locations.map((place, index) => (
      <RosterRow
        key={place.id}
        entityId={place.id}
        entityName={place.name}
        gridClassName={LOCATION_ROW_GRID}
        toggleLabel={place.name}
        depth={depthOf(place.id)}
        isFirst={index === 0}
        inert
      >
        <LocationRowCells
          location={place}
          inside={describeInside(
            locations.filter((inner) => inner.parentId === place.id).length,
            npcs.filter((npc) => npc.locationId === place.id).length,
            quests.filter((quest) => quest.locationId === place.id).length
          )}
        />
      </RosterRow>
    ))}
  </RosterExample>
);

export default LocationExample;
