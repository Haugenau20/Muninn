// src/features/campaign-entities/quests/example/index.ts
import { lazy } from "react";

/**
 * The quest page's signed-out example, loaded only when a signed-out
 * visitor opens the page: members never download the example campaign.
 */
export const QuestExample = lazy(() => import("./QuestExample"));
