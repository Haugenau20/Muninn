// src/shared/components/gated/__tests__/GatedSignInBand.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GatedSignInBand from "../GatedSignInBand";

const renderBand = () =>
  render(
    <MemoryRouter>
      <GatedSignInBand
        heading="Sign in to see who your party has met"
        line="Below is an example campaign, so try it. Your own NPCs are private to your group."
        signInHref="/signin?next=%2Fnpcs"
        joinHref="/join"
      />
    </MemoryRouter>
  );

describe("GatedSignInBand", () => {
  it("names the page's sign-in as a heading", () => {
    renderBand();
    expect(
      screen.getByRole("heading", { name: "Sign in to see who your party has met" })
    ).toBeInTheDocument();
  });

  it("says the example below is an example", () => {
    renderBand();
    expect(screen.getByText(/Below is an example campaign/)).toBeInTheDocument();
  });

  it("links sign-in back to this page, and the invite link to /join", () => {
    renderBand();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/signin?next=%2Fnpcs");
    expect(screen.getByRole("link", { name: "I have an invite link" })).toHaveAttribute("href", "/join");
  });

  // The large panel's eyebrow and footnote belong to the panel; the band is
  // one line and two links.
  it("carries no eyebrow and no footnote of its own", () => {
    renderBand();
    expect(screen.queryByTestId("gated-eyebrow")).not.toBeInTheDocument();
    expect(screen.queryByText("New here?")).not.toBeInTheDocument();
  });
});
