// src/__tests__/App.test.tsx
// Behavioral tests for App.tsx — verifies provider composition and route table.
// All real providers and page components are stubbed so this test focuses solely
// on the wiring in App.tsx itself.

import React from "react";
import { render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock react-router-dom
// We capture every <Route path="…"> declaration so we can assert the route table.
// ---------------------------------------------------------------------------
const capturedRoutes: string[] = [];

jest.mock("react-router-dom", () => {
  const Routes = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="routes">{children}</div>
  );
  // `path` is optional: an index route (`<Route index>`) declares no path of
  // its own, so it contributes nothing to the route table and must not be
  // counted as one.
  // `children` is rendered alongside `element` so nested routes -- a layout
  // route with child views, as `/admin` is -- reach this capture at all. Under
  // the real router only the matching branch renders; here the whole table is
  // declared at once, which is the point.
  const Route = ({
    path,
    element,
    children,
  }: {
    path?: string;
    element: React.ReactNode;
    children?: React.ReactNode;
  }) => {
    // An index route (`<Route index>`) declares no path of its own, so it
    // contributes nothing to the route table and must not be counted as one.
    if (path === undefined) return <div data-testid="route-index">{element}</div>;
    // Capture path at definition time (module-scope array, reset per test)
    capturedRoutes.push(path);
    return (
      <div data-testid={`route-${path.replace(/\//g, "_").replace(/^_/, "").replace(/:/g, "")}`}>
        {element}
        {children}
      </div>
    );
  };
  // App.tsx renders <Navigate> as the /story/selection redirect's element;
  // stub it so that element is a valid renderable component under the mock.
  const Navigate = ({ to }: { to: string }) => (
    <div data-testid="navigate" data-to={to} />
  );
  // The four retired edit routes render `EditRouteRedirect`, which reads the
  // record's id with `useParams`. It is declared here rather than left out
  // because this suite renders the whole table at once, so every element in it
  // is mounted -- including the four that only ever run on a stale URL.
  const useParams = () => ({
    questId: "a-quest",
    npcId: "an-npc",
    locationId: "a-location",
    rumorId: "a-rumor",
    chapterId: "a-chapter",
  });
  return { Routes, Route, Navigate, useParams };
});

// ---------------------------------------------------------------------------
// Mock all context providers
// Each stub renders children and exposes a data-testid so we can assert
// the provider is present in the tree.
// ---------------------------------------------------------------------------
jest.mock("shared/context/NavigationContext", () => ({
  NavigationProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="navigation-provider">{children}</div>
  ),
  useNavigation: () => ({}),
}));

jest.mock("shared/context/SearchContext", () => ({
  SearchProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="search-provider">{children}</div>
  ),
  useSearch: () => ({}),
}));

jest.mock("features/campaign-entities", () => ({
  PrivateRecordsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  NPCProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="npc-provider">{children}</div>
  ),
  useNPCs: () => ({}),
  QuestProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="quest-provider">{children}</div>
  ),
  useQuests: () => ({}),
  LocationProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="location-provider">{children}</div>
  ),
  useLocations: () => ({}),
  RumorProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rumor-provider">{children}</div>
  ),
  useRumors: () => ({}),
}));

jest.mock("features/storytelling", () => ({
  StoryProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="story-provider">{children}</div>
  ),
  useStory: () => ({}),
}));


jest.mock("@/features/user-management/auth/context/FirebaseContext", () => ({
  FirebaseProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="firebase-provider">{children}</div>
  ),
  useFirebase: () => ({}),
  AUTH_STATE_CHANGED_EVENT: "auth-state-changed",
}));

jest.mock("features/collaboration", () => ({
  NoteProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="note-provider">{children}</div>
  ),
  useNotes: () => ({}),
  UsageProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="usage-provider">{children}</div>
  ),
  useUsage: () => ({}),
}));

// ---------------------------------------------------------------------------
// Mock non-provider components used inside App
// ---------------------------------------------------------------------------
jest.mock("shared/components/ErrorBoundary", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="error-boundary">{children}</div>
  ),
}));

jest.mock("app/layout/Layout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

// Tested on its own (app/__tests__/DocumentTitle.test.tsx).
jest.mock("app/DocumentTitle", () => ({
  __esModule: true,
  default: () => <div data-testid="document-title" />,
}));

// Tested on its own (app/__tests__/AnalyticsPageView.test.tsx).
jest.mock("app/AnalyticsPageView", () => ({
  __esModule: true,
  default: () => <div data-testid="analytics-page-view" />,
}));

jest.mock("@/features/user-management/auth/components/SessionTimeoutWarning", () => ({
  __esModule: true,
  default: () => <div data-testid="session-timeout-warning" />,
}));

jest.mock("@/features/user-management/auth/components/SessionManager", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="session-manager">{children}</div>
  ),
}));

