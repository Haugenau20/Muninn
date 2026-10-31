// src/shared/components/same-name/__tests__/SameNameDialog.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SameNameDialog, { alreadyExistsTitle, recordHref, type SameNameRequest } from "../SameNameDialog";

/**
 * T163: "A Grog already exists", a way to open it, and three ways on. Adding
 * lists what it will write before anything is written.
 */

const request: SameNameRequest = {
  kind: "npc",
  name: "grog",
  existingId: "grog",
  existingName: "Grog",
  preview: ["Occupation: Smith", "A note with what it says differently: description"],
};

const showDialog = (overrides: Partial<SameNameRequest> = {}) => {
  const onChoose = jest.fn();
  render(<SameNameDialog {...request} {...overrides} onChoose={onChoose} />);
  return onChoose;
};

describe("SameNameDialog", () => {
  it("says which record already exists, by its own name", () => {
    showDialog();
    expect(screen.getByRole("dialog", { name: "A Grog already exists" })).toBeInTheDocument();
  });

  it("lists what adding will write before anything is", () => {
    showDialog();
    const merge = screen.getByRole("region", { name: "Add what you know to it" });
    expect(merge).toHaveTextContent("Occupation: Smith");
    expect(merge).toHaveTextContent("A note with what it says differently: description");
  });

  it("says when adding would change nothing, and when it cannot list yet", () => {
    const { unmount } = render(<SameNameDialog {...request} preview={[]} onChoose={jest.fn()} />);
    expect(screen.getByText("It already says everything you were adding.")).toBeInTheDocument();
    unmount();
    showDialog({ preview: null });
    expect(screen.getByText("What you add goes into it; nothing it already says is changed.")).toBeInTheDocument();
  });

  it("adds to it", async () => {
    const onChoose = showDialog();
    await userEvent.click(screen.getByRole("button", { name: "Add to Grog" }));
    expect(onChoose).toHaveBeenCalledWith({ action: "merge" });
  });

  it("opens it", async () => {
    const onChoose = showDialog();
    await userEvent.click(screen.getByRole("button", { name: "Open Grog" }));
    expect(onChoose).toHaveBeenCalledWith({ action: "open" });
  });

  it("creates as someone else, the name prefilled and allowed to stay", async () => {
    const onChoose = showDialog();
    await userEvent.click(screen.getByRole("button", { name: "Choose a name" }));
    const field = screen.getByLabelText("Name");
    expect(field).toHaveValue("grog");
    expect(field).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Create grog" }));
    expect(onChoose).toHaveBeenCalledWith({ action: "create", name: "grog" });
  });

  it("creates under the name typed instead", async () => {
    const onChoose = showDialog();
    await userEvent.click(screen.getByRole("button", { name: "Choose a name" }));
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Grog the Younger{Enter}");
    expect(onChoose).toHaveBeenCalledWith({ action: "create", name: "Grog the Younger" });
  });

  it("cancels", async () => {
    const onChoose = showDialog();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChoose).toHaveBeenCalledWith({ action: "cancel" });
  });

  it("offers no merge when told not to", () => {
    showDialog({ canMerge: false });
    expect(screen.queryByRole("button", { name: "Add to Grog" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Grog" })).toBeInTheDocument();
  });

  it("names the other record in its kind's terms, and the verb it is given", () => {
    showDialog({ kind: "quest", createVerb: "Convert" });
    expect(screen.getByRole("region", { name: "Convert as another quest" })).toBeInTheDocument();
  });
});

describe("alreadyExistsTitle", () => {
  it("reads as the maintainer wrote it, and leaves a leading article alone", () => {
    expect(alreadyExistsTitle("Grog")).toBe("A Grog already exists");
    expect(alreadyExistsTitle("the Crooked Plough")).toBe("The Crooked Plough already exists");
  });
});

describe("recordHref", () => {
  it("opens a record where it lives; a rumour in its list's row", () => {
    expect(recordHref("npc", "grog")).toBe("/npcs/grog");
    expect(recordHref("location", "ford")).toBe("/locations/ford");
    expect(recordHref("quest", "q")).toBe("/quests/q");
    expect(recordHref("rumor", "smoke")).toBe("/rumors?highlight=smoke");
  });
});
