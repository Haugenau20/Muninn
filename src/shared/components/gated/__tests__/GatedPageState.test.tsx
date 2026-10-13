import React from "react";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GatedPageState, { CampaignOption } from "../GatedPageState";

const OPTIONS: CampaignOption[] = [
  {
    campaignId: "c-1",
    campaignName: "Phandelver",
    groupId: "g-1",
    groupName: "The Fellowship",
  },
  {
    campaignId: "c-2",
    campaignName: "Curse of Strahd",
    groupId: "g-2",
    groupName: "The Council",
  },
];

const renderPanel = (props: Partial<React.ComponentProps<typeof GatedPageState>> = {}) =>
  render(
    <MemoryRouter>
      <GatedPageState
        variant="signed-out"
        heading="Sign in to see your party's quests"
        blurb="Quests are the open threads of a campaign."
        signInHref="/signin?next=%2Fquests"
        joinHref="/join"
        {...props}
      />
    </MemoryRouter>
  );

describe("GatedPageState, signed out", () => {
  it("labels the page as a private campaign", () => {
    renderPanel();
    expect(screen.getByTestId("gated-eyebrow")).toHaveTextContent(/private campaign/i);
  });

  it("renders the page's heading and blurb", () => {
    renderPanel();
    expect(
      screen.getByRole("heading", { name: "Sign in to see your party's quests" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Quests are the open threads of a campaign.")
    ).toBeInTheDocument();
  });

  // Both actions became links in 14.5, when sign-in and join became routes.
  // They were buttons because they opened dialogs; a destination should be
  // openable in a new tab and middle-clickable like any other link.
  it("offers signing in and an invite link, and nothing else", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: /^sign in$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /invite link/i })
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("sends the primary action to /signin, carrying the destination", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute(
      "href",
      "/signin?next=%2Fquests"
    );
  });

  it("sends the invite action to /join", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: /invite link/i })).toHaveAttribute(
      "href",
      "/join"
    );
  });

  // "New here? See what the site does" sat under the panel's buttons until
  // the maintainer removed it (2026-10-13): the header's Home link already
  // goes where it went.
  it("ends on its two links, with no newcomer's footnote", () => {
    renderPanel();
    expect(screen.queryByText(/new here/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /what the site does/i })).not.toBeInTheDocument();
  });

  it("never lists campaigns", () => {
    renderPanel({ campaigns: OPTIONS });
    expect(screen.queryByText("Phandelver")).not.toBeInTheDocument();
  });
});

