import React from 'react';
import { RosterRow } from 'core/components/Roster';
import ExampleRegion from 'shared/example-campaign/ExampleRegion';
import { EXAMPLE_CAMPAIGN } from 'shared/example-campaign/example-campaign';
import NPCRowCells, { NPC_ROW_GRID } from './NPCRowCells';

/**
 * The example campaign's people, under the NPC page's sign-in band (T150):
 * the rows the directory draws, inert, so a stranger can see what this page
 * holds.
 */
const NPCExample: React.FC = () => (
  <ExampleRegion caption="The Ashen Vale · fourteen sessions in">
    <div className="rounded-lg overflow-hidden card">
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
    </div>
  </ExampleRegion>
);

export default NPCExample;
