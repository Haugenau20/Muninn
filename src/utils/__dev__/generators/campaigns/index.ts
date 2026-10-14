// src/utils/__dev__/generators/campaigns/index.ts

import type { CampaignSeed } from "./types";
import { ASHEN_VALE } from "./ashenVale";
import { WINTER_ROAD } from "./winterRoad";
import { COPPER_CANALS } from "./copperCanals";
import { THORNWICK_HILL } from "./thornwickHill";

/**
 * The four sample campaigns, two to a group. Each group's first is the one
 * its members land in (`activeCampaignId` in `addUsersToGroups`).
 */
export const SAMPLE_CAMPAIGNS: readonly CampaignSeed[] = [
  ASHEN_VALE,
  WINTER_ROAD,
  COPPER_CANALS,
  THORNWICK_HILL,
];
