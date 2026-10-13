// src/features/campaign-entities/quests/example/__tests__/QuestExample.test.tsx
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NavigationProvider } from "shared/context/NavigationContext";
import QuestExample from "../QuestExample";

const Where: React.FC = () => <p data-testid="where">{useLocation().pathname}</p>;

const renderExample = () =>
  render(
    <MemoryRouter initialEntries={["/quests"]}>
      <NavigationProvider>
        <QuestExample />
        <Where />
      </NavigationProvider>
    </MemoryRouter>
  );

const example = () => screen.getByRole("region", { name: "Example campaign" });
const row = (title: string) => within(example()).queryByRole("button", { name: new RegExp(`(Expand|Collapse) ${title}$`) });

describe("QuestExample", () => {
  it("is the quest log itself, filled from the example campaign", () => {
    renderExample();
    expect(within(example()).getByText("sworn so far")).toBeInTheDocument();
    expect(within(example()).getByText("The Ashen Vale · try the filters")).toBeInTheDocument();
    expect(within(example()).getByRole("heading", { name: /Active Quests/ })).toBeInTheDocument();
  });

  it("opens with the drowned ledger open, objectives and all", () => {
    renderExample();
    expect(row("Recover the drowned ledger")).toHaveAttribute("aria-expanded", "true");
    expect(within(example()).getByText("Search under the ferry landing")).toBeInTheDocument();
    expect(within(example()).getByText("Vesk Harrow")).toBeInTheDocument();
  });

  it("keeps what is finished folded away, as a member's log does", () => {
    renderExample();
    expect(row("Cross at Cinderford after dark")).not.toBeInTheDocument();
    fireEvent.click(within(example()).getByRole("button", { name: /Completed Quests/ }));
    expect(row("Cross at Cinderford after dark")).toBeInTheDocument();
  });

  it("filters as you type", () => {
    renderExample();
    fireEvent.change(within(example()).getByPlaceholderText("Search quests..."), { target: { value: "toll" } });
    expect(row("Pay the Toll-Keeper, or don’t")).toBeInTheDocument();
    expect(row("Recover the drowned ledger")).not.toBeInTheDocument();
  });

  it("leaves out selection, and keeps More info looking live without leaving", () => {
    renderExample();
    expect(within(example()).queryByRole("button", { name: "Select Quests" })).not.toBeInTheDocument();
    fireEvent.click(within(example()).getByRole("button", { name: "More info" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/quests$/);
  });

  it("ticks nothing off: the objectives say what the example says", () => {
    renderExample();
    const objective = within(example()).getByRole("checkbox", { name: /Find out who Fenn was carrying it for/ });
    fireEvent.click(objective);
    expect(objective).not.toBeChecked();
  });
});
