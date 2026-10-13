// src/pages/quests/__tests__/QuestsPage.test.tsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import QuestsPage from "../QuestsPage";

// ---------------------------------------------------------------------------
// Since the roster moved out of this page and into QuestDirectory, the page's
// job is the header, the create action and wiring usePageGate/GatedContent.
// The directory is mocked here the same way NPCDirectory/RumorDirectory/
// LocationDirectory are in their pages' suites — the roster's own behaviour is
// covered by
// features/campaign-entities/quests/components/__tests__/QuestDirectory.test.tsx.
//
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
  // `loading` is the flag useCampaignContextStatus reads for `isResolving`.
  // Mocked here rather than mocking the status hook itself, so the real
  // "still restoring vs. resolved to nothing" logic stays under test -- that
  // distinction is bug #1413 and the reason state 1 exists.
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

interface QuestContextMock {
  quests: unknown[];
  loading: boolean;
  error: string | null;
  loadError?: string | null;
}

let mockQuestContext: QuestContextMock = {
  quests: [],
  loading: false,
  error: null,
};

jest.mock("features/campaign-entities", () => ({
  // What the example draws is QuestExample's own suite; here, only where the
  // page puts it.
  QuestExample: () => <section aria-label="Example campaign">the example campaign's quests</section>,
  useQuests: () => mockQuestContext,
  QuestDirectory: (props: { quests?: unknown[] }) => (
    <div data-testid="quest-directory">
      <span data-testid="quest-directory-count">{props.quests?.length}</span>
    </div>
  ),
}));

const mockNavigateToPage = jest.fn();

jest.mock("shared/hooks/useNavigation", () => ({
  useNavigation: () => ({
    navigateToPage: mockNavigateToPage,
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <QuestsPage />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("QuestsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { uid: "user-1" };
    mockIsResolving = false;
    mockActiveGroupId = "group-1";
    mockActiveCampaignId = "campaign-1";
    mockGroups = [{ id: "group-1", name: "The Fellowship" }];
    mockQuestContext = {
      quests: [{ id: "q1" }, { id: "q2" }, { id: "q3" }],
      loading: false,
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
        screen.getByRole("heading", { level: 1, name: "Campaign Quests" })
      ).toBeInTheDocument();
    });

    it("asks a signed-out visitor to sign in, and never to select a group", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.getByRole("heading", {
          name: /sign in to see your party's quests/i,
        })
      ).toBeInTheDocument();
      // The bug: Header only renders ContextSwitcher for members, so this page
      // used to name a control the visitor could not see.
      expect(screen.queryByText(/select a group/i)).not.toBeInTheDocument();
    });

    it("hides the create action while signed out", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.queryByRole("button", { name: /create quest/i })
      ).not.toBeInTheDocument();
    });

    it("shows a skeleton and no message while context is still resolving", () => {
      mockIsResolving = true;
      renderPage();
      expect(screen.getByTestId("gated-skeleton")).toBeInTheDocument();
      expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
    });

    // Rewritten: the pre-gate suite asserted the page's own "No Campaign
    // Selected" / "No Group Selected" copy here. That was the layering
    // mistake this PR removes -- usePageGate now derives the state and
    // GatedContent renders the shared pick-campaign panel instead.
    it("shows the shared pick-campaign panel, not the old copy, when no campaign is selected", () => {
      mockActiveCampaignId = null;
      renderPage();
      expect(
        screen.queryByText("No Campaign Selected")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/please select a campaign within your group/i)
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("gated-eyebrow")).toHaveTextContent(
        /no campaign chosen/i
      );
      expect(screen.queryByTestId("quest-directory")).not.toBeInTheDocument();
    });

    it("shows the shared pick-campaign panel, not the old copy, when no group is selected", () => {
      mockActiveGroupId = null;
      renderPage();
      expect(screen.queryByText("No Group Selected")).not.toBeInTheDocument();
      expect(
        screen.queryByText(/please select a group to view quests/i)
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("gated-eyebrow")).toHaveTextContent(
        /no campaign chosen/i
      );
    });

    // Rewritten: the pre-gate suite asserted the page's own inline error
    // copy ("Error Loading Quests. Sign in to view content.") here.
    // GatedContent now owns the error panel and names the noun and the
    // real error message instead.
    it("shows the shared error panel, not the old inline copy, on a fetch error", () => {
      mockQuestContext = {
        ...mockQuestContext,
        error: "Firebase error",
        loadError: "Firebase error",
        quests: [],
      };
      renderPage();
      expect(
        screen.queryByText("Error Loading Quests. Sign in to view content.")
      ).not.toBeInTheDocument();
      expect(screen.getByText(/couldn't load quests/i)).toBeInTheDocument();
      expect(screen.getByText("Firebase error")).toBeInTheDocument();
      expect(screen.queryByTestId("quest-directory")).not.toBeInTheDocument();
    });

    // T085 (REACT-002): a rejected write is reported through `error`, but the
    // records loaded fine, so the page stays up.
    it("keeps the quests on the page when only a write failed", () => {
      mockQuestContext = { ...mockQuestContext, error: "Write refused", loadError: null };
      renderPage();
      expect(screen.getByTestId("quest-directory")).toBeInTheDocument();
      expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Page header / create action
  // -------------------------------------------------------------------------
  describe("page header", () => {
    it("renders the heading and subtitle", () => {
      renderPage();
      expect(screen.getByText("Campaign Quests")).toBeInTheDocument();
      expect(
        screen.getByText("Track your party's epic adventures and missions")
      ).toBeInTheDocument();
    });

    it('shows "Create Quest" for a ready user and navigates on click', () => {
      renderPage();
      fireEvent.click(screen.getByText("Create Quest"));
      expect(mockNavigateToPage).toHaveBeenCalledWith("/quests/create");
    });
  });

  // -------------------------------------------------------------------------
  // Directory handoff
  // -------------------------------------------------------------------------
  describe("quest directory", () => {
    it("renders the directory once group, campaign and data are all ready", () => {
      renderPage();
      expect(screen.getByTestId("quest-directory")).toBeInTheDocument();
    });

    it("passes every quest through, unfiltered — filtering is the directory's job", () => {
      renderPage();
      expect(screen.getByTestId("quest-directory-count")).toHaveTextContent(
        "3"
      );
    });
  });
});
