// src/features/user-management/groups/pages/__tests__/JoinPage.test.tsx
//
// Rewritten for PR 14.4. The 14.1 version described a placeholder: the dialog's
// form body rendered in a plain container, with assertions about a Cancel
// button. This page is now the real thing -- a token stated rather than
// re-entered, a page state for a bad link, and registration as a step -- so the
// old assertions describe a surface that no longer exists.

import React from "react";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import JoinPage from "../JoinPage";

jest.mock("@/features/user-management/auth/hooks/useAuth", () => ({
  useAuth: jest.fn(),
}));
jest.mock("@/features/user-management/groups/hooks/useGroups", () => ({
  useGroups: jest.fn(),
}));
jest.mock("@/features/user-management/groups/hooks/useInvitations", () => ({
  useInvitations: jest.fn(),
}));

const completeJoin = jest.fn().mockResolvedValue(undefined);
jest.mock(
  "@/features/user-management/groups/hooks/useJoinGroupCompletion",
  () => ({ useJoinGroupCompletion: () => completeJoin })
);

// The two account paths have their own suites; this one is about which of them
// the page chooses, and when.
jest.mock("@/features/user-management/groups/components/JoinAsNewUser", () => ({
  __esModule: true,
  default: ({
    token,
    groupId,
    onBusyChange,
  }: {
    token: string;
    groupId: string;
    onBusyChange?: (busy: boolean) => void;
  }) => (
    <div data-testid="new-user-step">
      {`${token}|${groupId}`}
      <button onClick={() => onBusyChange?.(true)}>start google</button>
    </div>
  ),
}));
jest.mock("@/features/user-management/groups/components/JoinAsExistingUser", () => ({
  __esModule: true,
  default: ({ token, username }: { token: string; username?: string }) => (
    <div data-testid="existing-user-step">{`${token}|${username ?? ""}`}</div>
  ),
}));

// A founder link's flow has its own suite (StartGroup.test.tsx).
jest.mock("@/features/user-management/groups/components/StartGroup", () => ({
  __esModule: true,
  default: ({ founderToken }: { founderToken: string }) => (
    <div data-testid="start-group">{founderToken}</div>
  ),
}));

const { useAuth } = require("@/features/user-management/auth/hooks/useAuth");
const { useGroups } = require("@/features/user-management/groups/hooks/useGroups");
const {
  useInvitations,
} = require("@/features/user-management/groups/hooks/useInvitations");

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="landed">{location.pathname}</div>;
};

