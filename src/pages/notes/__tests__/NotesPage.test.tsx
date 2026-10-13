// src/pages/notes/__tests__/NotesPage.test.tsx
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotesPage from "../NotesPage";

// ---------------------------------------------------------------------------
// react-router-dom mocks
// ---------------------------------------------------------------------------
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useLocation: () => ({ pathname: "/notes", search: "", hash: "" }),
}));

// ---------------------------------------------------------------------------
// Page-suite gate mock (shared across Tasks 8-13 -- see page-suite-mock.md).
// `notes` now requires a campaign, same as every other gated page (see
// gated-page-copy.ts) -- `mockActiveCampaignId = null` reaches `pick-campaign`,
// not `ready`.
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

// ---------------------------------------------------------------------------
// Child component mocks
// ---------------------------------------------------------------------------
// NotesList, useNotes and useCreateNote all come from the collaboration
// domain barrel now, so they are mocked together in a single factory.
jest.mock("features/collaboration", () => ({
  NotesList: () => <div data-testid="notes-list" />,
  // What the example draws is NoteExample's own suite; here, only where the
  // page puts it.
  NoteExample: () => <section aria-label="Example campaign">one player's note</section>,
  useNotes: jest.fn(),
  useCreateNote: jest.fn(),
}));

const { useNotes, useCreateNote } = require("features/collaboration");

const mockCreateAndOpen = jest.fn();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderPage() {
  return render(
    <MemoryRouter>
      <NotesPage />
    </MemoryRouter>
  );
}

function setupMocks({
  isLoading = false,
}: {
  isLoading?: boolean;
} = {}) {
  (useNotes as jest.Mock).mockReturnValue({ isLoading });
  (useCreateNote as jest.Mock).mockReturnValue({ createAndOpen: mockCreateAndOpen });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("NotesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { uid: "user-1" };
    mockIsResolving = false;
    mockActiveGroupId = "group-1";
    mockActiveCampaignId = "campaign-1";
    mockGroups = [{ id: "group-1", name: "The Fellowship" }];
    setupMocks();
  });

  // -------------------------------------------------------------------------
  // Gated states (the four standard tests every page suite adds -- Task 8
  // Step 1)
  // -------------------------------------------------------------------------
  describe("gated states", () => {
    it("renders the page title while signed out", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.getByRole("heading", { level: 1, name: "Notes" })
      ).toBeInTheDocument();
    });

    it("asks a signed-out visitor to sign in, and never to select a group", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.getByRole("heading", { name: /sign in to read your notes/i })
      ).toBeInTheDocument();
      expect(screen.queryByText(/select a group/i)).not.toBeInTheDocument();
    });

    it("shows a signed-out visitor the example note under the sign-in", () => {
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

    it("hides the create action while signed out", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.queryByRole("button", { name: /new note/i })
      ).not.toBeInTheDocument();
    });

    it("shows a skeleton and no message while context is still resolving", () => {
      mockIsResolving = true;
      renderPage();
      expect(screen.getByTestId("gated-skeleton")).toBeInTheDocument();
      expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
    });

    // Rewritten: this used to claim a member with a group but no campaign
    // chosen reaches the notes list, on the premise that notes are
    // group-scoped and "demanding a campaign here would gate a page that can
    // render perfectly well without one". That premise was false --
    // `NoteContext` returns no notes at all without an active campaign (see
    // the comment on `GATED_COPY.notes` in gated-page-copy.ts) -- so this
    // member has nothing to read and now correctly lands on the campaign
    // picker instead of an empty list.
    it("sends a member with a group but no campaign chosen to the campaign picker, not the empty list", async () => {
      mockActiveCampaignId = null;
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByTestId("gated-eyebrow")
        ).toHaveTextContent(/signed in.*no campaign chosen/i);
      });
      expect(screen.queryByTestId("notes-list")).not.toBeInTheDocument();
    });

    it("no longer warns about a missing campaign in the header", async () => {
      mockActiveCampaignId = null;
      renderPage();
      // Missing a campaign now opens the shared campaign-picker panel (which
      // fetches across groups), rather than staying on this page's own
      // content -- wait for that fetch to settle so the assertion below runs
      // against the actual final render, not a transitional one.
      await waitFor(() => {
        expect(screen.getByTestId("gated-eyebrow")).toBeInTheDocument();
      });
      expect(screen.queryByText(/no campaign selected/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Ready-state rendering
  // -------------------------------------------------------------------------
  describe("ready state", () => {
    test("should render the page heading", () => {
      renderPage();
      expect(screen.getByRole("heading", { level: 1, name: "Notes" })).toBeInTheDocument();
    });

    test("should name the campaign in the subtitle and say the notes are private", () => {
      renderPage();
      expect(
        screen.getByText("Your private notes for Phandelver. Only you can read them.")
      ).toBeInTheDocument();
    });

    test("should create a note from the header button", () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /new note/i }));
      expect(mockCreateAndOpen).toHaveBeenCalled();
    });

    // The subtitle falls back to the campaign-less sentence when a member has
    // a group but no campaign chosen -- the same state exercised above.
    // Missing a campaign now also opens the campaign-picker panel (which
    // fetches across groups), so the pending fetch is flushed before the
    // assertions run.
    test("should use the generic subtitle when no campaign is active", async () => {
      mockActiveCampaignId = null;
      renderPage();
      await act(async () => {});
      expect(
        screen.getByText("Your private notes. Only you can read them.")
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Your private notes for/)
      ).not.toBeInTheDocument();
    });

    test("should hide the create button without an active campaign", async () => {
      mockActiveCampaignId = null;
      renderPage();
      await act(async () => {});
      expect(screen.queryByRole("button", { name: /new note/i })).not.toBeInTheDocument();
    });

    test("should render the notes list", () => {
      renderPage();
      expect(screen.getByTestId("notes-list")).toBeInTheDocument();
    });
  });
});