jest.mock("@/features/user-management/auth/components/PrivacyNotice", () => ({
  __esModule: true,
  default: () => <div data-testid="privacy-notice" />,
}));

// ---------------------------------------------------------------------------
// Mock all page components (barrel exports + direct imports)
// ---------------------------------------------------------------------------
jest.mock("../pages/HomePage", () => ({
  __esModule: true,
  default: () => <div data-testid="page-home" />,
}));

jest.mock("../pages/story", () => ({
  StoryPage: () => <div data-testid="page-story" />,
  SagaPage: () => <div data-testid="page-saga" />,
  SagaEditPage: () => <div data-testid="page-saga-edit" />,
  ChaptersPage: () => <div data-testid="page-chapters" />,
  ChapterCreatePage: () => <div data-testid="page-chapter-create" />,
  ChapterEditPage: () => <div data-testid="page-chapter-edit" />,
}));

jest.mock("../pages/quests", () => ({
  QuestsPage: () => <div data-testid="page-quests" />,
  QuestCreatePage: () => <div data-testid="page-quest-create" />,
  QuestDetailPage: () => <div data-testid="page-quest-detail" />,
}));

jest.mock("../pages/npcs", () => ({
  NPCsPage: () => <div data-testid="page-npcs" />,
  NPCsCreatePage: () => <div data-testid="page-npcs-create" />,
  NPCDetailPage: () => <div data-testid="page-npc-detail" />,
}));

jest.mock("../pages/locations", () => ({
  LocationsPage: () => <div data-testid="page-locations" />,
  LocationCreatePage: () => <div data-testid="page-location-create" />,
  LocationDetailPage: () => <div data-testid="page-location-detail" />,
}));

jest.mock("../pages/rumors", () => ({
  RumorsPage: () => <div data-testid="page-rumors" />,
  RumorCreatePage: () => <div data-testid="page-rumor-create" />,
}));

jest.mock("../pages/notes", () => ({
  NotesPage: () => <div data-testid="page-notes" />,
  NotePage: () => <div data-testid="page-note" />,
}));

jest.mock("../pages/PrivacyPolicyPage", () => ({
  __esModule: true,
  default: () => <div data-testid="page-privacy-policy" />,
}));

jest.mock("../pages/ContactPage", () => ({
  __esModule: true,
  default: () => <div data-testid="page-contact" />,
}));

jest.mock("../pages/AboutPage", () => ({
  __esModule: true,
  default: () => <div data-testid="page-about" />,
}));

jest.mock("../pages/NotFoundPage", () => ({
  __esModule: true,
  default: () => <div data-testid="page-not-found" />,
}));

jest.mock("../pages/profile", () => ({
  __esModule: true,
  ProfilePage: () => <div data-testid="page-profile" />,
}));

// The admin and auth routes. Mocked at source rather than through the
// `features/user-management` barrel, the same way the providers above are, so
// the barrel keeps re-exporting the stubs.
jest.mock("@/features/user-management/admin/pages/AdminLayout", () => ({
  __esModule: true,
  default: () => <div data-testid="page-admin-layout" />,
}));

jest.mock("@/features/user-management/admin/pages/AdminPeoplePage", () => ({
  __esModule: true,
  default: () => <div data-testid="page-admin-people" />,
}));

jest.mock("@/features/user-management/admin/pages/AdminCampaignsPage", () => ({
  __esModule: true,
  default: () => <div data-testid="page-admin-campaigns" />,
}));

jest.mock("@/features/user-management/admin/pages/AdminGroupPage", () => ({
  __esModule: true,
  default: () => <div data-testid="page-admin-group" />,
}));

jest.mock("@/features/user-management/auth/pages/SignInPage", () => ({
  __esModule: true,
  default: () => <div data-testid="page-signin" />,
}));

jest.mock("@/features/user-management/auth/pages/EmailLinkPage", () => ({
  __esModule: true,
  default: () => <div data-testid="page-email-link" />,
}));

jest.mock("@/features/user-management/groups/pages/JoinPage", () => ({
  __esModule: true,
  default: () => <div data-testid="page-join" />,
}));

