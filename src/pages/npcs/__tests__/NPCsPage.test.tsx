// src/pages/npcs/__tests__/NPCsPage.test.tsx
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EXAMPLE_CAMPAIGN } from "shared/example-campaign/example-campaign";
import NPCsPage from "../NPCsPage";

// ---------------------------------------------------------------------------
// GatedContent and usePageGate are exercised for real (not mocked), so the
// features/user-management mock below is extended with everything
// GatedContent needs — see .superpowers/sdd/2026-09-03-gated-page-states/
// page-suite-mock.md.
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

interface NPCDataMock {
  npcs: any[];
  isLoading: boolean;
  error: string | null;
  loadError?: string | null;
  refreshNPCs: jest.Mock;
  hasRequiredContext: boolean;
}

let mockNPCData: NPCDataMock = {
  npcs: [],
  isLoading: false,
  error: null,
  refreshNPCs: jest.fn(),
  hasRequiredContext: true,
};

jest.mock("features/campaign-entities", () => ({
  // The real example: what it draws is what the signed-out tests are about.
  NPCExample: jest.requireActual("features/campaign-entities/npcs/components/NPCExample").default,
  useNPCs: () => mockNPCData,
  NPCDirectory: (props: any) => (
    <div data-testid="npc-directory">
      <span data-testid="npc-directory-count">{props.npcs?.length}</span>
      <button data-testid="npc-directory-update" onClick={() => props.onNPCUpdate?.()}>
        update
      </button>
      <button data-testid="npc-directory-delete" onClick={() => props.onNPCDelete?.("npc-1")}>
        delete
      </button>
    </div>
  ),
}));

const mockNavigateToPage = jest.fn();

