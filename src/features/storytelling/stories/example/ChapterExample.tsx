// src/features/storytelling/stories/example/ChapterExample.tsx
import React, { useState } from "react";
import ExampleRegion from "shared/example-campaign/ExampleRegion";
import { EXAMPLE_CAMPAIGN } from "shared/example-campaign/example-campaign";
import type { Chapter } from "../../chapters/types";
import type { ChapterWithProgress } from "../../chapters/utils/chapter-progress";
import ChapterBrowser, { type ChapterFilterMode } from "../components/ChapterBrowser";

/**
 * The example's chronicle as the log reads it, crediting no one: a chapter
 * must name its creator, an example must not invent one.
 */
const ITEMS: ChapterWithProgress[] = EXAMPLE_CAMPAIGN.chapters.map(
  ({ id, order, title, summary, state, percentRead, isCurrent }) => ({
    chapter: { id, order, title, summary, createdBy: "", createdByUsername: "" } as Chapter,
    state,
    percentRead,
    isCurrent,
  })
);

/** Opening a chapter: there is no example chapter to read, so nothing. */
const stay = () => undefined;

/**
 * The chapter page as a signed-out visitor sees it: the real log, filled from
 * the example campaign, under the sign-in band. Its search, All/Unread pills
 * and folded run of read chapters all work; opening a chapter stays put, and
 * the shelf toggle and selection are a member's.
 *
 * The filter is held here rather than remembered: a visitor's choice should
 * not become a member's preference on this browser.
 */
const ChapterExample: React.FC = () => {
  const [filterMode, setFilterMode] = useState<ChapterFilterMode>("all");
  return (
    <ExampleRegion caption="The Ashen Vale · fourteen sessions in">
      <ChapterBrowser items={ITEMS} filterMode={filterMode} onFilterModeChange={setFilterMode} onChapterSelect={stay} />
    </ExampleRegion>
  );
};

export default ChapterExample;
