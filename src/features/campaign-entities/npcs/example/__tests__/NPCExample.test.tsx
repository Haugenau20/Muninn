// src/features/campaign-entities/npcs/example/__tests__/NPCExample.test.tsx
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NavigationProvider } from "shared/context/NavigationContext";
import NPCExample from "../NPCExample";

// Signed out: no campaign, so no notes are read and nobody is named.
jest.mock("features/campaign-entities/shared/recordNotes", () =>
  require("@/test-utils/record-notes-mock").recordNotesMock()
);
jest.mock("shared/hooks/useMemberDirectory", () => ({
  __esModule: true,
  useMemberDirectory: () => undefined,
  default: () => undefined,
}));

const Where: React.FC = () => <p data-testid="where">{useLocation().pathname}</p>;

const renderExample = () =>
  render(
    <MemoryRouter initialEntries={["/npcs"]}>
      <NavigationProvider>
        <NPCExample />
        <Where />
      </NavigationProvider>
    </MemoryRouter>
  );

const example = () => screen.getByRole("region", { name: "Example campaign" });
const rowNamed = (name: string) => within(example()).queryByRole("button", { name: new RegExp(`(Expand|Collapse) ${name}$`) });

describe("NPCExample", () => {
  it("is the NPC directory itself, filled from the example campaign", () => {
    renderExample();
    expect(within(example()).getByText("met so far")).toBeInTheDocument();
    expect(within(example()).getByPlaceholderText("Search name, title or description")).toBeInTheDocument();
    expect(within(example()).getByRole("heading", { name: /Cinderford/ })).toBeInTheDocument();
    expect(within(example()).getByRole("heading", { name: /Location unknown/ })).toBeInTheDocument();
  });

  it("says which campaign it is and invites trying it", () => {
    renderExample();
    expect(within(example()).getByText("The Ashen Vale · try the filters")).toBeInTheDocument();
  });

  it("opens with Vesk Harrow's row open, so a visitor sees there is more inside", () => {
    renderExample();
    expect(rowNamed("Vesk Harrow")).toHaveAttribute("aria-expanded", "true");
    expect(within(example()).getByText(/Owes the party forty silver/)).toBeInTheDocument();
  });

  it("filters by search and by stance", () => {
    renderExample();
    fireEvent.change(within(example()).getByPlaceholderText("Search name, title or description"), {
      target: { value: "ferry" },
    });
    expect(rowNamed("Idris Fenn")).toBeInTheDocument();
    expect(rowNamed("Marta Tallow")).not.toBeInTheDocument();

    fireEvent.change(within(example()).getByPlaceholderText("Search name, title or description"), {
      target: { value: "" },
    });
    fireEvent.click(
      within(within(example()).getByRole("group", { name: "Filter by relationship" })).getByRole("button", { name: "Hostile" })
    );
    expect(rowNamed("The Toll-Keeper")).toBeInTheDocument();
    expect(rowNamed("Odile Marrow")).not.toBeInTheDocument();
  });

  it("says a filter emptied it, and offers nothing to add", () => {
    renderExample();
    fireEvent.change(within(example()).getByPlaceholderText("Search name, title or description"), {
      target: { value: "nobody by this name" },
    });
    expect(within(example()).getByText("No NPCs match these filters")).toBeInTheDocument();
    expect(within(example()).queryByRole("button", { name: /Add/ })).not.toBeInTheDocument();
  });

  it("leaves out what a member changes the list with", () => {
    renderExample();
    expect(within(example()).queryByRole("button", { name: "Select NPCs" })).not.toBeInTheDocument();
    expect(within(example()).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(within(example()).queryByText("Recorded by")).not.toBeInTheDocument();
  });

  it("keeps More info looking live, and stays on the page when it is pressed", () => {
    renderExample();
    fireEvent.click(within(example()).getByRole("button", { name: "More info" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/npcs$/);
  });

  it("changes nothing when a stance is pressed", async () => {
    renderExample();
    const ladder = within(example()).getByRole("group", { name: "Stance of Vesk Harrow" });
    fireEvent.click(within(ladder).getByRole("button", { name: /Friendly/ }));
    // The row still reads what the record says: nothing was written.
    expect(await within(rowNamed("Vesk Harrow") as HTMLElement).findByText("Hostile")).toBeInTheDocument();
  });
});