function setup({
  path = "/join?token=tok-1",
  user = null as { uid: string } | null,
  authLoading = false,
  valid = true,
  throws = false,
  username = undefined as string | undefined,
} = {}) {
  useAuth.mockReturnValue({ user, loading: authLoading });
  useGroups.mockReturnValue({
    activeGroupUserProfile: username ? { username } : null,
  });
  useInvitations.mockReturnValue({
    validateToken: jest.fn(() =>
      throws ? Promise.reject(new Error("boom")) : Promise.resolve(valid)
    ),
  });

  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/join" element={<JoinPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("JoinPage", () => {
  beforeEach(() => jest.clearAllMocks());

  test("is a page, with no dialog around it", async () => {
    setup();
    await settle();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("says what the page is before asking for anything", async () => {
    setup();
    await settle();
    expect(screen.getByText(/you have been invited to join/i)).toBeInTheDocument();
  });

  describe("a token that arrived by link", () => {
    // Presenting a pre-filled field asks the reader to check a value they
    // cannot verify and must not edit, and invites them to break a working
    // invitation by typing in it.
    test("is stated, not offered as a field to re-enter", async () => {
      setup();
      await settle();
      expect(screen.getByTestId("invitation-confirmed")).toHaveTextContent(
        /nothing to paste/i
      );
      expect(screen.queryByLabelText(/invitation token/i)).not.toBeInTheDocument();
    });

    test("never prints the token string itself", async () => {
      setup();
      await settle();
      expect(
        screen.getByTestId("invitation-confirmed")
      ).not.toHaveTextContent("tok-1");
    });

    test("is carried through to the step that uses it", async () => {
      setup();
      await settle();
      expect(screen.getByTestId("new-user-step")).toHaveTextContent("tok-1");
    });
  });

  describe("no token in the query", () => {
    test("offers the paste field instead", async () => {
      setup({ path: "/join" });
      await settle();
      expect(screen.getByLabelText(/invitation token/i)).toBeInTheDocument();
    });

    test("validates what was pasted", async () => {
      setup({ path: "/join" });
      await settle();
      await userEvent.type(screen.getByLabelText(/invitation token/i), "pasted-1");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));
      await settle();
      expect(screen.getByTestId("new-user-step")).toHaveTextContent("pasted-1");
    });
  });

  describe("a link that cannot be used", () => {
    // A page state, not a red line under a field: the link is the problem and
    // no amount of retyping fixes it.
    test("is a page state naming the next step, not a field error", async () => {
      setup({ valid: false });
      await settle();
      expect(
        screen.getByRole("heading", { name: /cannot be used/i })
      ).toBeInTheDocument();
      expect(screen.getByText(/ask whoever sent it/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/invitation token/i)).not.toBeInTheDocument();
    });

    test("offers no account step at all", async () => {
      setup({ valid: false });
      await settle();
      expect(screen.queryByTestId("new-user-step")).not.toBeInTheDocument();
      expect(screen.queryByTestId("existing-user-step")).not.toBeInTheDocument();
    });

    test("treats a validation failure the same way", async () => {
      setup({ throws: true });
      await settle();
      expect(
        screen.getByRole("heading", { name: /cannot be used/i })
      ).toBeInTheDocument();
    });
  });

  describe("who is arriving", () => {
    test("a visitor with no account gets the create-account step", async () => {
      setup({ user: null });
      await settle();
      expect(screen.getByTestId("new-user-step")).toBeInTheDocument();
      expect(screen.queryByTestId("existing-user-step")).not.toBeInTheDocument();
    });

    // Showing a registration form to somebody who already has an account is
    // exactly what the dialog did.
    test("a signed-in visitor is offered the join, not a registration form", async () => {
      setup({ user: { uid: "u1" }, username: "Legolas" });
      await settle();
      expect(screen.getByTestId("existing-user-step")).toHaveTextContent("Legolas");
      expect(screen.queryByTestId("new-user-step")).not.toBeInTheDocument();
    });

    test("hands the create-account step the invitation's group", async () => {
      setup({ path: "/join?groupId=g-7&token=tok-1", user: null });
      await settle();
      expect(screen.getByTestId("new-user-step")).toHaveTextContent("tok-1|g-7");
    });

    // A Google sign-in makes `user` non-null halfway through the step's own
    // work. Swapping to the signed-in step then would unmount the step before
    // it has joined anybody to anything.
    test("keeps the create-account step while it is signing somebody in", async () => {
      const view = setup({ user: null });
      await settle();
      await userEvent.click(screen.getByRole("button", { name: "start google" }));

      useAuth.mockReturnValue({ user: { uid: "u-new" }, loading: true });
      view.rerender(
        <MemoryRouter initialEntries={["/join?token=tok-1"]}>
          <Routes>
            <Route path="/join" element={<JoinPage />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByTestId("new-user-step")).toBeInTheDocument();
      expect(screen.queryByTestId("existing-user-step")).not.toBeInTheDocument();
    });

    // #1423's shape: `user` is null both when signed out and while auth is
    // rehydrating, so deciding here would show a create-account form to a
    // member who already has one.
    test("decides nothing while auth is still rehydrating", async () => {
      setup({ user: null, authLoading: true });
      await settle();
      expect(screen.queryByTestId("new-user-step")).not.toBeInTheDocument();
      expect(screen.queryByTestId("existing-user-step")).not.toBeInTheDocument();
      expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    });
  });

  // T127: a founder link starts a group instead of joining one.
  describe("a founder link", () => {
    test("leads to starting a group, checking no invitation", async () => {
      setup({ path: "/join?founder=f-tok" });
      await settle();
      expect(screen.getByTestId("start-group")).toHaveTextContent("f-tok");
      expect(screen.queryByTestId("new-user-step")).not.toBeInTheDocument();
      expect(useInvitations.mock.results[0].value.validateToken).not.toHaveBeenCalled();
    });

    test("with no token, still leads there, to ask for one", async () => {
      setup({ path: "/join?founder=" });
      await settle();
      expect(screen.getByTestId("start-group")).toBeEmptyDOMElement();
    });
  });
});
