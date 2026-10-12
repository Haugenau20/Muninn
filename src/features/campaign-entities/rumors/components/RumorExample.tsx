import React from 'react';
import { RosterExample, RosterRow } from 'core/components/Roster';
import { EXAMPLE_CAMPAIGN } from 'shared/example-campaign/example-campaign';
import RumorRowCells, { RUMOR_ROW_GRID } from './RumorRowCells';

/**
 * The example campaign's rumours, under the rumour page's sign-in panel
 * (T150): the rows the directory draws, inert, so a stranger can see what this
 * page holds.
 */
const RumorExample: React.FC = () => (
  <RosterExample>
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
            convertedToQuest: false,
            unsaved: false,
          }}
        />
      </RosterRow>
    ))}
  </RosterExample>
);

export default RumorExample;
