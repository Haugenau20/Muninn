// src/features/campaign-entities/rumors/example/RumorExample.tsx
import React from "react";
import ExampleRegion from "shared/example-campaign/ExampleRegion";
import ExampleCampaignProvider from "../../example/ExampleCampaignProvider";
import { EXAMPLE_RECORDS } from "../../example/example-records";
import RumorDirectory from "../components/RumorDirectory";

/**
 * The rumour page as a signed-out visitor sees it: the real list, filled
 * from the example campaign, under the sign-in band. Its search, source
 * filter, status bands, folded False group and rows all work; an open row
 * shows the rumour as text rather than the editor, nothing is saved, and
 * the way to the quest it became stays where it is
 * (`ExampleCampaignProvider`).
 *
 * The night-ferry rumour starts open: confirmed, and become a quest.
 */
const RumorExample: React.FC = () => (
  <ExampleRegion caption="The Ashen Vale · try the filters">
    <ExampleCampaignProvider>
      <RumorDirectory rumors={EXAMPLE_RECORDS.rumors} canEdit={false} initialExpandedId="example-rumour-ferry" />
    </ExampleCampaignProvider>
  </ExampleRegion>
);

export default RumorExample;
