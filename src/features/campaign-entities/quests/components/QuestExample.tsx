import React from 'react';
import { RosterExample, RosterRow } from 'core/components/Roster';
import { EXAMPLE_CAMPAIGN } from 'shared/example-campaign/example-campaign';
import QuestRowCells, { QUEST_ROW_GRID } from './QuestRowCells';

/** The example's place names, for the line under each quest's title. */
const PLACE_NAME = new Map(EXAMPLE_CAMPAIGN.locations.map((place) => [place.id, place.name]));

/**
 * The example campaign's quests, under the quest page's sign-in panel (T150):
 * the rows the directory draws, inert, so a stranger can see what this page
 * holds.
 */
const QuestExample: React.FC = () => (
  <RosterExample>
    {EXAMPLE_CAMPAIGN.quests.map((quest, index) => (
      <RosterRow
        key={quest.id}
        entityId={quest.id}
        entityName={quest.title}
        gridClassName={QUEST_ROW_GRID}
        toggleLabel={quest.title}
        isFirst={index === 0}
        inert
      >
        <QuestRowCells
          quest={{
            title: quest.title,
            status: quest.status,
            locationName: PLACE_NAME.get(quest.locationId),
            objectivesDone: quest.objectivesDone,
            objectivesTotal: quest.objectivesTotal,
          }}
        />
      </RosterRow>
    ))}
  </RosterExample>
);

export default QuestExample;
