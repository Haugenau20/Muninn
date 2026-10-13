// src/shared/example-campaign/ExampleRegion.tsx
import React from "react";

/** Props for {@link ExampleRegion}. */
export interface ExampleRegionProps {
  /** A muted line beside the chip: which campaign, and what to try. */
  caption: string;
  /** The page's own content, filled from the example campaign. */
  children: React.ReactNode;
}

/**
 * The frame around a page's example, as a signed-out visitor sees it: the
 * "Example" chip and a caption, over the page itself (T150 and its live
 * follow-up).
 *
 * A labelled region, open to assistive technology: the example is something
 * to use -- filters, search, rows that open -- so a screen-reader user gets
 * it too, under a name that says it is not their campaign.
 */
const ExampleRegion: React.FC<ExampleRegionProps> = ({ caption, children }) => (
  <section aria-label="Example campaign" className="space-y-6">
    <div className="flex flex-wrap items-baseline gap-3 -mb-2">
      <span className="px-2 py-1 rounded text-xs font-semibold uppercase tracking-widest chip">
        Example
      </span>
      <span className="text-sm typography-muted">{caption}</span>
    </div>
    {children}
  </section>
);

export default ExampleRegion;
