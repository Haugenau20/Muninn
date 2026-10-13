// src/pages/story/__tests__/ChaptersPage.test.tsx
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ChaptersPage from "../ChaptersPage";
import { EXAMPLE_CAMPAIGN } from "shared/example-campaign/example-campaign";

// ---------------------------------------------------------------------------
// Page-suite gate mock (shared across Tasks 8-13 -- see page-suite-mock.md)
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
// Story-specific mocks
// ---------------------------------------------------------------------------
const mockNavigateToPage = jest.fn();

jest.mock("shared/context/NavigationContext", () => ({
  useNavigation: () => ({ navigateToPage: mockNavigateToPage }),
}));

interface StoryContextMock {
  chapters: any[];
  storyProgress: { currentChapter: string; chapterProgress: Record<string, any> };
  isLoading: boolean;
  deleteChapters?: jest.Mock;
}

const NO_PROGRESS = { currentChapter: "", chapterProgress: {} };

let mockStoryContext: StoryContextMock = {
  chapters: [],
  storyProgress: NO_PROGRESS,
  isLoading: false,
};

// `features/storytelling`'s barrel is mocked here -- but the chapter-progress
// helpers it re-exports are deliberately left real, since ChaptersPage's
// filtering/derivation behaviour is exactly what these tests exercise, and
// that module already has its own test suite backing its contract.
jest.mock("features/storytelling", () => ({
  ...jest.requireActual("features/storytelling/chapters/utils/chapter-progress"),
  useStory: () => mockStoryContext,
  // The real example: what it draws is what these tests are about.
  ChapterExample: jest.requireActual("features/storytelling/stories/components/ChapterExample").default,
  BookshelfView: (props: any) => (
    <div
      data-testid="bookshelf-view"
      data-count={props.items?.length}
      data-is-admin={String(props.isAdmin)}
    >
      {props.items?.map((item: any) => (
        <div key={item.chapter.id}>
          <span data-testid={`shelf-title-${item.chapter.id}`}>{item.chapter.title}</span>
          <button
            data-testid={`shelf-select-${item.chapter.id}`}
            onClick={() => props.onChapterSelect(item.chapter.id)}
          >
            select
          </button>
          <button
            data-testid={`shelf-edit-${item.chapter.id}`}
            onClick={() => props.onEditChapter(item.chapter.id)}
          >
            edit
          </button>
        </div>
      ))}
    </div>
  ),
  ChapterList: (props: any) => (
    <div
      data-testid="chapter-list"
      data-count={props.items?.length}
      data-is-admin={String(props.isAdmin)}
    >
      {props.items?.map((item: any) => (
        <div key={item.chapter.id}>
          {props.selection && (
            <input
              type="checkbox"
              aria-label={`Select ${item.chapter.title}`}
              checked={props.selection.selected.has(item.chapter.id)}
              onChange={(e) => props.selection.onToggle(item.chapter.id, e.target.checked)}
            />
          )}
          <span data-testid={`list-title-${item.chapter.id}`}>{item.chapter.title}</span>
          <button
            data-testid={`list-select-${item.chapter.id}`}
            onClick={() => props.onChapterSelect(item.chapter.id)}
          >
            select
          </button>
          <button
            data-testid={`list-edit-${item.chapter.id}`}
            onClick={() => props.onEditChapter(item.chapter.id)}
          >
            edit
          </button>
        </div>
      ))}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Child component mocks
// ---------------------------------------------------------------------------
jest.mock("shared/components/Breadcrumb", () => ({
  __esModule: true,
  default: (props: any) => (
    <nav data-testid="breadcrumb">
      {props.items.map((item: any, i: number) => (
        <span key={i} data-testid={`breadcrumb-item-${i}`}>
          {item.label}
        </span>
      ))}
    </nav>
  ),
}));

jest.mock("../components/StoryViewTabs", () => ({
  __esModule: true,
  default: () => <div data-testid="story-view-tabs" />,
}));

// Suppress localStorage warnings in tests
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const CHAPTERS = [
  { id: "chapter-01", title: "The Beginning", order: 1, content: "", summary: "Where it all started" },
  { id: "chapter-02", title: "A Hard Day", order: 2, content: "", summary: "Trouble brews in the north" },
  { id: "chapter-03", title: "Aftermath", order: 3, content: "", summary: "Picking up the pieces" },
];

// chapter-01 read, chapter-02 current/reading at 62%, chapter-03 unread.
const PROGRESS_STARTED = {
  currentChapter: "chapter-02",
  chapterProgress: {
    "chapter-01": { chapterId: "chapter-01", lastPosition: 100, isComplete: true, lastRead: new Date() },
    "chapter-02": { chapterId: "chapter-02", lastPosition: 62, isComplete: false, lastRead: new Date() },
  },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ChaptersPage />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ChaptersPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.clear();
    mockUser = { uid: "user-1" };
    mockIsResolving = false;
    mockActiveGroupId = "group-1";
    mockActiveCampaignId = "campaign-1";
    mockGroups = [{ id: "group-1", name: "The Fellowship" }];
    mockStoryContext = {
      chapters: CHAPTERS,
      storyProgress: NO_PROGRESS,
      isLoading: false,
    };
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
        screen.getByRole("heading", { level: 1, name: "Session Chronicles" })
      ).toBeInTheDocument();
    });

    it("asks a signed-out visitor to sign in, and never to select a group", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.getByRole("heading", { name: /sign in to read your campaign's story/i })
      ).toBeInTheDocument();
      expect(screen.queryByText(/select a group/i)).not.toBeInTheDocument();
    });

    it("hides the create action while signed out", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.queryByRole("button", { name: /new chapter/i })
      ).not.toBeInTheDocument();
    });

    // Rewritten: this used to assert StoryViewTabs was hidden along with the
    // create action while signed out. That was wrong -- StoryViewTabs is pure
    // navigation between story views, not a control that acts on data, and
    // the gated-states spec says navigation stays visible in every state
    // because it is how someone arrives at these pages in the first place.
    it("keeps StoryViewTabs visible while signed out, unlike the create action", () => {
      mockUser = null;
      renderPage();
      expect(screen.getByTestId("story-view-tabs")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /new chapter/i })
      ).not.toBeInTheDocument();
    });

    it("shows a skeleton and no message while context is still resolving", () => {
      mockIsResolving = true;
      renderPage();
      expect(screen.getByTestId("gated-skeleton")).toBeInTheDocument();
      expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  describe("rendering", () => {
    it("renders breadcrumb with Home, Story, Chapters", () => {
      renderPage();
      expect(screen.getByTestId("breadcrumb-item-0")).toHaveTextContent("Home");
      expect(screen.getByTestId("breadcrumb-item-1")).toHaveTextContent("Story");
      expect(screen.getByTestId("breadcrumb-item-2")).toHaveTextContent("Chapters");
    });

    it("renders page heading 'Session Chronicles' as the h1", () => {
      renderPage();
      expect(
        screen.getByRole("heading", { level: 1, name: "Session Chronicles" })
      ).toBeInTheDocument();
    });

    it("renders StoryViewTabs in the header", () => {
      renderPage();
      expect(screen.getByTestId("story-view-tabs")).toBeInTheDocument();
    });

    it("renders the designed empty state when no chapters exist at all", () => {
      // A1's rules apply to this page more than A4's: it is a collection of
      // things to open. `RosterEmpty` is the pattern the eight directories
      // already use -- a title saying what the collection is for, a message,
      // and the one action that fills it. This page used to answer with a bare
      // sentence in a card, which is the "empty region reads as unfinished"
      // failure the design language names.
      mockStoryContext = { ...mockStoryContext, chapters: [] };
      renderPage();

      expect(
        screen.getByRole("heading", { name: "Muninn hasn't heard the story yet" })
      ).toBeInTheDocument();
      // The title is Muninn's line, so it carries the rune, as the
      // directories' whole-collection empty states do.
      expect(screen.getByText("ᛗ")).toHaveAttribute("aria-hidden", "true");
      // Deliberately not /new chapter/i: the page header renders a "New
      // Chapter" button whenever the visitor can act, so that matcher would
      // pass without the empty state offering anything at all.
      expect(
        screen.getByRole("button", { name: /write the first chapter/i })
      ).toBeInTheDocument();
    });

    it("an empty campaign shows its own empty state and no example: the example is for signed-out visitors", () => {
      mockStoryContext = { ...mockStoryContext, chapters: [] };
      renderPage();
      expect(screen.queryByTestId("roster-example")).not.toBeInTheDocument();
    });

    it("shows a signed-out visitor the example campaign's chronicle under the panel, as rows that do nothing", () => {
      mockUser = null;
      renderPage();
      const example = screen.getByTestId("roster-example");
      EXAMPLE_CAMPAIGN.chapters.forEach((chapter) => {
        expect(within(example).getByText(chapter.title)).toBeInTheDocument();
        expect(within(example).getByText(chapter.summary)).toBeInTheDocument();
      });
      // The real row: read state, and the promoted current chapter's progress.
      expect(within(example).getByText("Read")).toBeInTheDocument();
      expect(within(example).getByText("40% through")).toBeInTheDocument();
      expect(within(example).queryAllByRole("button", { hidden: true })).toHaveLength(0);
      // Under the panel, whose sign-in stays the first thing to press.
      const signIn = screen.getByRole("link", { name: "Sign in" });
      expect(signIn.compareDocumentPosition(example) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("does not render the search/filter row when there are no chapters", () => {
      mockStoryContext = { ...mockStoryContext, chapters: [] };
      renderPage();
      expect(screen.queryByPlaceholderText(/Search chapter titles/i)).not.toBeInTheDocument();
    });

    it("renders the shelf view by default", () => {
      renderPage();
      expect(screen.getByTestId("bookshelf-view")).toBeInTheDocument();
      expect(screen.queryByTestId("chapter-list")).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // ResumeBar wiring
  // -------------------------------------------------------------------------
  describe("resume bar wiring", () => {
    it("shows 'Start reading' when nothing has been read", () => {
      renderPage();
      expect(
        screen.getByRole("heading", { name: "Start reading" })
      ).toBeInTheDocument();
    });

    it("shows the current chapter when progress exists", () => {
      mockStoryContext = { ...mockStoryContext, storyProgress: PROGRESS_STARTED };
      renderPage();
      expect(screen.getByText(/Chapter 2: A Hard Day/)).toBeInTheDocument();
    });

    it("navigates to the resume chapter when Resume is clicked", () => {
      mockStoryContext = { ...mockStoryContext, storyProgress: PROGRESS_STARTED };
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
      expect(mockNavigateToPage).toHaveBeenCalledWith("/story/chapters/chapter-02");
    });
  });

  // -------------------------------------------------------------------------
  // User controls
  // -------------------------------------------------------------------------
  describe("user controls", () => {
    it("renders 'New Chapter' button when signed in with a campaign", () => {
      renderPage();
      expect(screen.getByRole("button", { name: /new chapter/i })).toBeInTheDocument();
    });

    it("does NOT render 'New Chapter' button when the page is not ready", () => {
      mockUser = null;
      renderPage();
      expect(
        screen.queryByRole("button", { name: /write the first chapter/i })
      ).not.toBeInTheDocument();
    });

    it("navigates to /story/chapters/create on 'New Chapter' click", () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /new chapter/i }));
      expect(mockNavigateToPage).toHaveBeenCalledWith("/story/chapters/create");
    });
  });

  // -------------------------------------------------------------------------
  // View toggle
  // -------------------------------------------------------------------------
  describe("view toggle", () => {
    it("switches to list view when List is clicked", () => {
      renderPage();
      fireEvent.click(screen.getByText("List"));
      expect(screen.getByTestId("chapter-list")).toBeInTheDocument();
      expect(screen.queryByTestId("bookshelf-view")).not.toBeInTheDocument();
    });

    it("switches back to shelf view when Shelf is clicked", () => {
      renderPage();
      fireEvent.click(screen.getByText("List"));
      fireEvent.click(screen.getByText("Shelf"));
      expect(screen.getByTestId("bookshelf-view")).toBeInTheDocument();
      expect(screen.queryByTestId("chapter-list")).not.toBeInTheDocument();
    });

    it("saves view preference to localStorage when switching views", () => {
      renderPage();
      fireEvent.click(screen.getByText("List"));
      expect(localStorage.getItem("chapters-view-preference")).toBe("list");
    });

    it("restores list view preference from localStorage", () => {
      localStorage.setItem("chapters-view-preference", "list");
      renderPage();
      expect(screen.getByTestId("chapter-list")).toBeInTheDocument();
    });

    it("treats a legacy 'table' preference as 'list'", () => {
      localStorage.setItem("chapters-view-preference", "table");
      renderPage();
      expect(screen.getByTestId("chapter-list")).toBeInTheDocument();
    });

    it("treats a legacy 'bookshelf' preference as 'shelf'", () => {
      localStorage.setItem("chapters-view-preference", "bookshelf");
      renderPage();
      expect(screen.getByTestId("bookshelf-view")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Search + unread filter
  // -------------------------------------------------------------------------
  describe("search and filter", () => {
    it("shows All/Unread pills with live counts", () => {
      mockStoryContext = { ...mockStoryContext, storyProgress: PROGRESS_STARTED };
      renderPage();
      expect(screen.getByText("All 3")).toBeInTheDocument();
      // chapter-01 is read; chapter-02 and chapter-03 are not => 2 unread
      expect(screen.getByText("Unread 2")).toBeInTheDocument();
    });

    it("filters to unread chapters when the Unread pill is clicked", () => {
      mockStoryContext = { ...mockStoryContext, storyProgress: PROGRESS_STARTED };
      renderPage();
      fireEvent.click(screen.getByText("Unread 2"));
      expect(screen.queryByTestId("shelf-title-chapter-01")).not.toBeInTheDocument();
      expect(screen.getByTestId("shelf-title-chapter-02")).toBeInTheDocument();
      expect(screen.getByTestId("shelf-title-chapter-03")).toBeInTheDocument();
    });

    it("returns to all chapters when the All pill is clicked again", () => {
      mockStoryContext = { ...mockStoryContext, storyProgress: PROGRESS_STARTED };
      renderPage();
      fireEvent.click(screen.getByText("Unread 2"));
      fireEvent.click(screen.getByText("All 3"));
      expect(screen.getByTestId("shelf-title-chapter-01")).toBeInTheDocument();
    });

    it("persists the active filter to localStorage", () => {
      renderPage();
      fireEvent.click(screen.getByText(/Unread/));
      expect(localStorage.getItem("chapters-filter-preference")).toBe("unread");
    });

    it("restores the unread filter from localStorage", () => {
      localStorage.setItem("chapters-filter-preference", "unread");
      mockStoryContext = { ...mockStoryContext, storyProgress: PROGRESS_STARTED };
      renderPage();
      expect(screen.queryByTestId("shelf-title-chapter-01")).not.toBeInTheDocument();
    });

    it("filters by search query across title and summary", () => {
      renderPage();
      fireEvent.change(screen.getByPlaceholderText(/Search chapter titles/i), {
        target: { value: "hard day" },
      });
      expect(screen.getByTestId("shelf-title-chapter-02")).toBeInTheDocument();
      expect(screen.queryByTestId("shelf-title-chapter-01")).not.toBeInTheDocument();
      expect(screen.queryByTestId("shelf-title-chapter-03")).not.toBeInTheDocument();
    });

    it("updates pill counts live as the search query changes", () => {
      mockStoryContext = { ...mockStoryContext, storyProgress: PROGRESS_STARTED };
      renderPage();
      fireEvent.change(screen.getByPlaceholderText(/Search chapter titles/i), {
        target: { value: "aftermath" },
      });
      expect(screen.getByText("All 1")).toBeInTheDocument();
      expect(screen.getByText("Unread 1")).toBeInTheDocument();
    });

    it("shows the designed no-results state when the search matches nothing", () => {
      // A collection emptied by a *filter* offers no action: the fix is to
      // change the filter, and "New chapter" would answer a question nobody
      // asked. That distinction is `RosterEmpty`'s own documented rule.
      renderPage();
      fireEvent.change(screen.getByPlaceholderText(/Search chapter titles/i), {
        target: { value: "nonexistent chapter title" },
      });

      // A filtered list keeps its plain title and takes no rune: Muninn's
      // voice is for a campaign with no chapters at all.
      expect(
        screen.getByRole("heading", { name: "No chapters match this view" })
      ).toBeInTheDocument();
      expect(screen.queryByText("ᛗ")).not.toBeInTheDocument();
      // Not /new chapter/i: the header's "New Chapter" button is present
      // whenever the visitor can act, so that matcher would fail for the wrong
      // reason. What must be absent is the empty state's own action.
      expect(
        screen.queryByRole("button", { name: /write the first chapter/i })
      ).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Navigation from child views
  // -------------------------------------------------------------------------
  describe("navigation from child views", () => {
    it("navigates to a chapter on select from the shelf view", () => {
      renderPage();
      fireEvent.click(screen.getByTestId("shelf-select-chapter-01"));
      expect(mockNavigateToPage).toHaveBeenCalledWith("/story/chapters/chapter-01");
    });

    it("navigates to the edit route on edit from the shelf view", () => {
      renderPage();
      fireEvent.click(screen.getByTestId("shelf-edit-chapter-01"));
      expect(mockNavigateToPage).toHaveBeenCalledWith("/story/chapters/edit/chapter-01");
    });

    it("passes isAdmin=true to child views when the page is ready", () => {
      renderPage();
      expect(screen.getByTestId("bookshelf-view")).toHaveAttribute("data-is-admin", "true");
    });

    it("passes the full item count to BookshelfView", () => {
      renderPage();
      expect(screen.getByTestId("bookshelf-view")).toHaveAttribute("data-count", "3");
    });
  });

  // -------------------------------------------------------------------------
  // T017: deleting several chapters at once, from the list view
  // -------------------------------------------------------------------------
  describe("batch delete", () => {
    beforeEach(() => {
      localStorage.setItem("chapters-view-preference", "list");
      mockStoryContext.deleteChapters = jest.fn().mockResolvedValue(undefined);
    });

    const enterSelection = () => fireEvent.click(screen.getByRole("button", { name: "Select Chapters" }));
    const tick = (title: string) => fireEvent.click(screen.getByRole("checkbox", { name: `Select ${title}` }));

    it("offers selection in the list view only", () => {
      renderPage();
      expect(screen.getByRole("button", { name: "Select Chapters" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /shelf/i }));
      expect(screen.queryByRole("button", { name: "Select Chapters" })).not.toBeInTheDocument();
    });

    it("offers no selection while signed out", () => {
      mockUser = null;
      renderPage();
      expect(screen.queryByRole("button", { name: "Select Chapters" })).not.toBeInTheDocument();
    });

    it("deletes every ticked chapter in one call, only after confirmation, then leaves selection mode", async () => {
      renderPage();
      enterSelection();
      tick("The Beginning");
      tick("Aftermath");

      expect(screen.getByText("2 chapters selected")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(mockStoryContext.deleteChapters).not.toHaveBeenCalled();

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(/Delete 2 chapters\?/)).toBeInTheDocument();
      expect(within(dialog).getByText(/renumbered/)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: /delete chapters/i }));

      await waitFor(() =>
        expect(mockStoryContext.deleteChapters).toHaveBeenCalledWith(["chapter-01", "chapter-03"])
      );
      expect(mockStoryContext.deleteChapters).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole("checkbox")).not.toBeInTheDocument());
    });

    it("keeps a failed delete in the dialog, and the selection with it", async () => {
      mockStoryContext.deleteChapters = jest.fn().mockRejectedValue(new Error("permission-denied"));
      renderPage();
      enterSelection();
      tick("A Hard Day");

      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /delete chapter/i }));

      expect(await within(dialog).findByText("permission-denied")).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "Select A Hard Day" })).toBeChecked();
    });
  });
});
