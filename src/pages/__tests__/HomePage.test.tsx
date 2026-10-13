// src/pages/__tests__/HomePage.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HomePage from "../HomePage";
import firebaseServices from "core/services/firebase";

// ---------------------------------------------------------------------------
// GatedContent and usePageGate are exercised for real (not mocked), so the
// features/user-management mock below is extended with everything
// GatedContent (and SignedOutHome) need — see .superpowers/sdd/
// 2026-09-03-gated-page-states/page-suite-mock.md.
// ---------------------------------------------------------------------------

let mockUser: { uid: string } | null = { uid: "user-1" };
let mockIsResolving = false;
let mockActiveGroupId: string | null = "group-1";
let mockActiveCampaignId: string | null = "campaign-1";
let mockGroups: Array<{ id: string; name: string }> = [
  { id: "group-1", name: "The Fellowship" },
];

const mockSetActiveGroup = jest.fn().mockResolvedValue(undefined);
const mockSetActiveCampaign = jest.fn().mockResolvedValue(undefined);

jest.mock("features/user-management", () => ({
  useAuth: () => ({ user: mockUser, loading: mockIsResolving }),
  useGroups: () => ({
    activeGroupId: mockActiveGroupId,
    groups: mockGroups,
    setActiveGroup: mockSetActiveGroup,
  }),
  useCampaigns: () => ({
    activeCampaignId: mockActiveCampaignId,
    activeCampaign: mockActiveCampaignId
      ? { id: mockActiveCampaignId, name: "Phandelver" }
      : null,
    setActiveCampaign: mockSetActiveCampaign,
  }),
  // `SignInForm` and `JoinGroupDialog` were stubbed here until 14.5 deleted
  // the dialogs. `GatedContent` now links to the routes instead, and needs
  // only the path builder.
  signInPathFor: () => "/signin",
}));

// useSelectableCampaigns fetches through this in the pick-campaign state.
jest.mock("core/services/firebase", () => ({
  __esModule: true,
  default: {
    campaign: { getCampaigns: jest.fn().mockResolvedValue([]) },
  },
}));

jest.mock("features/storytelling", () => ({
  useStory: () => ({
    chapters: mockChapters,
    isLoading: mockIsLoading,
  }),
}));

jest.mock("features/campaign-entities", () => ({
  // The real helper, not a stub: these surfaces must name a rumour the
  // same way its own list does, now that a title is optional (`15-9`).
  rumorTitleText: jest.requireActual(
    "features/campaign-entities/rumors/utils/rumor-title"
  ).rumorTitleText,
  useNPCs: () => ({
    npcs: mockNpcs,
    isLoading: mockIsLoading,
  }),
  useQuests: () => ({
    quests: mockQuests,
    isLoading: mockIsLoading,
  }),
  useLocations: () => ({
    locations: mockLocations,
    isLoading: mockIsLoading,
  }),
  useRumors: () => ({
    rumors: mockRumors,
    isLoading: mockIsLoading,
  }),
}));

jest.mock("shared/utils/attribution-utils", () => ({
  determineAttributionActor: (_item: any, _map: any) => "Unknown",
  fetchAttributionUsernames: jest.fn().mockResolvedValue({}),
}));

// ---------------------------------------------------------------------------
// Child component / layout mocks
// ---------------------------------------------------------------------------
// The hero band is HomePage's own child now that it renders above the page
// column (it bleeds to the viewport, and that column clips). It reaches for
// campaign context of its own, which these tests -- about layout switching --
// have no reason to provide.
jest.mock("pages/layouts/dashboard/sections/CampaignBanner", () => ({
  __esModule: true,
  default: (props: { chapterCount?: number }) => (
    <div data-testid="campaign-banner" data-chapter-count={props.chapterCount}>
      CampaignBanner
    </div>
  ),
}));

jest.mock("pages/layouts/dashboard/DashboardLayout", () => ({
  __esModule: true,
  default: (props: any) => (
    <div
      data-testid="dashboard-layout"
      data-loading={String(props.loading)}
      data-npc-count={props.npcs?.length}
      data-quest-count={props.quests?.length}
      data-rumor-count={props.rumors?.length}
      data-chapter-count={props.chapters?.length}
      data-location-count={props.locations?.length}
      data-activity-count={props.activities?.length}
    />
  ),
}));

jest.mock("pages/layouts/common/hooks/useLayoutData", () => ({
  __esModule: true,
  default: (props: any) => ({
    loading:
      props.chaptersLoading ||
      props.questsLoading ||
      props.rumorsLoading ||
      props.npcsLoading ||
      props.locationsLoading,
  }),
}));

