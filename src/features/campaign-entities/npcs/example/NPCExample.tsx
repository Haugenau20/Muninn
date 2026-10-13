// src/features/campaign-entities/npcs/example/NPCExample.tsx
import React from "react";
import ExampleRegion from "shared/example-campaign/ExampleRegion";
import ExampleCampaignProvider from "../../example/ExampleCampaignProvider";
import { EXAMPLE_RECORDS } from "../../example/example-records";
import NPCDirectory from "../components/NPCDirectory";

/**
 * The NPC page as a signed-out visitor sees it: the real directory, filled
 * from the example campaign, under the sign-in band. Its search, stance
 * filters, status bands and rows all work; nothing it does is saved, and
 * More info and Open location stay where they are (`ExampleCampaignProvider`).
 *
 * Vesk Harrow's row starts open, so a visitor sees that a row holds more.
 */
const NPCExample: React.FC = () => (
  <ExampleRegion caption="The Ashen Vale · try the filters">
    <ExampleCampaignProvider>
      <NPCDirectory npcs={EXAMPLE_RECORDS.npcs} canEdit={false} initialExpandedId="example-npc-vesk" />
    </ExampleCampaignProvider>
  </ExampleRegion>
);

export default NPCExample;
