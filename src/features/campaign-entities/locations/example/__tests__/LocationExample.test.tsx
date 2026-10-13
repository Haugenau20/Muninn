// src/features/campaign-entities/locations/example/__tests__/LocationExample.test.tsx
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NavigationProvider } from "shared/context/NavigationContext";
import LocationExample from "../LocationExample";

const Where: React.FC = () => <p data-testid="where">{useLocation().pathname}</p>;

const renderExample = () =>
  render(
    <MemoryRouter initialEntries={["/locations"]}>
      <NavigationProvider>
        <LocationExample />
        <Where />
      </NavigationProvider>
    </MemoryRouter>
  );

const example = () => screen.getByRole("region", { name: "Example campaign" });
const search = () => within(example()).getByPlaceholderText("Search locations...");

describe("LocationExample", () => {
  it("is the location tree itself, filled from the example campaign", () => {
    renderExample();
    expect(within(example()).getByText("charted so far")).toBeInTheDocument();
    expect(within(example()).getByText("The Ashen Vale · try the filters")).toBeInTheDocument();
    // The region starts open: places inside it, each ready to open in turn.
    expect(within(example()).getByRole("button", { name: "Collapse The Ashen Vale" })).toBeInTheDocument();
    expect(within(example()).getByRole("button", { name: "Expand Saltmarsh Fen" })).toBeInTheDocument();
    expect(within(example()).getByRole("button", { name: "Expand Harrowgate" })).toBeInTheDocument();
  });

  it("folds a place away", () => {
    renderExample();
    fireEvent.click(within(example()).getByRole("button", { name: "Collapse The Ashen Vale" }));
    expect(within(example()).queryByRole("button", { name: /Cinderford/ })).not.toBeInTheDocument();
  });

  it("flattens the tree while searching, each place with its path", () => {
    renderExample();
    fireEvent.change(search(), { target: { value: "archive" } });
    expect(within(example()).getByText(/Searching flattens the tree/)).toBeInTheDocument();
    expect(within(example()).getByRole("button", { name: "Expand The Drowned Archive" })).toBeInTheDocument();
  });

  it("narrows by type, opening the way down to what matches", () => {
    renderExample();
    fireEvent.click(within(example()).getByRole("button", { name: "Dungeons" }));
    expect(within(example()).getByRole("button", { name: "Expand The Drowned Archive" })).toBeInTheDocument();
    expect(within(example()).queryByRole("button", { name: /Harrowgate/ })).not.toBeInTheDocument();
  });

  it("says a filter emptied it, and offers nothing to add", () => {
    renderExample();
    fireEvent.change(search(), { target: { value: "nowhere at all" } });
    expect(within(example()).getByText("No locations match these filters")).toBeInTheDocument();
    expect(within(example()).queryByRole("button", { name: /Add/ })).not.toBeInTheDocument();
  });

  it("leaves out selection, and keeps More info looking live without leaving", () => {
    renderExample();
    expect(within(example()).queryByRole("button", { name: "Select Locations" })).not.toBeInTheDocument();
    fireEvent.click(within(example()).getByRole("button", { name: "Collapse The Ashen Vale" }));
    fireEvent.click(within(example()).getByRole("button", { name: "Expand Harrowgate" }));
    fireEvent.click(within(example()).getByRole("button", { name: "More info" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/locations$/);
  });

  it("names who was met at a place, from the example's people", () => {
    renderExample();
    fireEvent.click(within(example()).getByRole("button", { name: "Expand Harrowgate" }));
    expect(within(example()).getByText("Corvin Hale")).toBeInTheDocument();
  });
});
