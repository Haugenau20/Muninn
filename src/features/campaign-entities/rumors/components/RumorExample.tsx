import React from 'react';
import { RosterRow } from 'core/components/Roster';
import ExampleRegion from 'shared/example-campaign/ExampleRegion';
import { EXAMPLE_CAMPAIGN } from 'shared/example-campaign/example-campaign';
import RumorRowCells, { RUMOR_ROW_GRID } from './RumorRowCells';

/**
 * The example campaign's rumours, under the rumour page's sign-in band
 * (T150): the rows the directory draws, inert, so a stranger can see what this
 * page holds.
 */
const RumorExample: React.FC = () => (
  <ExampleRegion caption="The Ashen Vale · fourteen sessions in">
    <div className="rounded-lg overflow-hidden card">
    {EXAMPLE_CAMPAIGN.rumours.map((rumour, index) => (
      <RosterRow
        key={rumour.id}
        entityId={rumour.id}
        entityName={rumour.title}
        gridClassName={RUMOR_ROW_GRID}
        toggleLabel={rumour.title}
        isFirst={index === 0}
        inert
      >
        <RumorRowCells
          rumor={{
            name: rumour.title,
            untitled: false,
            sourceName: rumour.sourceName,
            status: rumour.status,
            sourceType: rumour.sourceType,
            convertedToQuest: Boolean(rumour.convertedToQuestId),
            unsaved: false,
          }}
        />
      </RosterRow>
    ))}
    </div>
  </ExampleRegion>
);

export default RumorExample;
