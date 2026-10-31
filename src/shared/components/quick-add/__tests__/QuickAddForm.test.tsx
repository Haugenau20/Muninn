// src/shared/components/quick-add/__tests__/QuickAddForm.test.tsx
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import QuickAddForm from "../QuickAddForm";
import QuickAddDialog from "../QuickAddDialog";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

// ---------------------------------------------------------------------------
// The three write paths, plus note conversion's
// ---------------------------------------------------------------------------
const mockAddNPC = jest.fn();
const mockAddQuest = jest.fn();
const mockCreateLocation = jest.fn();
const mockMergeIntoRecord = jest.fn();
/*
  `convertInto` hands the create the note's mark to commit with (T088). The
  stand-in passes a token through, so a test can see the record's write
  carried it rather than a second write following it.
*/
const MARK = { collection: "notes", id: "note-7", change: () => ({}) };
const mockConvertInto = jest.fn(
  (_noteId: string, _entityId: string, create: (alongside?: unknown) => Promise<string>) => create(MARK)
);

/*
  The collections, not just the writers. `useQuickAddCreate` reads both to turn
  the extractor's names into ids before the write, so a mock that returned only
  the write functions would leave that step with nothing to resolve against --
  and this suite would pass while proving nothing about it.
*/
const mockNPCs = [{ id: "npc-frodo", name: "Frodo" }];
const mockLocations = [
  { id: "hobbiton", name: "Hobbiton" },
  { id: "loc-bree", name: "Bree" },
];

/** What each list hook was asked for, so a test can see which lists opened. */
const mockListReads: Record<string, unknown[]> = {};
const mockReadOf = (name: string) => (options: unknown) => {
  (mockListReads[name] ??= []).push(options);
};

jest.mock("features/campaign-entities", () => ({
  useNPCs: (options: unknown) => {
    mockReadOf("npcs")(options);
    return { addNPC: mockAddNPC, npcs: mockNPCs };
  },
  useQuests: (options: unknown) => {
    mockReadOf("quests")(options);
    return { addQuest: mockAddQuest };
  },
  useLocations: (options: unknown) => {
    mockReadOf("locations")(options);
    return { createLocation: mockCreateLocation, locations: mockLocations };
  },
  /*
    The real implementation, not a stub. `quickAddSpecs` calls this while
    building a quest document, so a mock returning something else would make
    this suite agree with itself rather than with the product -- and an absent
    one made every quest write throw, silently, into `submit`'s catch.
  */
  normaliseObjectives: jest.requireActual(
    "features/campaign-entities/quests/utils/quest-objectives"
  ).normaliseObjectives,
  // "Already exists" (T163): the real check and merge plan, and a stand-in
  // for the merge's write.
  ...jest.requireActual("features/campaign-entities/shared/sameName"),
  ...jest.requireActual("features/campaign-entities/shared/mergeRecords"),
  useMergeIntoRecord: () => mockMergeIntoRecord,
}));

