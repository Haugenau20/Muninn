import React from 'react';
import { RosterExample, RosterRow } from 'core/components/Roster';
import { EXAMPLE_CAMPAIGN } from 'shared/example-campaign/example-campaign';
import NPCRowCells, { NPC_ROW_GRID } from './NPCRowCells';

/**
 * The example campaign's people, under the NPC page's sign-in panel (T150):
 * the rows the directory draws, inert, so a stranger can see what this page
 * holds.
 */
const NPCExample: React.FC = () => (
  <RosterExample>
    {EXAMPLE_CAMPAIGN.npcs.map((npc, index) => (
      <RosterRow
        key={npc.id}
        entityId={npc.id}
        entityName={npc.name}
        gridClassName={NPC_ROW_GRID}
        toggleLabel={npc.name}
        isFirst={index === 0}
        inert
      >
        <NPCRowCells npc={npc} />
      </RosterRow>
    ))}
  </RosterExample>
);

export default NPCExample;
