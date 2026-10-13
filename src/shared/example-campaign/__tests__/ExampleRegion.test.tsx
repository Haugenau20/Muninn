// src/shared/example-campaign/__tests__/ExampleRegion.test.tsx
import React from "react";
import { render, screen, within } from "@testing-library/react";
import ExampleRegion from "../ExampleRegion";

describe("ExampleRegion", () => {
  // The example is something to use now, not a picture: assistive technology
  // reaches it, by a name that says whose campaign it is.
  it("is a region named for the example campaign, open to assistive technology", () => {
    render(
      <ExampleRegion caption="The Ashen Vale · try the filters">
        <button type="button">Hostile</button>
      </ExampleRegion>
    );
    const region = screen.getByRole("region", { name: "Example campaign" });
    expect(region).not.toHaveAttribute("aria-hidden");
    expect(within(region).getByRole("button", { name: "Hostile" })).toBeInTheDocument();
  });

  it("labels itself with the chip and the caption", () => {
    render(
      <ExampleRegion caption="The Ashen Vale · try the filters">
        <p>rows</p>
      </ExampleRegion>
    );
    const region = screen.getByRole("region", { name: "Example campaign" });
    expect(within(region).getByText("Example", { exact: true })).toBeInTheDocument();
    expect(within(region).getByText("The Ashen Vale · try the filters")).toBeInTheDocument();
  });
});
