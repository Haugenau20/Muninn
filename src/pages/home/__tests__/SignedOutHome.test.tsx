import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SignedOutHome from "../SignedOutHome";
import { SIGNED_OUT_EXAMPLE, describeUpdate } from "../signed-out-example";

jest.mock("features/user-management", () => ({
  // `SignInForm` and `JoinGroupDialog` were stubbed here until 14.5 deleted
  // the dialogs. `GatedContent` now links to the routes instead, and needs
  // only the path builder.
  signInPathFor: () => "/signin",
}));

const renderHome = () =>
  render(
    <MemoryRouter>
      <SignedOutHome />
    </MemoryRouter>
  );

describe("SignedOutHome", () => {
  // Strangers arrive here, so it is where the name is explained.
  it("says where the name comes from", () => {
    renderHome();
    expect(screen.getByText("Muninn was Odin's raven of memory.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "About the name" })).toHaveAttribute("href", "/about");
  });

  it("leads with what the product is, as the page's h1", () => {
    renderHome();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /everything your table agreed happened/i
    );
  });

  // Rewritten with the copy pass that took the access model out of the
  // product's voice. The blurb used to say "Invite-only: a DM sends a join
  // link, and nothing is public" -- two claims a player already assumes, one
  // of which named the wrong person, since any player can be the group admin.
  // What survives is the only part a stranger cannot work out for themselves:
  // an account alone gets you nowhere, you need someone to send you a link.
  // Home is now the only place in `src/` that says so (`GATED_FOOTNOTE` used
  // to repeat it on twenty routes), so this assertion is what keeps a
  // signed-out visitor from being told to create an account and nothing else.
  // Moved out of the blurb onto a line of its own (signed-out Home v2), so the
  // one thing a stranger cannot work out -- an account alone gets you nowhere
  // -- is not buried at the end of a paragraph about the product.
  it("tells a stranger they need a join link, on a line of its own, without naming the DM", () => {
    renderHome();
    const invite = screen.getByTestId("home-invite");
    expect(invite).toHaveTextContent("Invite only for now. Ask whoever set up your campaign for a join link.");
    expect(invite).not.toHaveTextContent(/\bDM\b/);
    expect(screen.getByTestId("home-blurb")).not.toHaveTextContent(/join link/i);
  });

  it("pitches the AI extraction a stranger has no other way to discover", () => {
    renderHome();
    // The notes line is the product's most persuasive feature and the only
    // one a signed-out visitor cannot infer from the entity names above it.
    expect(screen.getByTestId("product-lines")).toHaveTextContent(
      /AI pulls out the NPCs/i
    );
  });

  // Both were dialogs until 14.5; they are routes now, so the landing page's
  // two calls to action are links like any other.
  it("offers signing in and an invite link", () => {
    renderHome();
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute(
      "href",
      "/signin"
    );
    expect(screen.getByRole("link", { name: /invite link/i })).toHaveAttribute(
      "href",
      "/join"
    );
  });

  it("opens no overlay", () => {
    renderHome();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("labels the example as an example, and says it can be clicked", () => {
    renderHome();
    expect(screen.getByText("Example campaign")).toBeInTheDocument();
    expect(screen.getByText("Click around")).toBeInTheDocument();
  });

  // The panel was a picture, hidden from assistive technology, with nothing in
  // it to press. It is the way into the examples now (signed-out Home v2), so
  // it is open to everyone and made of links.
  it("is open to assistive technology, now that it holds links", () => {
    renderHome();
    expect(screen.getByTestId("example-panel")).not.toHaveAttribute("aria-hidden");
  });

  it("opens each number's example page", () => {
    renderHome();
    const panel = screen.getByTestId("example-panel");
    SIGNED_OUT_EXAMPLE.stats.forEach((stat) =>
      expect(within(panel).getByRole("link", { name: new RegExp(`${stat.value}\\s*${stat.label}`, "i") })).toHaveAttribute(
        "href",
        stat.href
      )
    );
  });

  it("opens each recent row where it lives, saying what it is and how it stands", () => {
    renderHome();
    const panel = screen.getByTestId("example-panel");
    SIGNED_OUT_EXAMPLE.updates.forEach((update) => {
      const row = describeUpdate(update);
      const link = within(panel).getByRole("link", { name: new RegExp(update.title) });
      expect(link).toHaveAttribute("href", row.href);
      expect(link).toHaveTextContent(row.detail);
      expect(link).toHaveTextContent(row.status);
    });
    expect(within(panel).getByText("12 Mar")).toBeInTheDocument();
  });

  it("ends on the rumours, counted, and the way into them", () => {
    renderHome();
    const panel = screen.getByTestId("example-panel");
    expect(panel).toHaveTextContent(SIGNED_OUT_EXAMPLE.rumourLine);
    expect(within(panel).getByRole("link", { name: /Open the example/ })).toHaveAttribute("href", "/rumors");
  });

  it("renders the fixture's own numbers, not a dashboard of zeros", () => {
    renderHome();
    const panel = screen.getByTestId("example-panel");
    expect(panel).toHaveTextContent(SIGNED_OUT_EXAMPLE.campaignTitle);
    SIGNED_OUT_EXAMPLE.stats.forEach((stat) => {
      expect(panel).toHaveTextContent(String(stat.value));
    });
    SIGNED_OUT_EXAMPLE.updates.forEach((update) => {
      expect(panel).toHaveTextContent(update.title);
    });
  });

  // Plain lines: the example card beside them already holds every way in
  // (maintainer, 2026-10-13: "there are enough ways to click around").
  it("lists the three things the product does, in words", () => {
    renderHome();
    // Scoped to the list: "rumours" and "notes" also appear in the blurb
    // above, so unscoped queries would match several elements and throw.
    const lines = screen.getByTestId("product-lines");
    expect(lines).toHaveTextContent(/chapter log/i);
    expect(lines).toHaveTextContent(/rumours/i);
    expect(lines).toHaveTextContent(/session notes/i);
    expect(lines.querySelectorAll("li")).toHaveLength(3);
    expect(within(lines).queryAllByRole("link")).toHaveLength(0);
  });
});