jest.mock("lucide-react", () => ({
  Book: () => <span data-testid="book-icon" />,
  LayoutDashboard: () => <span data-testid="layout-dashboard-icon" />,
  Lock: () => <span data-testid="lock-icon" />,
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
let mockIsLoading = false;

let mockChapters: any[] = [
  {
    id: "ch-1",
    title: "Chapter 1",
    order: 1,
    content: "Content here...",
    dateModified: "2024-01-01",
    dateAdded: "2024-01-01",
    createdBy: "user-1",
    modifiedBy: "user-1",
  },
];

let mockQuests: any[] = [
  {
    id: "q-1",
    title: "Find the artifact",
    description: "A quest for glory",
    dateModified: "2024-01-02",
    dateAdded: "2024-01-02",
    createdBy: "user-1",
    modifiedBy: "user-1",
  },
];

let mockRumors: any[] = [
  {
    id: "r-1",
    title: "Strange lights",
    content: "They say dragons are flying...",
    dateModified: "2024-01-03",
    dateAdded: "2024-01-03",
    createdBy: "user-1",
    modifiedBy: "user-1",
  },
];

let mockNpcs: any[] = [
  {
    id: "npc-1",
    name: "Gandalf",
    description: "A wizard...",
    dateModified: "2024-01-04",
    dateAdded: "2024-01-04",
    createdBy: "user-1",
    modifiedBy: "user-1",
  },
];

let mockLocations: any[] = [
  {
    id: "loc-1",
    name: "The Tavern",
    description: "A cozy inn...",
    dateModified: "2024-01-05",
    dateAdded: "2024-01-05",
    createdBy: "user-1",
    modifiedBy: "user-1",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderPage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("HomePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { uid: "user-1" };
    mockIsResolving = false;
    mockActiveGroupId = "group-1";
    mockActiveCampaignId = "campaign-1";
    mockGroups = [{ id: "group-1", name: "The Fellowship" }];
    mockIsLoading = false;
    mockChapters = [
      {
        id: "ch-1",
        title: "Chapter 1",
        order: 1,
        content: "Content here...",
        dateModified: "2024-01-01",
        dateAdded: "2024-01-01",
        createdBy: "user-1",
        modifiedBy: "user-1",
      },
    ];
    mockQuests = [
      {
        id: "q-1",
        title: "Find the artifact",
        description: "A quest for glory",
        dateModified: "2024-01-02",
        dateAdded: "2024-01-02",
        createdBy: "user-1",
        modifiedBy: "user-1",
      },
    ];
    mockRumors = [
      {
        id: "r-1",
        title: "Strange lights",
        content: "They say dragons are flying...",
        dateModified: "2024-01-03",
        dateAdded: "2024-01-03",
        createdBy: "user-1",
        modifiedBy: "user-1",
      },
    ];
    mockNpcs = [
      {
        id: "npc-1",
        name: "Gandalf",
        description: "A wizard...",
        dateModified: "2024-01-04",
        dateAdded: "2024-01-04",
        createdBy: "user-1",
        modifiedBy: "user-1",
      },
    ];
    mockLocations = [
      {
        id: "loc-1",
        name: "The Tavern",
        description: "A cozy inn...",
        dateModified: "2024-01-05",
        dateAdded: "2024-01-05",
        createdBy: "user-1",
        modifiedBy: "user-1",
      },
    ];
  });

  // -------------------------------------------------------------------------
  // Gated states
  // -------------------------------------------------------------------------
  describe("gated states", () => {
    // Rewritten from "renders DashboardLayout by default" for a signed-out
    // user: the old behaviour (a dashboard of zeros) is exactly what this
    // change removes. `getByRole("heading", { level: 1 })` is scoped to the
    // level-1 heading deliberately -- SignedOutHome's body prose repeats
    // words ("campaign", "chapters") that also appear elsewhere in the page,
    // so an unscoped text query would be ambiguous.
    // Awaited: signed-out Home loads lazily, so the example it carries stays
    // out of every member's entry bundle.
    it("explains the product instead of a dashboard of zeros while signed out", async () => {
      mockUser = null;
      renderPage();
      expect(
        await screen.findByRole("heading", { level: 1 })
      ).toHaveTextContent(/everything your table agreed happened/i);
      expect(screen.queryByTestId("dashboard-layout")).not.toBeInTheDocument();
    });

    // Adapted from the brief: with the shared mock's `getCampaigns` resolving
    // to `[]` (nobody's campaign list is populated), the pick-campaign panel
    // lands on its "no campaigns yet" wording rather than "Which campaign?" --
    // both are the same panel and are asserted the way LocationsPage/NPCsPage
    // already do, via the eyebrow text that is common to every pick-campaign
    // sub-state, rather than by guessing which sub-state the empty fixture
    // produces.
    it("asks a signed-in member with no campaign to pick one, not a dashboard", () => {
      mockActiveCampaignId = null;
      renderPage();
      expect(screen.getByTestId("gated-eyebrow")).toHaveTextContent(
        /no campaign chosen/i
      );
      expect(screen.queryByTestId("dashboard-layout")).not.toBeInTheDocument();
    });

    // Closes a gap the review flagged: every gated page suite (this one
    // included, in the "no campaign to pick one" test above) mocks
    // `getCampaigns` to resolve `[]`, so the "choose" sub-state -- where the
    // fetched campaigns actually reach the panel and render as choices -- has
    // never been exercised end to end, even though GatedPageState.test.tsx
    // proves the panel renders correctly *given* a campaigns prop. This test
    // drives the real chain: useSelectableCampaigns -> firebaseServices
    // .campaign.getCampaigns -> GatedContent -> GatedPageState.
    it("lists the user's actual campaigns as clickable choices once they arrive", async () => {
      mockActiveCampaignId = null;
      (firebaseServices.campaign.getCampaigns as jest.Mock).mockResolvedValueOnce([
        { id: "campaign-1", name: "Phandelver" },
      ]);
      renderPage();

      // The fetch is async, so this must be awaited rather than queried
      // synchronously -- the panel starts in "No campaigns yet" and only
      // reaches "choose" once the promise resolves.
      expect(
        await screen.findByRole("heading", { name: /which campaign\?/i })
      ).toBeInTheDocument();

      // The choice is a real, clickable button in the panel itself -- not
      // just text naming the campaign -- because the whole design point was
      // that the choice is made here, not by sending the user elsewhere.
      const campaignChoice = screen.getByRole("button", {
        name: /phandelver/i,
      });
      expect(campaignChoice).toBeInTheDocument();
      // The row also names the group the campaign lives in, which is what
      // disambiguates two same-named campaigns in different groups.
      expect(campaignChoice).toHaveTextContent(mockGroups[0].name);
    });

    it("shows a skeleton and no panel while context is resolving", () => {
      mockIsResolving = true;
      renderPage();
      expect(screen.getByTestId("gated-skeleton")).toBeInTheDocument();
      expect(screen.queryByText(/which campaign/i)).not.toBeInTheDocument();
      expect(screen.queryByTestId("dashboard-layout")).not.toBeInTheDocument();
    });

    // PageShell renders its own `h1` ("Campaign Home") in the non-ready,
    // non-signed-out states, so the page never loses its identity while
    // resolving or waiting on a campaign pick.
    it("still shows a page heading while resolving", () => {
      mockIsResolving = true;
      renderPage();
      expect(
        screen.getByRole("heading", { level: 1, name: "Campaign Home" })
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Rendering (ready state)
  // -------------------------------------------------------------------------
  describe("rendering", () => {
    it("renders without crashing", () => {
      const { container } = renderPage();
      expect(container).toBeInTheDocument();
    });

    it("renders the dashboard, the one layout Home has", () => {
      renderPage();
      expect(screen.getByTestId("dashboard-layout")).toBeInTheDocument();
    });

    // The segmented view chooser went with the alternate layout it switched to
    // (D39). Home has one view, so it offers no way to choose one.
    it("offers no view chooser", () => {
      renderPage();
      expect(
        screen.queryByRole("group", { name: /choose a view/i })
      ).not.toBeInTheDocument();
    });
  });

  describe("hero band", () => {
    // These moved here from DashboardLayout when the band was lifted above the
    // page column, which it has to be: it bleeds to the viewport edges and that
    // column sets `overflow-x-hidden`.
    it("renders the hero band on the dashboard view", () => {
      renderPage();
      expect(screen.getByTestId("campaign-banner")).toBeInTheDocument();
    });

    it("passes the chapter count to the band's meta line", () => {
      renderPage();
      expect(screen.getByTestId("campaign-banner")).toHaveAttribute(
        "data-chapter-count",
        String(mockChapters.length)
      );
    });

    it("renders the band outside the clipping page column", () => {
      // A bleed inside a clipping ancestor is cut back to that ancestor's
      // width, which is what made the band render as a floating card.
      const { container } = renderPage();
      const band = screen.getByTestId("campaign-banner");
      const clipped = container.querySelector(".overflow-x-hidden");
      expect(clipped).toBeInTheDocument();
      expect(clipped?.contains(band)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Activities
  // -------------------------------------------------------------------------
  describe("activity computation", () => {
    it("includes chapter in activities when only dateAdded is set (dateModified || dateAdded fallback)", () => {
      // BUG #850: Chapters use `dateModified || dateAdded` so a chapter without
      // dateModified is still included via dateAdded. This differs from quests/rumors/npcs/locations
      // which require dateModified. Test documents actual behavior.
      mockChapters = [
        {
          id: "ch-no-datemod",
          title: "Undated Chapter",
          order: 1,
          content: "...",
          // No dateModified, only dateAdded
          dateAdded: "2024-01-01",
        },
      ];
      renderPage();
      const activityCount = parseInt(
        screen.getByTestId("dashboard-layout").getAttribute("data-activity-count") || "0"
      );
      // Chapter is included via dateAdded fallback, plus 4 others = 5
      expect(activityCount).toBe(5);
    });

    it("generates correct activity type for quests", () => {
      // Smoke test: just ensure no crash with quest data
      renderPage();
      expect(screen.getByTestId("dashboard-layout")).toBeInTheDocument();
    });

    it("generates correct link for chapter activities", () => {
      // Passed through as activities prop — just verify it renders
      renderPage();
      expect(screen.getByTestId("dashboard-layout")).toBeInTheDocument();
    });

    // Bug #850: chapters used a `dateModified || dateAdded` fallback while
    // quests, rumors, npcs and locations required `dateModified` strictly —
    // so a never-modified quest/rumor/npc/location was silently excluded
    // from recent activity even though it was newly created. The fix unifies
    // all five branches on the fallback.
    it("includes a quest in activities when only dateAdded is set (dateModified || dateAdded fallback)", () => {
      mockQuests = [
        {
          id: "q-no-datemod",
          title: "Undated Quest",
          description: "...",
          dateAdded: "2024-01-02",
        },
      ];
      renderPage();
      const activityCount = parseInt(
        screen.getByTestId("dashboard-layout").getAttribute("data-activity-count") || "0"
      );
      // Quest is included via dateAdded fallback, plus 4 others (chapter, rumor, npc, location) = 5
      expect(activityCount).toBe(5);
    });

    it("includes a rumor in activities when only dateAdded is set (dateModified || dateAdded fallback)", () => {
      mockRumors = [
        {
          id: "r-no-datemod",
          title: "Undated Rumor",
          content: "...",
          dateAdded: "2024-01-03",
        },
      ];
      renderPage();
      const activityCount = parseInt(
        screen.getByTestId("dashboard-layout").getAttribute("data-activity-count") || "0"
      );
      expect(activityCount).toBe(5);
    });

    it("includes an NPC in activities when only dateAdded is set (dateModified || dateAdded fallback)", () => {
      mockNpcs = [
        {
          id: "npc-no-datemod",
          name: "Undated NPC",
          description: "...",
          dateAdded: "2024-01-04",
        },
      ];
      renderPage();
      const activityCount = parseInt(
        screen.getByTestId("dashboard-layout").getAttribute("data-activity-count") || "0"
      );
      expect(activityCount).toBe(5);
    });

    it("includes a location in activities when only dateAdded is set (dateModified || dateAdded fallback)", () => {
      mockLocations = [
        {
          id: "loc-no-datemod",
          name: "Undated Location",
          description: "...",
          dateModified: undefined,
          dateAdded: "2024-01-05",
        },
      ];
      renderPage();
      const activityCount = parseInt(
        screen.getByTestId("dashboard-layout").getAttribute("data-activity-count") || "0"
      );
      expect(activityCount).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // Loading state passthrough
  // -------------------------------------------------------------------------
  describe("loading state", () => {
    it("passes loading=false to DashboardLayout when not loading", () => {
      renderPage();
      expect(screen.getByTestId("dashboard-layout")).toHaveAttribute(
        "data-loading",
        "false"
      );
    });

    // Rewritten: a content fetch in flight now folds into the gate's
    // `resolving` state (via `usePageGate("home", { loading: ... })`), so the
    // page shows the shared skeleton instead of mounting DashboardLayout with
    // `loading=true`.
    it("shows the shared skeleton, not DashboardLayout, when content is loading", () => {
      mockIsLoading = true;
      renderPage();
      expect(screen.getByTestId("gated-skeleton")).toBeInTheDocument();
      expect(screen.queryByTestId("dashboard-layout")).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Empty data
  // -------------------------------------------------------------------------
  describe("empty data", () => {
    it("renders without crashing when all content arrays are empty", () => {
      mockChapters = [];
      mockQuests = [];
      mockRumors = [];
      mockNpcs = [];
      mockLocations = [];
      const { container } = renderPage();
      expect(container).toBeInTheDocument();
    });

    it("passes empty activities to DashboardLayout when no content exists", () => {
      mockChapters = [];
      mockQuests = [];
      mockRumors = [];
      mockNpcs = [];
      mockLocations = [];
      renderPage();
      expect(screen.getByTestId("dashboard-layout")).toHaveAttribute(
        "data-activity-count",
        "0"
      );
    });
  });
});
