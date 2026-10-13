// src/features/collaboration/notes/example/index.ts
import { lazy } from "react";

/**
 * The notes page's signed-out example, loaded only when a signed-out visitor
 * opens the page: members never download the example campaign.
 */
export const NoteExample = lazy(() => import("./NoteExample"));
