// src/shared/components/gated/__tests__/GatedContent.test.tsx
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GatedContent from "../GatedContent";
import { GATED_COPY } from "../gated-page-copy";
import type { PageGate } from "../usePageGate";

const mockSetActiveGroup = jest.fn().mockResolvedValue(undefined);
const mockSetActiveCampaign = jest.fn().mockResolvedValue(undefined);
const mockCreateCampaign = jest.fn().mockResolvedValue("c-new");
let mockActiveGroupId: string | null = "g-1";

jest.mock("features/user-management", () => ({
  useGroups: () => ({
    groups: [{ id: "g-1", name: "The Fellowship" }],
    activeGroupId: mockActiveGroupId,
    setActiveGroup: mockSetActiveGroup,
  }),
  useCampaigns: () => ({
    setActiveCampaign: mockSetActiveCampaign,
    createCampaign: mockCreateCampaign,
  }),
  // `SignInForm` and `JoinGroupDialog` were stubbed here until 14.5 deleted
  // the dialogs. `GatedContent` now links to the routes instead, and needs
  // only the path builder.
  signInPathFor: () => "/signin",
}));

let mockOptions = [
  {
    campaignId: "c-1",
    campaignName: "Phandelver",
    groupId: "g-1",
    groupName: "The Fellowship",
  },
];

jest.mock("../useSelectableCampaigns", () => ({
  useSelectableCampaigns: (enabled: boolean) => ({
    options: enabled ? mockOptions : [],
    loading: false,
  }),
}));

const gate = (overrides: Partial<PageGate> = {}): PageGate => ({
  state: "ready",
  canAct: true,
  page: "quests",
  mode: "read",
  copy: GATED_COPY.quests,
  heading: GATED_COPY.quests.heading,
  error: null,
  ...overrides,
});

const renderGate = (value: PageGate) =>
  render(
    <MemoryRouter>
      <GatedContent gate={value}>
        <div data-testid="page-body">the quests</div>
      </GatedContent>
    </MemoryRouter>
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockActiveGroupId = "g-1";
  mockOptions = [
    {
      campaignId: "c-1",
      campaignName: "Phandelver",
      groupId: "g-1",
      groupName: "The Fellowship",
    },
  ];
});

