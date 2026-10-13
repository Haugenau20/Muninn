// src/features/storytelling/stories/example/index.ts
import { lazy } from "react";

/**
 * The chapter page's signed-out example, loaded only when a signed-out
 * visitor opens the page: members never download the example campaign.
 */
export const ChapterExample = lazy(() => import("./ChapterExample"));