jest.mock("features/collaboration", () => ({
  useNotes: (options: unknown) => {
    mockReadOf("notes")(options);
    return { convertInto: mockConvertInto };
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderForm(props: Partial<React.ComponentProps<typeof QuickAddForm>> = {}) {
  return render(
    <MemoryRouter>
      <QuickAddForm entity="npc" {...props} />
    </MemoryRouter>
  );
}

const nameField = () => screen.getByLabelText("Name");
const lineField = () => screen.getByLabelText("Who are they, in a line?");
const createAndOpen = () => screen.getByRole("button", { name: /create & open/i });
const createAndAddAnother = () =>
  screen.getByRole("button", { name: /create & add another/i });

beforeEach(() => {
  jest.clearAllMocks();
  mockAddNPC.mockResolvedValue("npc-1");
  mockAddQuest.mockResolvedValue("quest-1");
  mockCreateLocation.mockResolvedValue("location-1");
});

describe("QuickAddForm", () => {
  // -------------------------------------------------------------------------
  // Two fields, and only two
  // -------------------------------------------------------------------------
  describe("the surface", () => {
    it("asks for exactly two fields", () => {
      renderForm();
      const controls = screen.getAllByRole("textbox");
      expect(controls).toHaveLength(2);
    });

    it("labels them for the entity it is adding", () => {
      renderForm({ entity: "quest" });
      expect(screen.getByLabelText("Title")).toBeInTheDocument();
      expect(
        screen.getByLabelText("What was the party asked to do?")
      ).toBeInTheDocument();
    });

    it("offers no status control -- a new record's status is decided for it", () => {
      renderForm();
      expect(screen.queryByLabelText(/status/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/relationship/i)).not.toBeInTheDocument();
    });

    it("takes focus on the first field so typing starts immediately", () => {
      renderForm();
      expect(nameField()).toHaveFocus();
    });

    it("does not steal focus on the page mount, which has its own reading order", () => {
      renderForm({ autoFocus: false });
      expect(nameField()).not.toHaveFocus();
    });
  });

  // -------------------------------------------------------------------------
  // Validation -- exactly today's, and reported per field
  // -------------------------------------------------------------------------
  describe("validation", () => {
    it("refuses to write when both fields are empty", async () => {
      renderForm();
      await userEvent.click(createAndOpen());

      expect(mockAddNPC).not.toHaveBeenCalled();
      expect(screen.getByText("Give them a name.")).toBeInTheDocument();
      expect(screen.getByText("Say who they are, in a line.")).toBeInTheDocument();
    });

    it("puts the error under the field it belongs to, not on the form", async () => {
      renderForm();
      await userEvent.type(nameField(), "Thorin");
      await userEvent.click(createAndOpen());

      expect(screen.queryByText("Give them a name.")).not.toBeInTheDocument();
      expect(screen.getByText("Say who they are, in a line.")).toBeInTheDocument();
      expect(lineField()).toHaveAttribute("aria-invalid", "true");
      expect(nameField()).toHaveAttribute("aria-invalid", "false");
    });

    // A11Y-005: the reasons appeared on screen, but focus stayed on the
    // submit button and neither field described its own reason.
    it("moves focus to the first field it refused, which describes why", async () => {
      renderForm();
      await userEvent.click(createAndOpen());

      expect(nameField()).toHaveFocus();
      expect(nameField()).toHaveAccessibleDescription("Give them a name.");
      expect(lineField()).toHaveAccessibleDescription("Say who they are, in a line.");
    });

    it("moves focus to the line when only the line was refused", async () => {
      renderForm();
      await userEvent.type(nameField(), "Thorin");
      await userEvent.click(createAndOpen());

      expect(lineField()).toHaveFocus();
    });

    it("treats whitespace as empty", async () => {
      renderForm();
      await userEvent.type(nameField(), "   ");
      await userEvent.type(lineField(), "   ");
      await userEvent.click(createAndOpen());
      expect(mockAddNPC).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Create & open
  // -------------------------------------------------------------------------
  describe("Create & open", () => {
    it("writes the record and navigates to it", async () => {
      renderForm();
      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndOpen());

      await waitFor(() => expect(mockAddNPC).toHaveBeenCalledTimes(1));
      expect(mockAddNPC.mock.calls[0][0]).toMatchObject({
        name: "Thorin",
        description: "Exiled king",
        status: "alive",
        relationship: "unknown",
      });
      expect(mockNavigate).toHaveBeenCalledWith("/npcs/npc-1", {
        state: { quickAddFocus: "appearance" },
      });
    });

    it("sends a new quest to its own page, naming the first unwritten field", async () => {
      renderForm({ entity: "quest" });
      await userEvent.type(screen.getByLabelText("Title"), "Reclaim Erebor");
      await userEvent.type(
        screen.getByLabelText("What was the party asked to do?"),
        "Take the mountain"
      );
      await userEvent.click(createAndOpen());

      await waitFor(() => expect(mockAddQuest).toHaveBeenCalledTimes(1));
      expect(mockNavigate).toHaveBeenCalledWith("/quests/quest-1", {
        state: { quickAddFocus: "objectives" },
      });
    });

    it("tells the launcher it is done, so a dialog closes itself", async () => {
      const onCreated = jest.fn();
      renderForm({ onCreated });
      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndOpen());

      await waitFor(() => expect(onCreated).toHaveBeenCalledWith("npc-1"));
    });

    it("pre-sets a location's parent when launched from Add a place inside", async () => {
      renderForm({ entity: "location", parentId: "hobbiton" });
      await userEvent.type(screen.getByLabelText("Name"), "Bag End");
      await userEvent.type(
        screen.getByLabelText("What is this place, in a line?"),
        "A hobbit hole"
      );
      await userEvent.click(createAndOpen());

      await waitFor(() => expect(mockCreateLocation).toHaveBeenCalledTimes(1));
      expect(mockCreateLocation.mock.calls[0][0]).toMatchObject({
        parentId: "hobbiton",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Create & add another -- the bulk-prep case
  // -------------------------------------------------------------------------
  describe("Create & add another", () => {
    it("keeps the surface open, clears both fields and refocuses the first", async () => {
      renderForm();
      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndAddAnother());

      await waitFor(() => expect(mockAddNPC).toHaveBeenCalledTimes(1));
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(nameField()).toHaveValue("");
      expect(lineField()).toHaveValue("");
      await waitFor(() => expect(nameField()).toHaveFocus());
    });

    it("five times produces five records and never a stale field", async () => {
      const names = ["Thorin", "Balin", "Dwalin", "Fili", "Kili"];
      renderForm();

      for (let i = 0; i < names.length; i += 1) {
        mockAddNPC.mockResolvedValueOnce(`npc-${i + 1}`);
        await userEvent.type(nameField(), names[i]);
        await userEvent.type(lineField(), `Dwarf ${i + 1}`);
        await userEvent.click(createAndAddAnother());
        await waitFor(() => expect(mockAddNPC).toHaveBeenCalledTimes(i + 1));
      }

      expect(mockAddNPC).toHaveBeenCalledTimes(5);
      names.forEach((name, i) => {
        expect(mockAddNPC.mock.calls[i][0]).toMatchObject({
          name,
          description: `Dwarf ${i + 1}`,
        });
      });
      expect(nameField()).toHaveValue("");
      expect(lineField()).toHaveValue("");
    });

    it("counts what this run has added, quietly", async () => {
      renderForm();
      expect(screen.queryByText(/added/i)).not.toBeInTheDocument();

      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndAddAnother());
      expect(await screen.findByText("1 NPC added")).toBeInTheDocument();

      await userEvent.type(nameField(), "Balin");
      await userEvent.type(lineField(), "An old dwarf");
      await userEvent.click(createAndAddAnother());
      expect(await screen.findByText("2 NPCs added")).toBeInTheDocument();
    });

    it("reports each record it adds, without saying the launcher is done (T093)", async () => {
      const onAdded = jest.fn();
      const onCreated = jest.fn();
      mockAddNPC.mockResolvedValueOnce("npc-1").mockResolvedValueOnce("npc-2");
      renderForm({ onAdded, onCreated });

      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndAddAnother());
      await waitFor(() => expect(onAdded).toHaveBeenCalledWith("npc-1"));

      await userEvent.type(nameField(), "Balin");
      await userEvent.type(lineField(), "An old dwarf");
      await userEvent.click(createAndAddAnother());
      await waitFor(() => expect(onAdded).toHaveBeenCalledWith("npc-2"));

      expect(onAdded).toHaveBeenCalledTimes(2);
      expect(onCreated).not.toHaveBeenCalled();
    });

    it("reports the record Create & open adds, once", async () => {
      const onAdded = jest.fn();
      renderForm({ onAdded });
      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndOpen());

      await waitFor(() => expect(onAdded).toHaveBeenCalledWith("npc-1"));
      expect(onAdded).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Launched from the attach tray: every record made is attached (T093)
  // -------------------------------------------------------------------------
  describe("the dialog, opened by a caller that wants the id", () => {
    function renderDialog() {
      const onCreated = jest.fn();
      const onClose = jest.fn();
      render(
        <MemoryRouter>
          <QuickAddDialog entity="npc" onCreated={onCreated} onClose={onClose} />
        </MemoryRouter>
      );
      return { onCreated, onClose };
    }

    it("hands over every record Create & add another makes, and stays open", async () => {
      mockAddNPC.mockResolvedValueOnce("npc-1").mockResolvedValueOnce("npc-2");
      const { onCreated, onClose } = renderDialog();

      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndAddAnother());
      await waitFor(() => expect(onCreated).toHaveBeenCalledWith("npc-1"));

      await userEvent.type(nameField(), "Balin");
      await userEvent.type(lineField(), "An old dwarf");
      await userEvent.click(createAndAddAnother());
      await waitFor(() => expect(onCreated).toHaveBeenCalledWith("npc-2"));

      expect(onClose).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("hands over the record Create & open makes once, closes, and navigates nowhere", async () => {
      const { onCreated, onClose } = renderDialog();
      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndOpen());

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(onCreated).toHaveBeenCalledTimes(1);
      expect(onCreated).toHaveBeenCalledWith("npc-1");
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // The save contract (§7) -- creates obey it exactly as edits do
  // -------------------------------------------------------------------------
  describe("a rejected write", () => {
    it("keeps every character typed", async () => {
      mockAddNPC.mockRejectedValue(new Error("Permission denied"));
      renderForm();
      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndOpen());

      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent("Permission denied")
      );
      expect(nameField()).toHaveValue("Thorin");
      expect(lineField()).toHaveValue("Exiled king");
    });

    it("navigates nowhere and claims no success", async () => {
      mockAddNPC.mockRejectedValue(new Error("Permission denied"));
      const onCreated = jest.fn();
      renderForm({ onCreated });
      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndOpen());

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(onCreated).not.toHaveBeenCalled();
    });

    it("leaves the count alone when Create & add another fails", async () => {
      mockAddNPC.mockRejectedValue(new Error("Permission denied"));
      renderForm();
      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndAddAnother());

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(screen.queryByText(/added/i)).not.toBeInTheDocument();
      expect(nameField()).toHaveValue("Thorin");
    });
  });

  // -------------------------------------------------------------------------
  // Note conversion
  // -------------------------------------------------------------------------
  describe("note conversion", () => {
    // CHANGED for T088: the mark used to be a second write after the
    // record's, so a failed mark left the record behind. It now commits with
    // the record, so the assertion is on the record's own write.
    it("marks the source entity converted in the same write as the record", async () => {
      renderForm({ noteId: "note-7", entityId: "entity-3" });
      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndOpen());

      await waitFor(() =>
        expect(mockConvertInto).toHaveBeenCalledWith("note-7", "entity-3", expect.any(Function))
      );
      expect(mockAddNPC).toHaveBeenCalledWith(expect.objectContaining({ name: "Thorin" }), MARK, {
        askOnSameName: true,
      });
    });

    it("does not mark anything when the surface was not opened from a note", async () => {
      renderForm();
      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndOpen());

      await waitFor(() => expect(mockAddNPC).toHaveBeenCalled());
      expect(mockConvertInto).not.toHaveBeenCalled();
      // No change commits with it. Since T163 the create also carries its
      // "already exists" option, so the mark's place is read, not the count.
      expect(mockAddNPC.mock.calls[0][1]).toBeUndefined();
    });

    it("writes the carried fields the surface never showed", async () => {
      renderForm({ carry: { race: "Dwarf", occupation: "King" } });
      await userEvent.type(nameField(), "Thorin");
      await userEvent.type(lineField(), "Exiled king");
      await userEvent.click(createAndOpen());

      await waitFor(() => expect(mockAddNPC).toHaveBeenCalled());
      expect(mockAddNPC.mock.calls[0][0]).toMatchObject({
        race: "Dwarf",
        occupation: "King",
      });
    });

    it("starts from the values note conversion extracted", () => {
      renderForm({ initialName: "Elrond", initialLine: "Elf lord" });
      expect(nameField()).toHaveValue("Elrond");
      expect(lineField()).toHaveValue("Elf lord");
    });

    /*
      T062. Conversion lands a paragraph in the line field, and a two-row box
      made it unreadable before the user could decide whether to keep it. The
      box must open at the height of what it holds. jsdom does no layout, so
      the content height is stubbed to follow the value, one pixel per
      character.
    */
    describe("a long extracted description", () => {
      const original = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "scrollHeight"
      );

      beforeAll(() => {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
          configurable: true,
          get(this: HTMLTextAreaElement) {
            return this.value.length;
          },
        });
      });

      afterAll(() => {
        if (original) {
          Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", original);
        } else {
          delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>)
            .scrollHeight;
        }
      });

      it("opens the line box tall enough to show all of it", () => {
        const extracted = "An elf lord of Rivendell. ".repeat(20);
        renderForm({ initialName: "Elrond", initialLine: extracted });
        expect(lineField().style.height).toBe(`${extracted.length}px`);
      });

      it("keeps growing as the user adds to it", async () => {
        renderForm({ initialName: "Elrond", initialLine: "Elf lord" });
        await userEvent.type(lineField(), " of Rivendell");
        expect(lineField().style.height).toBe(
          `${"Elf lord of Rivendell".length}px`
        );
      });
    });
  });
});

// PERF2-003: quick add opened the NPC, quest, location and notes listeners on
// every mount, though a plain create reads none of them, and a released
// listener stays open for five minutes.
describe("QuickAddForm -- the lists it opens", () => {
  /**
   * Whether any reader asked `name`'s list to stay open. Since T163 the form
   * reads the lists twice, once to write and once, without opening any, for
   * the "already exists" dialog; a list is open when either asks.
   */
  const subscribed = (name: string) =>
    (mockListReads[name] ?? []).some(
      (read) => (read as { subscribe?: boolean } | undefined)?.subscribe ?? true
    );

  beforeEach(() => {
    Object.keys(mockListReads).forEach((key) => delete mockListReads[key]);
  });

  // CHANGED for T163: a create checks its name against the records of its
  // kind the client holds, so it opens that one list, and only that one.
  it.each([
    ["npc", "npcs"],
    ["quest", "quests"],
    ["location", "locations"],
  ] as const)("opens only its own kind's list for a plain %s", (entity, list) => {
    renderForm({ entity });
    expect(["npcs", "quests", "locations", "notes"].filter(subscribed)).toEqual([list]);
  });

  it("opens the locations when a carried location name has to become an id", () => {
    // A quest's: since T163 a person's create opens the people anyway.
    renderForm({ entity: "quest", carry: { location: "Bree" } });
    expect(subscribed("locations")).toBe(true);
    expect(subscribed("npcs")).toBe(false);
  });

  it("opens the NPCs when a quest carries names of people", () => {
    renderForm({ entity: "quest", carry: { relatedNPCNames: ["Frodo"] } });
    expect(subscribed("npcs")).toBe(true);
  });

  it("opens the locations for a place created inside another", () => {
    renderForm({ entity: "location", parentId: "hobbiton" });
    expect(subscribed("locations")).toBe(true);
  });

  it("opens the notes when it converts a note's detection", () => {
    renderForm({ entity: "npc", noteId: "note-1", entityId: "ent-1" });
    expect(subscribed("notes")).toBe(true);
  });
});

// T163: a name a record already carries stops at "already exists", and the
// player's answer decides what is written.
describe("QuickAddForm -- already exists", () => {
  const { SameNameError } = jest.requireActual("features/campaign-entities/shared/sameName");
  const taken = () => new SameNameError("npc", "npc-frodo", "Frodo");

  const typeFrodo = async () => {
    await userEvent.type(nameField(), "frodo");
    await userEvent.type(lineField(), "Carries the ring");
  };

  beforeEach(() => {
    mockAddNPC.mockReset();
    mockMergeIntoRecord.mockReset();
    mockMergeIntoRecord.mockResolvedValue("npc-frodo");
  });

  it("asks first, naming the record and what adding would write", async () => {
    mockAddNPC.mockRejectedValueOnce(taken());
    renderForm();
    await typeFrodo();
    await userEvent.click(createAndOpen());

    const dialog = await screen.findByRole("dialog", { name: "A Frodo already exists" });
    expect(dialog).toHaveTextContent("Description: Carries the ring");
    expect(mockAddNPC).toHaveBeenCalledWith(expect.objectContaining({ name: "frodo" }), undefined, {
      askOnSameName: true,
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("adds what was typed to it, and opens it", async () => {
    mockAddNPC.mockRejectedValueOnce(taken());
    renderForm();
    await typeFrodo();
    await userEvent.click(createAndOpen());
    await userEvent.click(await screen.findByRole("button", { name: "Add to Frodo" }));

    await waitFor(() =>
      expect(mockMergeIntoRecord).toHaveBeenCalledWith(
        "npc",
        "npc-frodo",
        expect.objectContaining({ name: "frodo", description: "Carries the ring" }),
        undefined
      )
    );
    expect(mockAddNPC).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/npcs/npc-frodo", expect.anything())
    );
  });

  it("points a note's mark at the record it was added to", async () => {
    mockAddNPC.mockRejectedValueOnce(taken());
    renderForm({ noteId: "note-7", entityId: "entity-3" });
    await typeFrodo();
    await userEvent.click(createAndOpen());
    await userEvent.click(await screen.findByRole("button", { name: "Add to Frodo" }));

    await waitFor(() =>
      expect(mockMergeIntoRecord).toHaveBeenCalledWith("npc", "npc-frodo", expect.anything(), MARK)
    );
  });

  it("makes a second one when the name is kept on purpose", async () => {
    mockAddNPC.mockRejectedValueOnce(taken()).mockResolvedValueOnce("frodo-2");
    renderForm();
    await typeFrodo();
    await userEvent.click(createAndOpen());
    await userEvent.click(await screen.findByRole("button", { name: "Choose a name" }));
    await userEvent.click(screen.getByRole("button", { name: "Create frodo" }));

    await waitFor(() => expect(mockAddNPC).toHaveBeenCalledTimes(2));
    expect(mockAddNPC).toHaveBeenLastCalledWith(expect.objectContaining({ name: "frodo" }), undefined, {
      askOnSameName: false,
    });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/npcs/frodo-2", expect.anything()));
  });

  it("checks another name again", async () => {
    mockAddNPC.mockRejectedValueOnce(taken()).mockResolvedValueOnce("frodo-baggins");
    renderForm();
    await typeFrodo();
    await userEvent.click(createAndOpen());
    await userEvent.click(await screen.findByRole("button", { name: "Choose a name" }));
    const rename = screen.getAllByLabelText("Name").pop()!;
    await userEvent.clear(rename);
    await userEvent.type(rename, "Frodo Baggins{Enter}");

    await waitFor(() => expect(mockAddNPC).toHaveBeenCalledTimes(2));
    expect(mockAddNPC).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Frodo Baggins" }), undefined, {
      askOnSameName: true,
    });
  });

  it("keeps everything typed on cancel, and writes nothing", async () => {
    mockAddNPC.mockRejectedValueOnce(taken());
    renderForm();
    await typeFrodo();
    await userEvent.click(createAndOpen());
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "A Frodo already exists" })).not.toBeInTheDocument()
    );
    expect(nameField()).toHaveValue("frodo");
    expect(mockAddNPC).toHaveBeenCalledTimes(1);
    expect(mockMergeIntoRecord).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("opens the record instead, closing the surface", async () => {
    mockAddNPC.mockRejectedValueOnce(taken());
    const onCreated = jest.fn();
    renderForm({ onCreated });
    await typeFrodo();
    await userEvent.click(createAndOpen());
    await userEvent.click(await screen.findByRole("button", { name: "Open Frodo" }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/npcs/npc-frodo"));
    expect(onCreated).toHaveBeenCalledWith("npc-frodo");
    expect(mockMergeIntoRecord).not.toHaveBeenCalled();
  });
});
