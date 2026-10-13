// src/features/campaign-entities/rumors/example/index.ts
import { lazy } from "react";

/**
 * The rumour page's signed-out example, loaded only when a signed-out
 * visitor opens the page: members never download the example campaign.
 */
export const RumorExample = lazy(() => import("./RumorExample"));
