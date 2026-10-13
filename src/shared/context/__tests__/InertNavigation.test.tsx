// src/shared/context/__tests__/InertNavigation.test.tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { InertNavigation, NavigationProvider, useNavigation } from "../NavigationContext";

/** Where the router is, so a test can see whether anything moved it. */
const Where: React.FC = () => <p data-testid="where">{useLocation().pathname + useLocation().search}</p>;

/** A control that leaves, as "More info" does in a directory row. */
const Leave: React.FC = () => {
  const { navigateToPage, goBack, getCurrentQueryParams } = useNavigation();
  return (
    <>
      <button type="button" onClick={() => navigateToPage("/npcs/example-npc-odile")}>
        More info
      </button>
      <button type="button" onClick={goBack}>
        Back
      </button>
      <p data-testid="highlight">{getCurrentQueryParams().highlight ?? ""}</p>
    </>
  );
};

const renderAt = (url: string, children: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={["/", url]} initialIndex={1}>
      <NavigationProvider>
        {children}
        <Where />
      </NavigationProvider>
    </MemoryRouter>
  );

describe("InertNavigation", () => {
  it("lets a control inside it look like it leaves, and stays on the page", () => {
    renderAt("/npcs", (
      <InertNavigation>
        <Leave />
      </InertNavigation>
    ));
    fireEvent.click(screen.getByRole("button", { name: "More info" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/npcs");
  });

  // A deep link from signed-out Home still reaches the example's row.
  it("still reads where the page is", () => {
    renderAt("/npcs?highlight=example-npc-odile", (
      <InertNavigation>
        <Leave />
      </InertNavigation>
    ));
    expect(screen.getByTestId("highlight")).toHaveTextContent("example-npc-odile");
  });

  it("leaves navigation outside it alone", () => {
    renderAt("/npcs", <Leave />);
    fireEvent.click(screen.getByRole("button", { name: "More info" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/npcs/example-npc-odile");
  });
});
