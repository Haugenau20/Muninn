// src/features/campaign-entities/locations/example/LocationExample.tsx
import React from "react";
import ExampleRegion from "shared/example-campaign/ExampleRegion";
import ExampleCampaignProvider from "../../example/ExampleCampaignProvider";
import { EXAMPLE_RECORDS } from "../../example/example-records";
import LocationDirectory from "../components/LocationDirectory";

/** The region, open: its summary, and the places inside it. */
const OPEN_FROM_THE_START = ["example-location-vale"];

/**
 * The location page as a signed-out visitor sees it: the real tree, filled
 * from the example campaign, under the sign-in band. Its search, type
 * filters, status bands and rows all work; nothing it does is saved, and
 * More info stays where it is (`ExampleCampaignProvider`). The region starts
 * open, so a visitor sees places inside places.
 */
const LocationExample: React.FC = () => (
  <ExampleRegion caption="The Ashen Vale · try the filters">
    <ExampleCampaignProvider>
      <LocationDirectory
        locations={EXAMPLE_RECORDS.locations}
        canEdit={false}
        initialExpandedIds={OPEN_FROM_THE_START}
      />
    </ExampleCampaignProvider>
  </ExampleRegion>
);

export default LocationExample;
