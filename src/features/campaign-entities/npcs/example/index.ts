// src/features/campaign-entities/npcs/example/index.ts
import { lazy } from "react";

/**
 * The NPC page's signed-out example, loaded only when a signed-out visitor
 * opens the page: members never download the example campaign.
 */
export const NPCExample = lazy(() => import("./NPCExample"));
