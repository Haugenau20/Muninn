// src/features/campaign-entities/quests/example/QuestExample.tsx
import React from "react";
import ExampleRegion from "shared/example-campaign/ExampleRegion";
import ExampleCampaignProvider from "../../example/ExampleCampaignProvider";
import { EXAMPLE_RECORDS } from "../../example/example-records";
import QuestDirectory from "../components/QuestDirectory";

/**
 * The quest page as a signed-out visitor sees it: the real quest log, filled
 * from the example campaign, under the sign-in band. Its search, place
 * filter, status bands, folded history and rows all work; nothing it does is
 * saved, and the ways out of a row stay where they are
 * (`ExampleCampaignProvider`).
 *
 * The drowned ledger starts open, so a visitor sees a quest's objectives.
 */
const QuestExample: React.FC = () => (
  <ExampleRegion caption="The Ashen Vale · try the filters">
    <ExampleCampaignProvider>
      <QuestDirectory quests={EXAMPLE_RECORDS.quests} canEdit={false} initialExpandedId="example-quest-ledger" />
    </ExampleCampaignProvider>
  </ExampleRegion>
);

export default QuestExample;