jest.mock("shared/context/NavigationContext", () => ({
  useNavigation: () => ({
    navigateToPage: mockNavigateToPage,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderPage() {
  return render(
    <MemoryRouter>
      <NPCsPage />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("NPCsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { uid: "user-1" };
    mockIsResolving = false;
    mockActiveGroupId = "group-1";
    mockActiveCampaignId = "campaign-1";
    mockGroups = [{ id: "group-1", name: "The Fellowship" }];
    mockNPCData = {
      npcs: [
        { id: "npc-1", name: "Gandalf", status: "alive" },
        { id: "npc-2", name: "Aragorn", status: "alive" },
        { id: "npc-3", name: "Boromir", status: "deceased" },
        { id: "npc-4", name: "Frodo", status: "missing" },
      ],
      isLoading: false,
      error: null,
      refreshNPCs: jest.fn(),
      hasRequiredContext: true,
    };
  });

  // -------------------------------------------------------------------------
  // Gated states
  // -------------------------------------------------------------------------
  describe("gated states", () => {
    it("shows a signed-out visitor the example campaign's npcs under the panel, as rows that do nothing", () => {
      mockUser = null;
      renderPage();
      const example = screen.getByTestId("roster-example");
      EXAMPLE_CAMPAIGN.npcs.forEach((row) =>
        expect(within(example).getByText(row.name)).toBeInTheDocument()
      );
      expect(within(example).queryAllByRole("button", { hidden: true })).toHaveLength(0);
      const signIn = screen.getByRole("link", { name: "Sign in" });
      expect(signIn.compareDocumentPosition(example) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("shows a signed-in member no example", () => {
      renderPage();
      expect(screen.queryByTestId("roster-example")).not.toBeInTheDocument();
    });

    it("renders the page title and subtitle while signed out", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.getByRole("heading", { level: 1, name: "NPCs" })
      ).toBeInTheDocument();
    });

    it("asks a signed-out visitor to sign in, and never to select a group", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.getByRole("heading", {
          name: /sign in to see who your party has met/i,
        })
      ).toBeInTheDocument();
      expect(screen.queryByText(/select a group/i)).not.toBeInTheDocument();
    });

    it("hides the create action while signed out", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.queryByRole("button", { name: /add npc/i })
      ).not.toBeInTheDocument();
    });

    it("shows a skeleton and no message while context is still resolving", () => {
      mockIsResolving = true;
      renderPage();
      expect(screen.getByTestId("gated-skeleton")).toBeInTheDocument();
      expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
    });

    // Rewritten: the pre-gate suite asserted this page's own
    // "Please select a group/campaign to view NPCs" copy (built by the
    // `contextError` memo this PR deletes). usePageGate now derives the
    // state and GatedContent renders the shared pick-campaign panel.
    it("shows the shared pick-campaign panel, not the old copy, when no group is selected", () => {
      mockActiveGroupId = null;
      renderPage();
      expect(
        screen.queryByText("Please select a group to view NPCs")
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("gated-eyebrow")).toHaveTextContent(
        /no campaign chosen/i
      );
      expect(screen.queryByTestId("npc-directory")).not.toBeInTheDocument();
    });

    it("shows the shared pick-campaign panel, not the old copy, when no campaign is selected", () => {
      mockActiveCampaignId = null;
      renderPage();
      expect(
        screen.queryByText("Please select a campaign to view NPCs")
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("gated-eyebrow")).toHaveTextContent(
        /no campaign chosen/i
      );
      expect(screen.queryByTestId("npc-directory")).not.toBeInTheDocument();
    });

    // Rewritten: the old inline error copy is gone; GatedContent's error
    // panel names the noun and the real error message, and offers a retry
    // wired to refreshNPCs.
    it("shows the shared error panel, not the old inline copy, on a fetch error", () => {
      mockNPCData = { ...mockNPCData, error: "Firebase error", loadError: "Firebase error" };
      renderPage();
      expect(
        screen.queryByText("Error Loading NPCs. Sign in to view content.")
      ).not.toBeInTheDocument();
      expect(screen.getByText(/couldn't load npcs/i)).toBeInTheDocument();
      expect(screen.getByText("Firebase error")).toBeInTheDocument();
      expect(screen.queryByTestId("npc-directory")).not.toBeInTheDocument();
    });

    it("retries through refreshNPCs from the error panel", () => {
      mockNPCData = { ...mockNPCData, error: "Firebase error", loadError: "Firebase error" };
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      expect(mockNPCData.refreshNPCs).toHaveBeenCalledTimes(1);
    });

    // T085 (REACT-002): a rejected write is reported through `error`, but the
    // records loaded fine, so the page stays up.
    it("keeps the NPCs on the page when only a write failed", () => {
      mockNPCData = { ...mockNPCData, error: "Write refused", loadError: null };
      renderPage();
      expect(screen.getByTestId("npc-directory")).toBeInTheDocument();
      expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Loaded state
  // -------------------------------------------------------------------------
  describe("loaded state with NPCs", () => {
    it("renders without crashing", () => {
      const { container } = renderPage();
      expect(container).toBeInTheDocument();
    });

    it("renders the page heading", () => {
      renderPage();
      expect(
        screen.getByRole("heading", { level: 1, name: "NPCs" })
      ).toBeInTheDocument();
    });

    it("renders the NPC directory", () => {
      renderPage();
      expect(screen.getByTestId("npc-directory")).toBeInTheDocument();
    });

    it("passes all NPCs to the directory", () => {
      renderPage();
      expect(screen.getByTestId("npc-directory-count")).toHaveTextContent(
        "4"
      );
    });
  });

  // -------------------------------------------------------------------------
  // Create button
  // -------------------------------------------------------------------------
  describe("Add NPC button", () => {
    it("shows 'Add NPC' button for a ready user", () => {
      renderPage();
      expect(screen.getByText("Add NPC")).toBeInTheDocument();
    });

    it("navigates to /npcs/create on click", () => {
      renderPage();
      fireEvent.click(screen.getByText("Add NPC"));
      expect(mockNavigateToPage).toHaveBeenCalledWith("/npcs/create");
    });
  });

  // -------------------------------------------------------------------------
  // Data ownership (T046)
  // -------------------------------------------------------------------------
  describe("data ownership", () => {
    test("renders the provider's NPCs, not a second copy of its own", () => {
      mockNPCData = {
        ...mockNPCData,
        npcs: [{ id: "gundren", name: "Gundren" }, { id: "sildar", name: "Sildar" }],
      };

      renderPage();

      // If the page held its own loader, this would render that loader's
      // array -- which a write through the context never updates.
      expect(screen.getByTestId("npc-directory-count")).toHaveTextContent("2");
    });

    // REWRITTEN (PERF-06). This test used to assert the opposite: that the
    // page passed the provider's `refreshNPCs` as `onNPCUpdate`, so every
    // stance change fetched the collection twice. The requirement behind it
    // (T046) is that the page renders the PROVIDER's copy, which is pinned by
    // "renders the provider's NPCs" above and by the fetch-count suite in
    // `redundant-refreshes.test.tsx`; `updateNPCRelationship` is what refreshes
    // that copy, so a second refresh from the page only repeats the read.
    test("a directory update does not trigger a second refresh", () => {
      const refreshNPCs = jest.fn();
      mockNPCData = { ...mockNPCData, npcs: [], refreshNPCs };

      renderPage();
      screen.getByTestId("npc-directory-update").click();

      expect(refreshNPCs).not.toHaveBeenCalled();
    });

    test("a directory delete does not re-read the collection", () => {
      // The page renders the provider's listener copy (T032), which follows
      // every change without being asked.
      const refreshNPCs = jest.fn();
      mockNPCData = { ...mockNPCData, npcs: [], refreshNPCs };

      renderPage();
      screen.getByTestId("npc-directory-delete").click();

      expect(refreshNPCs).not.toHaveBeenCalled();
    });
  });
});
