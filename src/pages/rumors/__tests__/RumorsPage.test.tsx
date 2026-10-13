// src/pages/rumors/__tests__/RumorsPage.test.tsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import RumorsPage from "../RumorsPage";

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

interface RumorContextMock {
  rumors: any[];
  isLoading: boolean;
  error: string | null;
  loadError?: string | null;
}

let mockRumorContext: RumorContextMock = {
  rumors: [],
  isLoading: false,
  error: null,
};

// The mocked RumorDirectory below mirrors the controls the real component
// genuinely owns (src/features/campaign-entities/rumors/components/
// RumorDirectory.tsx), so that a test asserting their absence is proving
// something about GatedContent's children-gating rather than about an empty
// div nothing ever populates. Checked against the real component's actual
// accessible surface, not guessed:
//   - RosterStatusBar's total line -- "N rumors gathered" (no ARIA
//     `progressbar` role; it's a plain proportional bar, so this is queried
//     by its real text instead of an invented role).
//   - RosterFilterBar's search field -- a bare `<Input placeholder="Search
//     rumors...">` with no `type` or `aria-label`, so its real role is
//     "textbox", not "searchbox"; queried by its real placeholder text.
//   - The "Select Rumors" button -- a real `<Button>`, role "button", name
//     "Select Rumors" exactly as guessed.
jest.mock("features/campaign-entities", () => ({
  // What the example draws is RumorExample's own suite; here, only where the
  // page puts it.
  RumorExample: () => <section aria-label="Example campaign">the example campaign's rumours</section>,
  useRumors: () => mockRumorContext,
  RumorDirectory: (props: any) => (
    <div data-testid="rumor-directory">
      <span data-testid="rumor-directory-count">{props.rumors?.length}</span>
      <span>{props.rumors?.length ?? 0} rumours gathered</span>
      <input placeholder="Search rumours..." />
      <button type="button">Select Rumours</button>
    </div>
  ),
}));

const mockNavigateToPage = jest.fn();

jest.mock("shared/hooks/useNavigation", () => ({
  useNavigation: () => ({
    navigateToPage: mockNavigateToPage,
  }),
}));