describe("GatedContent", () => {
  it("renders the page body when ready", () => {
    renderGate(gate());
    expect(screen.getByTestId("page-body")).toBeInTheDocument();
  });

  it("renders a skeleton and no message while resolving", () => {
    renderGate(gate({ state: "resolving", canAct: false }));
    expect(screen.getByTestId("gated-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("page-body")).not.toBeInTheDocument();
    // The flash this PR removes: no "please select" copy during restore.
    expect(screen.queryByText(/sign in to/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/which campaign/i)).not.toBeInTheDocument();
  });

  it("renders the signed-out panel instead of the body", () => {
    renderGate(gate({ state: "signed-out", canAct: false }));
    expect(
      screen.getByRole("heading", { name: GATED_COPY.quests.heading })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("page-body")).not.toBeInTheDocument();
  });

  // Both were dialogs opened from this panel until 14.5. They are routes now,
  // and the sign-in link carries this page as the destination -- which is the
  // point: the dialog had nowhere to put where you were, so signing in to read
  // one quest returned you to the campaign's front door.
  it("sends the panel's sign-in action to /signin", () => {
    renderGate(gate({ state: "signed-out", canAct: false }));
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/signin")
    );
  });

  it("sends the panel's invite action to /join", () => {
    renderGate(gate({ state: "signed-out", canAct: false }));
    expect(screen.getByRole("link", { name: /invite link/i })).toHaveAttribute(
      "href",
      "/join"
    );
  });

  it("opens no overlay at all", () => {
    renderGate(gate({ state: "signed-out", canAct: false }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the campaign picker instead of the body", () => {
    renderGate(gate({ state: "pick-campaign", canAct: false }));
    expect(
      screen.getByRole("heading", { name: /which campaign/i })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("page-body")).not.toBeInTheDocument();
  });

  it("switches campaign without touching the group when it is the active one", async () => {
    renderGate(gate({ state: "pick-campaign", canAct: false }));
    fireEvent.click(screen.getByRole("button", { name: /Phandelver/ }));
    await waitFor(() =>
      expect(mockSetActiveCampaign).toHaveBeenCalledWith("c-1")
    );
    expect(mockSetActiveGroup).not.toHaveBeenCalled();
  });

  it("switches group first when the campaign is in another group", async () => {
    mockActiveGroupId = "g-2";
    renderGate(gate({ state: "pick-campaign", canAct: false }));
    fireEvent.click(screen.getByRole("button", { name: /Phandelver/ }));
    await waitFor(() => expect(mockSetActiveGroup).toHaveBeenCalledWith("g-1"));
    await waitFor(() =>
      expect(mockSetActiveCampaign).toHaveBeenCalledWith("c-1")
    );
  });

  it("shows a failed switch in the panel", async () => {
    mockSetActiveCampaign.mockRejectedValueOnce(new Error("offline"));
    renderGate(gate({ state: "pick-campaign", canAct: false }));
    fireEvent.click(screen.getByRole("button", { name: /Phandelver/ }));
    expect(await screen.findByText("offline")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Phandelver/ })
    ).toBeInTheDocument();
  });

  it("names what failed to load in the error state", () => {
    renderGate(gate({ state: "error", canAct: false, error: "Network down" }));
    expect(screen.getByText(/couldn't load quests/i)).toBeInTheDocument();
    expect(screen.getByText("Network down")).toBeInTheDocument();
  });

  it("offers a retry only when the page gave it one", () => {
    const onRetry = jest.fn();
    const { rerender } = renderGate(
      gate({ state: "error", canAct: false, error: "Network down", onRetry })
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(
      <MemoryRouter>
        <GatedContent gate={gate({ state: "error", canAct: false, error: "x" })}>
          <div data-testid="page-body">the quests</div>
        </GatedContent>
      </MemoryRouter>
    );
    expect(
      screen.queryByRole("button", { name: /try again/i })
    ).not.toBeInTheDocument();
  });

  it("uses the write heading on a create route", () => {
    renderGate(
      gate({
        state: "signed-out",
        canAct: false,
        mode: "write",
        heading: GATED_COPY.quests.writeHeading as string,
      })
    );
    expect(
      screen.getByRole("heading", {
        name: GATED_COPY.quests.writeHeading as string,
      })
    ).toBeInTheDocument();
  });

  // T127: any member starts the group's first campaign from the panel, in
  // the active group, and lands in it.
  it("makes the first campaign in the active group and opens it", async () => {
    mockOptions = [];
    renderGate(gate({ state: "pick-campaign", canAct: false }));
    fireEvent.change(screen.getByLabelText(/campaign name/i), {
      target: { value: "The Sunken Library" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));

    await waitFor(() => expect(mockSetActiveCampaign).toHaveBeenCalledWith("c-new"));
    expect(mockCreateCampaign).toHaveBeenCalledWith("g-1", "The Sunken Library", "");
  });

  it("offers no campaign form without an active group", () => {
    mockOptions = [];
    mockActiveGroupId = null;
    renderGate(gate({ state: "pick-campaign", canAct: false }));
    expect(screen.queryByLabelText(/campaign name/i)).not.toBeInTheDocument();
  });

  it("offers no founder link to someone already in a group", () => {
    renderGate(gate({ state: "pick-campaign", canAct: false }));
    // The member here is in a group, so it is not offered.
    expect(screen.queryByRole("link", { name: /link to start a group/i })).not.toBeInTheDocument();
  });

  it("offers starting a campaign in the active group when only another group has one", () => {
    mockActiveGroupId = "g-2";
    renderGate(gate({ state: "pick-campaign", canAct: false }));
    expect(screen.getByRole("button", { name: /Phandelver/ })).toBeInTheDocument();
    expect(screen.getByText(/start a campaign in/i)).toBeInTheDocument();
  });

  it("offers no campaign form when the active group has campaigns", () => {
    renderGate(gate({ state: "pick-campaign", canAct: false }));
    expect(screen.queryByText(/start a campaign in/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/campaign name/i)).not.toBeInTheDocument();
  });

  describe("the signed-out example (T150)", () => {
    const renderWithExample = (value: PageGate) =>
      render(
        <MemoryRouter>
          <GatedContent gate={value} signedOutExample={<div data-testid="example">rows</div>}>
            <div data-testid="page-body">the quests</div>
          </GatedContent>
        </MemoryRouter>
      );

    it("shows a signed-out visitor the page's example, under the sign-in", () => {
      renderWithExample(gate({ state: "signed-out", canAct: false }));
      const example = screen.getByTestId("example");
      const signIn = screen.getByRole("link", { name: "Sign in" });
      expect(signIn.compareDocumentPosition(example) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // A page with an example shows it, not a panel about it: the sign-in
    // shrinks to one band so the example is what the visitor sees first.
    it("draws the slim band instead of the large panel", () => {
      renderWithExample(gate({ state: "signed-out", canAct: false }));
      expect(screen.getByRole("heading", { name: GATED_COPY.quests.heading })).toBeInTheDocument();
      expect(screen.getByText(GATED_COPY.quests.exampleLine as string)).toBeInTheDocument();
      expect(screen.queryByTestId("gated-eyebrow")).not.toBeInTheDocument();
      expect(screen.queryByText(GATED_COPY.quests.blurb)).not.toBeInTheDocument();
    });

    it("offers the newcomer's way out under the example", () => {
      renderWithExample(gate({ state: "signed-out", canAct: false }));
      const example = screen.getByTestId("example");
      const whatItDoes = screen.getByRole("link", { name: "See what the site does" });
      expect(whatItDoes).toHaveAttribute("href", "/");
      expect(example.compareDocumentPosition(whatItDoes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("waits for an example that loads lazily, showing the band meanwhile", async () => {
      let resolve: (module: { default: React.FC }) => void = () => undefined;
      const Lazy = React.lazy(
        () => new Promise<{ default: React.FC }>((settle) => (resolve = settle))
      );
      render(
        <MemoryRouter>
          <GatedContent gate={gate({ state: "signed-out", canAct: false })} signedOutExample={<Lazy />}>
            <div data-testid="page-body">the quests</div>
          </GatedContent>
        </MemoryRouter>
      );
      expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
      resolve({ default: () => <div data-testid="example">rows</div> });
      expect(await screen.findByTestId("example")).toBeInTheDocument();
    });

    it.each([
      ["ready", gate()],
      ["resolving", gate({ state: "resolving", canAct: false })],
      ["pick-campaign", gate({ state: "pick-campaign", canAct: false })],
      ["error", gate({ state: "error", canAct: false, error: "Network down" })],
    ])("shows no example when %s: it is for strangers, not members", (_state, value) => {
      renderWithExample(value);
      expect(screen.queryByTestId("example")).not.toBeInTheDocument();
    });
  });
});