// Marks which routes give each record its own page instance (REACT-001).
jest.mock("app/RecordRoute", () => ({
  __esModule: true,
  default: ({ param, children }: { param: string; children: React.ReactNode }) => (
    <div data-testid={`record-route-${param}`}>{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Import App after all mocks are registered
// ---------------------------------------------------------------------------
import App from "app/App";

// ---------------------------------------------------------------------------
// Expected route paths declared in App.tsx
// ---------------------------------------------------------------------------
const EXPECTED_ROUTES = [
  "/",
  "/story",
  "/story/selection",
  "/story/chapters",
  "/story/chapters/:chapterId",
  "/story/saga",
  "/story/saga/edit",
  "/story/chapters/create",
  "/story/chapters/edit/:chapterId",
  "/quests",
  "/quests/create",
  // Retired in `15-8`, and still routed: each one redirects to the record.
  "/quests/edit/:questId",
  // `15-5`. Declared after the two literal segments, for the same reason
  // `/locations/:locationId` is below.
  "/quests/:questId",
  "/npcs",
  "/npcs/create",
  "/npcs/edit/:npcId",
  "/npcs/:npcId",
  "/locations",
  "/locations/create",
  "/locations/edit/:locationId",
  // `15-4`. Declared after the two literal segments, so `/locations/create`
  // still reaches its own page rather than being read as a location id.
  "/locations/:locationId",
  "/rumors",
  // Both retired, both still routed. `15-8` sent the edit URL to the row;
  // `15-9` did the same to the create URL, which had been a form for an
  // entity that has no page. The addresses survive so anything still
  // pointing at them lands somewhere true.
  "/rumors/create",
  "/rumors/edit/:rumorId",
  "/notes",
  "/notes/:noteId",
  "/privacy",
  "/contact",
  "/about",
  "/profile",
  // Admin and auth are routes, not dialogs (design doc §1). `/admin` is the
  // layout route; its index redirects to `/admin/people` and declares no path.
  "/admin",
  "/admin/people",
  "/admin/campaigns",
  "/admin/group",
  "/signin",
  "/auth/link",
  "/join",
  // Any address nothing above claims. Firebase Hosting rewrites every path to
  // index.html, so the router is the only thing that ever sees an unknown one.
  "*",
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("App", () => {
  beforeEach(() => {
    // Reset captured routes before each test so individual test assertions
    // see only the routes from their own render.
    capturedRoutes.length = 0;
  });

  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------
  describe("renders without crashing", () => {
    test("mounts without throwing", () => {
      const { container } = render(<App />);
      expect(container).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Provider composition — each provider must be present in the tree
  // -------------------------------------------------------------------------
  describe("provider composition", () => {
    test("renders ErrorBoundary as the outermost wrapper", () => {
      render(<App />);
      expect(screen.getByTestId("error-boundary")).toBeInTheDocument();
    });

    test("renders FirebaseProvider inside ErrorBoundary", () => {
      render(<App />);
      const errorBoundary = screen.getByTestId("error-boundary");
      const firebaseProvider = screen.getByTestId("firebase-provider");
      expect(errorBoundary).toContainElement(firebaseProvider);
    });

    test("renders SessionManager inside FirebaseProvider", () => {
      render(<App />);
      const firebaseProvider = screen.getByTestId("firebase-provider");
      const sessionManager = screen.getByTestId("session-manager");
      expect(firebaseProvider).toContainElement(sessionManager);
    });

    test("renders NavigationProvider inside SessionManager", () => {
      render(<App />);
      const sessionManager = screen.getByTestId("session-manager");
      const navigationProvider = screen.getByTestId("navigation-provider");
      expect(sessionManager).toContainElement(navigationProvider);
    });

    test("renders NPCProvider", () => {
      render(<App />);
      expect(screen.getByTestId("npc-provider")).toBeInTheDocument();
    });

    test("renders LocationProvider", () => {
      render(<App />);
      expect(screen.getByTestId("location-provider")).toBeInTheDocument();
    });

    test("renders StoryProvider", () => {
      render(<App />);
      expect(screen.getByTestId("story-provider")).toBeInTheDocument();
    });

    test("renders RumorProvider", () => {
      render(<App />);
      expect(screen.getByTestId("rumor-provider")).toBeInTheDocument();
    });

    test("renders QuestProvider", () => {
      render(<App />);
      expect(screen.getByTestId("quest-provider")).toBeInTheDocument();
    });

    test("renders NoteProvider", () => {
      render(<App />);
      expect(screen.getByTestId("note-provider")).toBeInTheDocument();
    });

    test("renders UsageProvider", () => {
      render(<App />);
      expect(screen.getByTestId("usage-provider")).toBeInTheDocument();
    });

    test("renders SearchProvider", () => {
      render(<App />);
      expect(screen.getByTestId("search-provider")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Provider nesting order
  // The outer providers must contain the inner ones (partial order checks).
  // -------------------------------------------------------------------------
  describe("provider nesting order", () => {
    test("NPCProvider is inside NavigationProvider", () => {
      render(<App />);
      expect(screen.getByTestId("navigation-provider")).toContainElement(
        screen.getByTestId("npc-provider")
      );
    });

    test("LocationProvider is inside NPCProvider", () => {
      render(<App />);
      expect(screen.getByTestId("npc-provider")).toContainElement(
        screen.getByTestId("location-provider")
      );
    });

    test("StoryProvider is inside LocationProvider", () => {
      render(<App />);
      expect(screen.getByTestId("location-provider")).toContainElement(
        screen.getByTestId("story-provider")
      );
    });

    test("RumorProvider is inside StoryProvider", () => {
      render(<App />);
      expect(screen.getByTestId("story-provider")).toContainElement(
        screen.getByTestId("rumor-provider")
      );
    });

    test("QuestProvider is inside RumorProvider", () => {
      render(<App />);
      expect(screen.getByTestId("rumor-provider")).toContainElement(
        screen.getByTestId("quest-provider")
      );
    });

    test("NoteProvider is inside QuestProvider", () => {
      render(<App />);
      expect(screen.getByTestId("quest-provider")).toContainElement(
        screen.getByTestId("note-provider")
      );
    });

    test("UsageProvider is inside NoteProvider", () => {
      render(<App />);
      expect(screen.getByTestId("note-provider")).toContainElement(
        screen.getByTestId("usage-provider")
      );
    });

    test("SearchProvider is inside UsageProvider", () => {
      render(<App />);
      expect(screen.getByTestId("usage-provider")).toContainElement(
        screen.getByTestId("search-provider")
      );
    });
  });

  // -------------------------------------------------------------------------
  // Layout and static UI
  // -------------------------------------------------------------------------
  describe("layout and static UI", () => {
    test("renders the Layout component", () => {
      render(<App />);
      expect(screen.getByTestId("layout")).toBeInTheDocument();
    });

    test("renders SessionTimeoutWarning inside Layout", () => {
      render(<App />);
      expect(screen.getByTestId("session-timeout-warning")).toBeInTheDocument();
      expect(screen.getByTestId("layout")).toContainElement(
        screen.getByTestId("session-timeout-warning")
      );
    });

    test("renders PrivacyNotice inside Layout", () => {
      render(<App />);
      expect(screen.getByTestId("privacy-notice")).toBeInTheDocument();
      expect(screen.getByTestId("layout")).toContainElement(
        screen.getByTestId("privacy-notice")
      );
    });
  });

  // -------------------------------------------------------------------------
  // Route table — every expected path must be declared
  // -------------------------------------------------------------------------
  describe("route table", () => {
    test("renders a <Routes> container", () => {
      render(<App />);
      expect(screen.getByTestId("routes")).toBeInTheDocument();
    });

    test.each(EXPECTED_ROUTES)(
      "declares a route for path '%s'",
      (expectedPath) => {
        capturedRoutes.length = 0;
        render(<App />);
        expect(capturedRoutes).toContain(expectedPath);
      }
    );

    test("sends an unmatched address to the not-found page", () => {
      render(<App />);
      expect(
        within(screen.getByTestId("route-*")).getByTestId("page-not-found")
      ).toBeInTheDocument();
    });

    test(`declares exactly ${EXPECTED_ROUTES.length} routes`, () => {
      render(<App />);
      expect(capturedRoutes).toHaveLength(EXPECTED_ROUTES.length);
    });

    // REACT-001: the router reuses a route's element when only the id
    // changes, so an editor opened on one record saved its draft onto the
    // next. Each of these pages edits the record named by its id.
    test.each([
      ["npcs_npcId", "npcId", "page-npc-detail"],
      ["quests_questId", "questId", "page-quest-detail"],
      ["locations_locationId", "locationId", "page-location-detail"],
      ["notes_noteId", "noteId", "page-note"],
    ])("gives each record behind route '%s' its own page", async (route, param, page) => {
      render(<App />);
      const keyed = within(screen.getByTestId(`route-${route}`)).getByTestId(
        `record-route-${param}`
      );
      expect(await within(keyed).findByTestId(page)).toBeInTheDocument();
    });
  });
});