// ---------------------------------------------------------------------------
// Sample rumor data
// ---------------------------------------------------------------------------
const sampleRumors = [
  { id: "r1", title: "The Dragon Returns", status: "confirmed" },
  { id: "r2", title: "Missing Merchant", status: "unconfirmed" },
  { id: "r3", title: "Haunted Mill", status: "unconfirmed" },
  { id: "r4", title: "False Prophecy", status: "false" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderPage() {
  return render(
    <MemoryRouter>
      <RumorsPage />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("RumorsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { uid: "user-1" };
    mockIsResolving = false;
    mockActiveGroupId = "group-1";
    mockActiveCampaignId = "campaign-1";
    mockGroups = [{ id: "group-1", name: "The Fellowship" }];
    mockRumorContext = {
      rumors: [...sampleRumors],
      isLoading: false,
      error: null,
    };
  });

  // -------------------------------------------------------------------------
  // Gated states
  // -------------------------------------------------------------------------
  describe("gated states", () => {
    it("shows a signed-out visitor the example campaign under the sign-in", () => {
      mockUser = null;
      renderPage();
      const example = screen.getByRole("region", { name: "Example campaign" });
      const signIn = screen.getByRole("link", { name: "Sign in" });
      expect(signIn.compareDocumentPosition(example) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("shows a signed-in member no example", () => {
      renderPage();
      expect(screen.queryByRole("region", { name: "Example campaign" })).not.toBeInTheDocument();
    });

    it("renders the page title and subtitle while signed out", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.getByRole("heading", { level: 1, name: "Rumours" })
      ).toBeInTheDocument();
    });

    it("asks a signed-out visitor to sign in, and never to select a group", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.getByRole("heading", {
          name: /sign in to hear what the realm is saying/i,
        })
      ).toBeInTheDocument();
      expect(screen.queryByText(/select a group/i)).not.toBeInTheDocument();
    });

    it("hides the create action while signed out", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.queryByRole("button", { name: /add rumour/i })
      ).not.toBeInTheDocument();
    });

    it("shows a skeleton and no message while context is still resolving", () => {
      mockIsResolving = true;
      renderPage();
      expect(screen.getByTestId("gated-skeleton")).toBeInTheDocument();
      expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
    });

    it("shows the skeleton on the first load, when there is nothing to show yet", () => {
      mockRumorContext = { ...mockRumorContext, rumors: [], isLoading: true };
      renderPage();
      expect(screen.getByTestId("gated-skeleton")).toBeInTheDocument();
    });

    it("asks the gate exactly what the data hook told it, and nothing else", () => {
      // CHANGED DELIBERATELY: this used to assert that the page itself
      // discounted `isLoading` while it had rumors to show, because the page
      // was the only place that knew the difference between "nothing to show
      // yet" and "a fetch is in flight". `useRumorData` draws that line now,
      // for every consumer at once -- the same defect was live on `/quests`,
      // `/locations`, `/npcs` and `/` while only this page was guarded -- so
      // the guarantee is tested where it is implemented (see
      // `useQuestData.test.ts`, and each sibling hook's suite) and what is
      // left here is that this page does not second-guess it.
      mockRumorContext = { ...mockRumorContext, isLoading: true };
      renderPage();
      expect(screen.getByTestId("gated-skeleton")).toBeInTheDocument();
    });

    // Positive half of the pair below: proves the mocked RumorDirectory's
    // controls genuinely render (and are queryable the way the assertions
    // below look for them) once the gate reaches "ready", so their absence
    // in the signed-out test cannot be vacuously true.
    it("shows the rumor directory's controls once the gate is ready", () => {
      renderPage();
      expect(screen.getByText(/rumours gathered/i)).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("Search rumours...")
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /select rumours/i })
      ).toBeInTheDocument();
    });

    // The DoD line this PR was written for: nothing that cannot act renders
    // for a signed-out visitor, not even by accident through a directory
    // that used to be handed an empty array. Paired with the "ready" test
    // above -- these controls are real, so their absence here is a real
    // assertion about GatedContent's children-gating.
    it("shows no control that cannot act while signed out", () => {
      mockUser = null;
      renderPage();
      expect(screen.queryByTestId("rumor-directory")).not.toBeInTheDocument();
      expect(screen.queryByText(/rumours gathered/i)).not.toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText("Search rumours...")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /select rumours/i })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /add rumour/i })
      ).not.toBeInTheDocument();
    });

    // Rewritten: the old inline error copy is gone; GatedContent's error
    // panel names the noun and the real error message instead.
    it("shows the shared error panel, not the old inline copy, on a fetch error", () => {
      mockRumorContext = { ...mockRumorContext, error: "Firebase error", loadError: "Firebase error" };
      renderPage();
      expect(
        screen.queryByText("Error Loading Rumours. Sign in to view content.")
      ).not.toBeInTheDocument();
      expect(screen.getByText(/couldn't load rumours/i)).toBeInTheDocument();
      expect(screen.getByText("Firebase error")).toBeInTheDocument();
      expect(
        screen.queryByTestId("rumor-directory")
      ).not.toBeInTheDocument();
    });

    // T085 (REACT-002): a rejected write is reported through `error`, but the
    // records loaded fine, so the page stays up.
    it("keeps the rumours on the page when only a write failed", () => {
      mockRumorContext = { ...mockRumorContext, error: "Write refused", loadError: null };
      renderPage();
      expect(screen.getByTestId("rumor-directory")).toBeInTheDocument();
      expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Loaded state
  // -------------------------------------------------------------------------
  describe("loaded state", () => {
    it("renders without crashing", () => {
      const { container } = renderPage();
      expect(container).toBeInTheDocument();
    });

    it("renders the page heading 'Rumors'", () => {
      renderPage();
      expect(
        screen.getByRole("heading", { level: 1, name: "Rumours" })
      ).toBeInTheDocument();
    });

    it("renders the rumor directory", () => {
      renderPage();
      expect(screen.getByTestId("rumor-directory")).toBeInTheDocument();
    });

    it("passes all rumors to the directory", () => {
      renderPage();
      expect(screen.getByTestId("rumor-directory-count")).toHaveTextContent(
        "4"
      );
    });
  });

  // -------------------------------------------------------------------------
  // Create button
  // -------------------------------------------------------------------------
  describe("how a rumour gets added", () => {
    it("carries no header action, because the composer is in the list", () => {
      // CHANGED DELIBERATELY in `15-7` item 1. A rumour is written down while
      // somebody is still talking, so the way in is a composer at the top of
      // the list -- and a header button that leaves for `/rumors/create`
      // would be the page contradicting the control directly below it.
      renderPage();
      expect(screen.queryByText("Add Rumour")).not.toBeInTheDocument();
      expect(mockNavigateToPage).not.toHaveBeenCalledWith("/rumors/create");
    });
  });

  // -------------------------------------------------------------------------
  // Dialogs: RumorsPage no longer owns a batch-actions flow. The working
  // combine/convert flow lives in RumorDirectory -> RumorBatchActions, which
  // renders its own CombineRumorsDialog/ConvertToQuestDialog instances.
  // RumorsPage itself never imports them.
  // -------------------------------------------------------------------------
  describe("dialogs", () => {
    it("does NOT render its own CombineRumorsDialog", () => {
      renderPage();
      expect(
        screen.queryByTestId("combine-rumors-dialog")
      ).not.toBeInTheDocument();
    });

    it("does NOT render its own ConvertToQuestDialog", () => {
      renderPage();
      expect(
        screen.queryByTestId("convert-quest-dialog")
      ).not.toBeInTheDocument();
    });
  });
});
