// src/features/storytelling/stories/components/__tests__/ChapterBrowser.test.tsx
import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Chapter } from "../../../chapters/types";
import type { ChapterWithProgress } from "../../../chapters/utils/chapter-progress";
import ChapterBrowser, { type ChapterFilterMode } from "../ChapterBrowser";

const item = (order: number, title: string, state: ChapterWithProgress["state"]): ChapterWithProgress => ({
  chapter: { id: `c${order}`, order, title, summary: `${title}, summarised`, createdBy: "u", createdByUsername: "u" } as Chapter,
  state,
  percentRead: state === "read" ? 100 : 0,
  isCurrent: false,
});

const ITEMS = [item(1, "The Shire", "read"), item(2, "Bree", "read"), item(3, "Weathertop", "unread")];

/** The browser with its filter held the way a page holds it. */
const Harness: React.FC<Partial<React.ComponentProps<typeof ChapterBrowser>>> = (props) => {
  const [filterMode, setFilterMode] = useState<ChapterFilterMode>("all");
  return (
    <ChapterBrowser
      items={ITEMS}
      filterMode={filterMode}
      onFilterModeChange={setFilterMode}
      onChapterSelect={() => undefined}
      {...props}
    />
  );
};

describe("ChapterBrowser", () => {
  it("counts every chapter and the unread ones", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "All 3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Unread 1" })).toBeInTheDocument();
  });

  it("narrows to what is unread", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Unread 1" }));
    expect(screen.getByText("Weathertop")).toBeInTheDocument();
    expect(screen.queryByText("Bree")).not.toBeInTheDocument();
  });

  it("searches titles and summaries, and the counts follow", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search chapter titles and summaries" }), {
      target: { value: "bree" },
    });
    expect(screen.getByText("Bree")).toBeInTheDocument();
    expect(screen.queryByText("The Shire")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All 1" })).toBeInTheDocument();
  });

  it("says when nothing matches", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search chapter titles and summaries" }), {
      target: { value: "mordor" },
    });
    expect(screen.getByText("No chapters match this view")).toBeInTheDocument();
  });

  it("offers the list/shelf toggle and selection only when the page gives them", () => {
    const { unmount } = render(<Harness />);
    expect(screen.queryByRole("button", { name: /Shelf/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Chapters" })).not.toBeInTheDocument();
    unmount();

    render(
      <Harness
        viewMode="list"
        onViewModeChange={() => undefined}
        selection={{ active: false, selected: new Set(), toggleActive: () => undefined, setSelected: () => undefined, clear: () => undefined }}
      />
    );
    expect(screen.getByRole("button", { name: /Shelf/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Chapters" })).toBeInTheDocument();
  });
});
