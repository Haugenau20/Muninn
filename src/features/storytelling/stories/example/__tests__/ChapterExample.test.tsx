// src/features/storytelling/stories/example/__tests__/ChapterExample.test.tsx
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import ChapterExample from "../ChapterExample";

const Where: React.FC = () => <p data-testid="where">{useLocation().pathname}</p>;

const renderExample = () =>
  render(
    <MemoryRouter initialEntries={["/story/chapters"]}>
      <ChapterExample />
      <Where />
    </MemoryRouter>
  );

const example = () => screen.getByRole("region", { name: "Example campaign" });

describe("ChapterExample", () => {
  it("is the chapter log itself, filled from the example campaign", () => {
    renderExample();
    expect(within(example()).getByText("The Ashen Vale · fourteen sessions in")).toBeInTheDocument();
    expect(within(example()).getByRole("button", { name: "All 14" })).toBeInTheDocument();
    // The chapter being read counts as unread, as it does for a member.
    expect(within(example()).getByRole("button", { name: "Unread 2" })).toBeInTheDocument();
  });

  it("folds the long run of read chapters into one line, and opens it", () => {
    renderExample();
    expect(within(example()).getByText(/1–10 · Ten more read chapters/)).toBeInTheDocument();
    expect(within(example()).queryByText("Ashes on the Water")).not.toBeInTheDocument();
    fireEvent.click(within(example()).getByRole("button", { name: "Show" }));
    expect(within(example()).getByText("Ashes on the Water")).toBeInTheDocument();
  });

  it("filters to what is unread, and searches", () => {
    renderExample();
    fireEvent.click(within(example()).getByRole("button", { name: "Unread 2" }));
    expect(within(example()).getByText("Into the Fen")).toBeInTheDocument();
    expect(within(example()).queryByText("Greywater Ford")).not.toBeInTheDocument();

    fireEvent.click(within(example()).getByRole("button", { name: "All 14" }));
    fireEvent.change(within(example()).getByRole("textbox", { name: "Search chapter titles and summaries" }), {
      target: { value: "toll" },
    });
    expect(within(example()).getByText("Greywater Ford")).toBeInTheDocument();
    expect(within(example()).queryByText("Into the Fen")).not.toBeInTheDocument();
  });

  it("leaves out the shelf toggle and selection", () => {
    renderExample();
    expect(within(example()).queryByRole("button", { name: /Shelf/ })).not.toBeInTheDocument();
    expect(within(example()).queryByRole("button", { name: "Select Chapters" })).not.toBeInTheDocument();
  });

  it("stays on the page when a chapter is opened: there is no example to read", () => {
    renderExample();
    fireEvent.click(within(example()).getByText("Into the Fen"));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/story\/chapters$/);
  });
});
