// src/features/campaign-entities/locations/example/index.ts
import { lazy } from "react";

/**
 * The location page's signed-out example, loaded only when a signed-out
 * visitor opens the page: members never download the example campaign.
 */
export const LocationExample = lazy(() => import("./LocationExample"));
