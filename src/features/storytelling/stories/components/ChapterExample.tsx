// src/features/storytelling/stories/components/ChapterExample.tsx
import React from 'react';
import ExampleRegion from 'shared/example-campaign/ExampleRegion';
import { EXAMPLE_CAMPAIGN } from 'shared/example-campaign/example-campaign';
import { ChapterRowView } from './ChapterList';

/**
 * The example campaign's chronicle, under the chapters page's sign-in band
 * (T150): the rows the list draws, inert, so a stranger can see what the story
 * holds -- a chapter read, and the one the reader is in, promoted. List rows,
 * because a signed-out visitor has no list/shelf toggle to follow.
 */
const ChapterExample: React.FC = () => (
  <ExampleRegion caption="The Ashen Vale · fourteen sessions in">
    <div className="rounded-lg overflow-hidden card px-3">
      {EXAMPLE_CAMPAIGN.chapters.map(({ id, order, title, summary, state, percentRead, isCurrent }) => (
        <ChapterRowView
          key={id}
          item={{ chapter: { id, order, title, summary }, state, percentRead, isCurrent }}
          inert
        />
      ))}
    </div>
  </ExampleRegion>
);

export default ChapterExample;
