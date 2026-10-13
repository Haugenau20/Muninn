// src/features/campaign-entities/rumors/example/__tests__/RumorExample.test.tsx
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NavigationProvider } from "shared/context/NavigationContext";
import RumorExample from "../RumorExample";

// Signed out: no campaign, so no notes are read and nobody is named.
jest.mock("features/campaign-entities/shared/recordNotes", () =>
  require("@/test-utils/record-notes-mock").recordNotesMock()
);

jest.mock("features/user-management", () => ({
  ...jest.requireActual("features/user-management"),
  useCampaigns: () => ({ activeCampaignId: null }),
}));

const Where: React.FC = () => <p data-testid="where">{useLocation().pathname}</p>;

const renderExample = () =>
  render(
    <MemoryRouter initialEntries={["/rumors"]}>
      <NavigationProvider>
        <RumorExample />
        <Where />
      </NavigationProvider>
    </MemoryRouter>
  );

const example = () => screen.getByRole("region", { name: "Example campaign" });
const row = (title: string) => within(example()).queryByRole("button", { name: new RegExp(`(Expand|Collapse) ${title}$`) });

describe("RumorExample", () => {
  it("is the rumour list itself, filled from the example campaign", () => {
    renderExample();
    expect(within(example()).getByText("rumours gathered")).toBeInTheDocument();
    expect(within(example()).getByRole("heading", { name: /Unconfirmed/ })).toBeInTheDocument();
  });

  it("opens with the night-ferry rumour open, as text and nothing to type into", () => {
    renderExample();
    expect(row("The ferry crosses at night for those who never paid")).toHaveAttribute("aria-expanded", "true");
    expect(within(example()).getByText(/We crossed, so it does/)).toBeInTheDocument();
    expect(within(example()).getAllByRole("textbox")).toEqual([
      within(example()).getByPlaceholderText("Search rumours..."),
    ]);
  });

  it("leaves out the composer and selection", () => {
    renderExample();
    expect(within(example()).queryByLabelText("Heard something? Write it down here")).not.toBeInTheDocument();
    expect(within(example()).queryByRole("button", { name: "Select Rumours" })).not.toBeInTheDocument();
  });

  it("keeps the false ones folded away", () => {
    renderExample();
    expect(row("The Toll-Keeper is Captain Fenn’s ghost")).not.toBeInTheDocument();
    // The group's heading, not the open row's "False" on its ladder.
    const falseGroup = within(example())
      .getAllByRole("button", { name: /^False/ })
      .find((button) => button.hasAttribute("aria-expanded"));
    fireEvent.click(falseGroup as HTMLElement);
    expect(row("The Toll-Keeper is Captain Fenn’s ghost")).toBeInTheDocument();
  });

  it("filters by where a rumour was heard", () => {
    renderExample();
    fireEvent.click(
      within(within(example()).getByRole("group", { name: "Filter by source" })).getByRole("button", { name: "Notice" })
    );
    expect(row("Harrowgate pays for Vesk only if he’s alive")).toBeInTheDocument();
    expect(row("Something lives under Greywater Ford")).not.toBeInTheDocument();
  });

  it("keeps the way to the quest it became looking live, without leaving", () => {
    renderExample();
    fireEvent.click(within(example()).getByRole("button", { name: "Open the quest" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/rumors$/);
  });
});
