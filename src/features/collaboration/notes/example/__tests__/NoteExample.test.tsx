// src/features/collaboration/notes/example/__tests__/NoteExample.test.tsx
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import NoteExample from "../NoteExample";

// The example must never reach extraction: if anything inside it asks for the
// extractor, these fail loudly.
const mockExtract = jest.fn();
jest.mock("features/collaboration/entity-extraction/hooks/useEntityExtractor", () => ({
  useEntityExtractor: () => {
    mockExtract();
    return { extractWithOpenAI: mockExtract };
  },
}));

const Where: React.FC = () => <p data-testid="where">{useLocation().pathname}</p>;

const renderExample = () =>
  render(
    <MemoryRouter initialEntries={["/notes"]}>
      <NoteExample />
      <Where />
    </MemoryRouter>
  );

const example = () => screen.getByRole("region", { name: "Example campaign" });

describe("NoteExample", () => {
  beforeEach(() => mockExtract.mockClear());

  it("shows one player's note from the example campaign, on the real note sheet", () => {
    renderExample();
    expect(within(example()).getByText("One player's note from the Ashen Vale")).toBeInTheDocument();
    expect(within(example()).getByRole("textbox", { name: "Note title" })).toHaveValue("Session 13 — Into the Fen");
    expect(
      (within(example()).getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement).value
    ).toMatch(/calls himself Gully Thrane/);
    expect(within(example()).getByText("Example note · read-only")).toBeInTheDocument();
  });

  // Readable, not faded: nothing here is disabled, and nothing can be typed.
  it("can be read and not changed, and nothing on it is faded", () => {
    renderExample();
    within(example())
      .getAllByRole("textbox")
      .forEach((field) => {
        expect(field).toHaveAttribute("readonly");
        expect(field).not.toBeDisabled();
      });
    ["Archive", "Delete", "Scan note"].forEach((name) =>
      expect(within(example()).getByRole("button", { name })).not.toBeDisabled()
    );
  });

  it("is already scanned: nine names in the campaign, five found that are not", () => {
    renderExample();
    expect(within(example()).getByText("IN YOUR CAMPAIGN · 9")).toBeInTheDocument();
    expect(within(example()).getByText("DETECTED, NOT IN YOUR CAMPAIGN · 5")).toBeInTheDocument();
    expect(within(example()).getByRole("button", { name: /Odile Marrow/ })).toBeInTheDocument();
    expect(within(example()).getByText("Gully Thrane")).toBeInTheDocument();
    expect(within(example()).getAllByRole("button", { name: "Add" })).toHaveLength(5);
  });

  it("does nothing when pressed, and never reaches extraction", () => {
    renderExample();
    fireEvent.click(within(example()).getByRole("button", { name: "Scan note" }));
    within(example()).getAllByRole("button", { name: "Add" }).forEach((add) => fireEvent.click(add));
    fireEvent.click(within(example()).getByRole("button", { name: /Odile Marrow/ }));
    fireEvent.click(within(example()).getByRole("button", { name: "All notes" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/notes$/);
    expect(within(example()).getByText("DETECTED, NOT IN YOUR CAMPAIGN · 5")).toBeInTheDocument();
    expect(mockExtract).not.toHaveBeenCalled();
  });
});