describe("GatedPageState, pick campaign", () => {
  const pickProps = {
    variant: "pick-campaign" as const,
    heading: "unused",
    blurb: "unused",
    hasGroups: true,
    campaigns: OPTIONS,
    onSelectCampaign: jest.fn(),
  };

  it("asks which campaign, not to go and select one elsewhere", () => {
    renderPanel(pickProps);
    expect(
      screen.getByRole("heading", { name: /which campaign/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/please select/i)).not.toBeInTheDocument();
  });

  it("lists every campaign with the group it belongs to", () => {
    renderPanel(pickProps);
    const phandelver = screen.getByRole("button", { name: /Phandelver/ });
    expect(within(phandelver).getByText(/The Fellowship/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Curse of Strahd/ })
    ).toBeInTheDocument();
  });

  it("makes the selection here, as buttons", () => {
    const onSelectCampaign = jest.fn();
    renderPanel({ ...pickProps, onSelectCampaign });
    fireEvent.click(screen.getByRole("button", { name: /Phandelver/ }));
    expect(onSelectCampaign).toHaveBeenCalledWith(OPTIONS[0]);
  });

  it("counts the campaigns in the singular when there is one", () => {
    renderPanel({ ...pickProps, campaigns: [OPTIONS[0]] });
    expect(screen.getByText(/you're in one campaign\b/i)).toBeInTheDocument();
  });

  it("says there are no campaigns yet rather than showing an empty list", () => {
    renderPanel({ ...pickProps, campaigns: [], campaignsLoading: false });
    expect(
      screen.getByRole("heading", { name: /no campaigns yet/i })
    ).toBeInTheDocument();
  });

  it("offers joining a group when the user belongs to none", () => {
    renderPanel({ ...pickProps, hasGroups: false, campaigns: [] });
    expect(
      screen.getByRole("heading", { name: /join a group/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /invite link/i })
    ).toBeInTheDocument();
  });

  // FIX 1 -- the cross-group campaign fetch is still in flight, and
  // `campaigns` is empty only because nothing has arrived yet, not because
  // there is nothing to arrive. The panel must not claim "No campaigns yet"
  // here: that is exactly the "claim something while the answer is unknown"
  // defect the gated-states redesign exists to remove, reproduced inside its
  // own panel. Verified to fail against the pre-fix code, which computed
  // `pickSituation` from `campaigns.length` alone and rendered "No campaigns
  // yet" here.
  it("does not claim there are no campaigns while the campaign fetch is still in flight", () => {
    renderPanel({ ...pickProps, campaigns: [], campaignsLoading: true });
    expect(
      screen.queryByRole("heading", { name: /no campaigns yet/i })
    ).not.toBeInTheDocument();
    expect(
      // Was /a group admin creates the first campaign/, reworded away from
      // naming a role the reader may not have; this still targets the
      // "no-campaigns" line specifically, which is what the guard needs.
      screen.queryByText(/your first campaign will appear here/i)
    ).not.toBeInTheDocument();
  });

  // A member with no group at all needs no fetch to know that -- `hasGroups`
  // is already known synchronously, so this case must not wait on
  // `campaignsLoading` before offering the invite-link action.
  it("still offers joining a group while campaigns are loading, when there are no groups", () => {
    renderPanel({
      ...pickProps,
      hasGroups: false,
      campaigns: [],
      campaignsLoading: true,
    });
    expect(
      screen.getByRole("heading", { name: /join a group/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /invite link/i })
    ).toBeInTheDocument();
  });

  it("shows a switch failure without dropping the list", () => {
    renderPanel({ ...pickProps, selectError: "Could not open that campaign." });
    expect(
      screen.getByText("Could not open that campaign.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Phandelver/ })
    ).toBeInTheDocument();
  });
});

// T127: a group with no campaign is started from here, by any member, and
// someone in no group can follow a founder link as well as an invitation.
describe("GatedPageState, starting out (T127)", () => {
  const pickProps = {
    variant: "pick-campaign" as const,
    heading: "unused",
    blurb: "unused",
    hasGroups: true,
    campaigns: [] as CampaignOption[],
  };

  it("offers the first campaign's form when the group has none", async () => {
    const onCreateCampaign = jest.fn().mockResolvedValue(undefined);
    renderPanel({ ...pickProps, onCreateCampaign });

    fireEvent.change(screen.getByLabelText(/campaign name/i), {
      target: { value: "The Sunken Library" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));

    await waitFor(() =>
      expect(onCreateCampaign).toHaveBeenCalledWith({
        name: "The Sunken Library",
        description: "",
      })
    );
  });

  it("says what failed, and keeps what was typed", async () => {
    const onCreateCampaign = jest.fn().mockRejectedValue(new Error("You are not a member of this group"));
    renderPanel({ ...pickProps, onCreateCampaign });

    fireEvent.change(screen.getByLabelText(/campaign name/i), {
      target: { value: "The Sunken Library" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not a member/i);
    expect(screen.getByLabelText(/campaign name/i)).toHaveValue("The Sunken Library");
  });

  it("offers no form while the campaigns are still being found", () => {
    renderPanel({ ...pickProps, campaignsLoading: true, onCreateCampaign: jest.fn() });
    expect(screen.queryByLabelText(/campaign name/i)).not.toBeInTheDocument();
  });

  it("keeps the form folded away where there are campaigns to pick", () => {
    renderPanel({ ...pickProps, campaigns: OPTIONS, onCreateCampaign: jest.fn() });
    expect(screen.getByText(/start a campaign in/i)).toBeVisible();
    expect(screen.getByLabelText(/campaign name/i)).not.toBeVisible();
  });

  it("offers a founder link beside an invitation to someone in no group", () => {
    renderPanel({ ...pickProps, hasGroups: false, startGroupHref: "/join?founder=" });
    expect(
      screen.getByRole("link", { name: /link to start a group/i })
    ).toHaveAttribute("href", "/join?founder=");
    expect(screen.getByRole("link", { name: /invite link/i })).toBeInTheDocument();
  });

  it("folds the form under the list when only other groups have campaigns", () => {
    renderPanel({
      ...pickProps,
      campaigns: OPTIONS,
      onCreateCampaign: jest.fn(),
      createCampaignGroupName: "Staddle Table",
    });
    expect(screen.getByRole("button", { name: /Phandelver/ })).toBeInTheDocument();
    expect(screen.getByText("Start a campaign in Staddle Table")).toBeInTheDocument();
  });
});
