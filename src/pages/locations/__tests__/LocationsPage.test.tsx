// src/pages/locations/__tests__/LocationsPage.test.tsx
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EXAMPLE_CAMPAIGN } from "shared/example-campaign/example-campaign";
import LocationsPage from "../LocationsPage";

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

// `hasRequiredContext` is deliberately absent from this mock: LocationsPage
// no longer reads it (usePageGate supersedes it).
interface LocationContextMock {
  locations: any[];
  isLoading: boolean;
  error: string | null;
  loadError?: string | null;
}

let mockLocationContext: LocationContextMock = {
  locations: [],
  isLoading: false,
  error: null,
};

jest.mock("features/campaign-entities", () => ({
  // The real example: what it draws is what the signed-out tests are about.
  LocationExample: jest.requireActual("features/campaign-entities/locations/components/LocationExample").default,
  useLocations: () => mockLocationContext,
  LocationDirectory: (props: any) => (
    <div data-testid="location-directory">
      <span data-testid="location-directory-count">
        {props.locations?.length}
      </span>
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
// Sample location data
// ---------------------------------------------------------------------------
const sampleLocations = [
  { id: "loc-1", name: "Rivendell", status: "explored" },
  { id: "loc-2", name: "Moria", status: "visited" },
  { id: "loc-3", name: "Mordor", status: "known" },
  { id: "loc-4", name: "Lothlórien", status: "explored" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderPage() {
  return render(
    <MemoryRouter>
      <LocationsPage />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("LocationsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { uid: "user-1" };
    mockIsResolving = false;
    mockActiveGroupId = "group-1";
    mockActiveCampaignId = "campaign-1";
    mockGroups = [{ id: "group-1", name: "The Fellowship" }];
    mockLocationContext = {
      locations: [...sampleLocations],
      isLoading: false,
      error: null,
    };
  });

  // -------------------------------------------------------------------------
  // Gated states
  // -------------------------------------------------------------------------
  describe("gated states", () => {
    it("shows a signed-out visitor the example campaign's locations under the panel, as rows that do nothing", () => {
      mockUser = null;
      renderPage();
      const example = screen.getByRole("region", { name: "Example campaign" });
      EXAMPLE_CAMPAIGN.locations.forEach((row) =>
        expect(within(example).getByText(row.name)).toBeInTheDocument()
      );
      expect(within(example).queryAllByRole("button", { hidden: true })).toHaveLength(0);
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
        screen.getByRole("heading", { level: 1, name: "Locations" })
      ).toBeInTheDocument();
    });

    it("asks a signed-out visitor to sign in, and never to select a group", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.getByRole("heading", {
          name: /sign in to see where your party has been/i,
        })
      ).toBeInTheDocument();
      expect(screen.queryByText(/select a group/i)).not.toBeInTheDocument();
    });

    it("hides the create action while signed out", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.queryByRole("button", { name: /add location/i })
      ).not.toBeInTheDocument();
    });

    it("shows a skeleton and no message while context is still resolving", () => {
      mockIsResolving = true;
      renderPage();
      expect(screen.getByTestId("gated-skeleton")).toBeInTheDocument();
      expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
    });

    // Rewritten: the pre-gate suite asserted this page's own
    // "No Active Group or Campaign" copy, driven by `hasRequiredContext`
    // (dropped from this page — see the note above the mock). usePageGate
    // now derives the state and GatedContent renders the shared
    // pick-campaign panel.
    it("shows the shared pick-campaign panel, not the old copy, when context is missing", () => {
      mockActiveCampaignId = null;
      renderPage();
      expect(
        screen.queryByText("No Active Group or Campaign")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/please select a group and campaign/i)
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Select Group & Campaign")
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("gated-eyebrow")).toHaveTextContent(
        /no campaign chosen/i
      );
      expect(
        screen.queryByTestId("location-directory")
      ).not.toBeInTheDocument();
    });

    // Rewritten: the old inline error copy is gone; GatedContent's error
    // panel names the noun and the real error message instead.
    it("shows the shared error panel, not the old inline copy, on a fetch error", () => {
      mockLocationContext = { ...mockLocationContext, error: "Firebase error", loadError: "Firebase error" };
      renderPage();
      expect(
        screen.queryByText("Error Loading Locations. Sign in to view content.")
      ).not.toBeInTheDocument();
      expect(screen.getByText(/couldn't load locations/i)).toBeInTheDocument();
      expect(screen.getByText("Firebase error")).toBeInTheDocument();
      expect(
        screen.queryByTestId("location-directory")
      ).not.toBeInTheDocument();
    });

    // T085 (REACT-002): a rejected write is reported through `error`, but the
    // records loaded fine, so the page stays up.
    it("keeps the places on the page when only a write failed", () => {
      mockLocationContext = { ...mockLocationContext, error: "Write refused", loadError: null };
      renderPage();
      expect(screen.getByTestId("location-directory")).toBeInTheDocument();
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

    it("renders the page heading 'Locations'", () => {
      renderPage();
      expect(
        screen.getByRole("heading", { level: 1, name: "Locations" })
      ).toBeInTheDocument();
    });

    it("renders the location directory", () => {
      renderPage();
      expect(screen.getByTestId("location-directory")).toBeInTheDocument();
    });

    it("passes all locations to the directory", () => {
      renderPage();
      expect(
        screen.getByTestId("location-directory-count")
      ).toHaveTextContent("4");
    });
  });

  // -------------------------------------------------------------------------
  // Create button
  // -------------------------------------------------------------------------
  describe("Add Location button", () => {
    it("renders 'Add Location' button for a ready user", () => {
      renderPage();
      expect(screen.getByText("Add Location")).toBeInTheDocument();
    });

    it("navigates to /locations/create on click", () => {
      renderPage();
      fireEvent.click(screen.getByText("Add Location"));
      expect(mockNavigateToPage).toHaveBeenCalledWith("/locations/create");
    });

    // Restores coverage dropped from the pre-gate suite's "does NOT render
    // 'Add Location' button when context is not ready". It matters on its
    // own: the button lives in PageShell's `actions` prop, outside
    // GatedContent's children-gating, so `gate.canAct` is the only thing
    // hiding it here -- no structural guarantee backs it up the way the
    // directory's absence is backed by GatedContent only rendering `ready`.
    it("does NOT render 'Add Location' button when no campaign is selected", () => {
      mockActiveCampaignId = null;
      renderPage();
      expect(screen.queryByText("Add Location")).not.toBeInTheDocument();
    });
  });
});
