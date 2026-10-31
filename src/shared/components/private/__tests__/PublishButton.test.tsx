// src/shared/components/private/__tests__/PublishButton.test.tsx
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PublishButton from "../PublishButton";
import type { PublishQuestions } from "features/campaign-entities";

/**
 * T163: publishing asks first, naming what goes with the record and saying
 * it cannot be undone, then says where it went or why it did not.
 */

const mockNavigateToPage = jest.fn();
jest.mock("shared/hooks/useNavigation", () => ({
  useNavigation: () => ({ navigateToPage: mockNavigateToPage }),
}));

/** A publish that asks what the real one would, then ends as told. */
const publishing = (end: (ask: PublishQuestions) => Promise<any>) => jest.fn(async (_kind, _id, ask) => end(ask));

const show = (publish: ReturnType<typeof publishing>, onPublished = jest.fn()) => {
  render(<PublishButton publish={publish} kind="quest" id="fish" name="The fish" onPublished={onPublished} />);
  return onPublished;
};

beforeEach(() => jest.clearAllMocks());

it("names everything that goes with it, and that it cannot be undone", async () => {
  const publish = publishing(async (ask) => {
    await ask.confirm([
      { kind: "quest", id: "fish", name: "The fish" },
      { kind: "rumor", id: "riddles", name: "Riddles" },
    ]);
    return { published: false };
  });
  show(publish);
  await userEvent.click(screen.getByRole("button", { name: "Publish" }));

  const dialog = await screen.findByRole("dialog", { name: "Publish The fish?" });
  expect(dialog).toHaveTextContent("Everyone in the group will see it. Publishing cannot be undone");
  expect(dialog).toHaveTextContent("Riddles (rumour)");
  expect(screen.getByRole("button", { name: "Publish all 2" })).toBeInTheDocument();
});

it("publishes only once confirmed", async () => {
  let answered: boolean | undefined;
  const publish = publishing(async (ask) => {
    answered = await ask.confirm([{ kind: "quest", id: "fish", name: "The fish" }]);
    return answered ? { published: true, ids: { "quest:fish": "fish" } } : { published: false };
  });
  const onPublished = show(publish);
  await userEvent.click(screen.getByRole("button", { name: "Publish" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }));

  await waitFor(() => expect(answered).toBe(true));
  // Under the same id: nowhere new to go.
  expect(onPublished).not.toHaveBeenCalled();
});

it("says where it went when its id changed", async () => {
  const publish = publishing(async (ask) => {
    await ask.confirm([{ kind: "quest", id: "fish", name: "The fish" }]);
    return { published: true, ids: { "quest:fish": "fish-2" } };
  });
  const onPublished = show(publish);
  await userEvent.click(screen.getByRole("button", { name: "Publish" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }));
  await waitFor(() => expect(onPublished).toHaveBeenCalledWith("fish-2"));
});

it("cancels without publishing", async () => {
  let answered: boolean | undefined;
  const publish = publishing(async (ask) => {
    answered = await ask.confirm([{ kind: "quest", id: "fish", name: "The fish" }]);
    return { published: false };
  });
  show(publish);
  await userEvent.click(screen.getByRole("button", { name: "Publish" }));
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(answered).toBe(false));
});

it("opens the same-named record the author chose to open", async () => {
  show(publishing(async () => ({ published: false, open: { kind: "quest", id: "find-the-fish" } })));
  await userEvent.click(screen.getByRole("button", { name: "Publish" }));
  await waitFor(() => expect(mockNavigateToPage).toHaveBeenCalledWith("/quests/find-the-fish"));
});

it("says why it could not publish", async () => {
  show(publishing(async () => {
    throw new Error("Ledge is inside The cave, which is private: publish The cave first.");
  }));
  await userEvent.click(screen.getByRole("button", { name: "Publish" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("publish The cave first");
});

