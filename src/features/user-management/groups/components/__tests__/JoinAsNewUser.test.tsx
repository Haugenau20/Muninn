// src/features/user-management/groups/components/__tests__/JoinAsNewUser.test.tsx
//
// Rewritten for T022, which removed password sign-up on purpose. The account
// is now created by a magic link or Google, and only after the invitation has
// reserved the address (`reserveSignUp`). The password-rule and
// password-match tests went with the password fields. What is unchanged -- the
// name asked first and explained, the email validated, the way out for
// somebody who already has an account -- is still asserted.
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import JoinAsNewUser from "../JoinAsNewUser";

jest.mock("@/features/user-management/profiles/hooks/useUser", () => ({
  useUser: jest.fn(),
}));
jest.mock("@/features/user-management/groups/hooks/useInvitations", () => ({
  useInvitations: jest.fn(),
}));
jest.mock("@/features/user-management/auth/hooks/useAuth", () => ({
  useAuth: jest.fn(),
}));

const { useUser } = require("@/features/user-management/profiles/hooks/useUser");
const {
  useInvitations,
} = require("@/features/user-management/groups/hooks/useInvitations");
const { useAuth } = require("@/features/user-management/auth/hooks/useAuth");

const reserveSignUp = jest.fn();
const joinGroupWithToken = jest.fn();
const sendSignInLink = jest.fn();
const signInWithGoogle = jest.fn();
const deleteFreshAccount = jest.fn();
const reloadUserContext = jest.fn();
const validateUsername = jest.fn();

function setup({ onJoined = jest.fn(), onBusyChange = jest.fn() } = {}) {
  useUser.mockReturnValue({ validateUsername });
  useInvitations.mockReturnValue({ reserveSignUp, joinGroupWithToken });
  useAuth.mockReturnValue({ sendSignInLink, signInWithGoogle, deleteFreshAccount, reloadUserContext });
  render(
    <MemoryRouter>
      <JoinAsNewUser token="tok-1" groupId="g-1" onJoined={onJoined} onBusyChange={onBusyChange} />
    </MemoryRouter>
  );
  return { onJoined, onBusyChange };
}

const linkButton = () => screen.getByRole("button", { name: /email me a link to join/i });
const googleButton = () => screen.getByRole("button", { name: /join with google/i });

/** Fill both fields with values that should pass, and wait for the name check. */
async function fillValid() {
  await userEvent.type(screen.getByLabelText(/your name in this group/i), "Boromir");
  await userEvent.type(screen.getByLabelText(/^email/i), "b@gondor.test");
  // The username check is debounced at 500ms.
  await waitFor(() => expect(validateUsername).toHaveBeenCalled(), { timeout: 3000 });
  await waitFor(() => expect(linkButton()).toBeEnabled());
}

/** An error shaped like the one a refused blocking function produces. */
const gateRefusal = () =>
  Object.assign(new Error("Firebase: INVITE_REQUIRED: refused (auth/internal-error)."), {
    code: "auth/internal-error",
  });

describe("JoinAsNewUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    validateUsername.mockResolvedValue({ isValid: true, isAvailable: true });
    reserveSignUp.mockResolvedValue(undefined);
    joinGroupWithToken.mockResolvedValue(undefined);
    sendSignInLink.mockResolvedValue(undefined);
    signInWithGoogle.mockResolvedValue({ user: { uid: "u-new" }, isNewUser: true });
    deleteFreshAccount.mockResolvedValue(undefined);
    reloadUserContext.mockResolvedValue(undefined);
  });

  // The name is not an account name, and people get that wrong. It is asked
  // first, while attention is still on the group.
  test("asks for the group name before the email", () => {
    setup();
    const labels = Array.from(document.querySelectorAll("label")).map((l) =>
      (l.textContent ?? "").toLowerCase()
    );
    const nameAt = labels.findIndex((l) => l.includes("name in this group"));
    const emailAt = labels.findIndex((l) => l.includes("email"));
    expect(nameAt).toBeGreaterThanOrEqual(0);
    expect(nameAt).toBeLessThan(emailAt);
  });

  test("says what the name is for, in the words that matter", () => {
    setup();
    expect(
      screen.getByText(/other members see this name on everything you write/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/not an account name/i)).toBeInTheDocument();
  });

  test("asks for no password", () => {
    setup();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  test("offers neither way in until the name and email are valid", () => {
    setup();
    expect(linkButton()).toBeDisabled();
    expect(googleButton()).toBeDisabled();
  });

  test("refuses an address that is not one", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/^email/i), "not-an-email");
    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
  });

  describe("by magic link", () => {
    test("reserves the address, then sends a link that carries the invitation", async () => {
      setup();
      await fillValid();
      await userEvent.click(linkButton());

      await waitFor(() => expect(sendSignInLink).toHaveBeenCalled());
      expect(reserveSignUp).toHaveBeenCalledWith("tok-1", "b@gondor.test");
      expect(reserveSignUp.mock.invocationCallOrder[0]).toBeLessThan(
        sendSignInLink.mock.invocationCallOrder[0]
      );

      const [address, url] = sendSignInLink.mock.calls[0];
      expect(address).toBe("b@gondor.test");
      const link = new URL(url);
      expect(link.pathname).toBe("/auth/link");
      expect(link.searchParams.get("groupId")).toBe("g-1");
      expect(link.searchParams.get("token")).toBe("tok-1");
      expect(link.searchParams.get("username")).toBe("Boromir");
    });

    test("says where the link went and what opening it does", async () => {
      setup();
      await fillValid();
      await userEvent.click(linkButton());
      expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
      expect(screen.getByText("b@gondor.test")).toBeInTheDocument();
    });

    test("sends nothing when the invitation cannot be reserved", async () => {
      reserveSignUp.mockRejectedValueOnce(new Error("This invitation has expired. Ask for a new link."));
      setup();
      await fillValid();
      await userEvent.click(linkButton());
      expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
      expect(sendSignInLink).not.toHaveBeenCalled();
    });
  });

  // T151: the same address again, without going back to the form.
  describe("sending the link again", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    /** Send the first link with a clock the test moves, and wait out the first resend wait. */
    async function sendThenWait() {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      setup();
      await user.type(screen.getByLabelText(/your name in this group/i), "Boromir");
      await user.type(screen.getByLabelText(/^email/i), "b@gondor.test");
      await waitFor(() => expect(linkButton()).toBeEnabled());
      await user.click(linkButton());
      await screen.findByText(/check your inbox/i);
      act(() => { jest.advanceTimersByTime(60 * 1000); });
      return user;
    }

    const resendButton = () => screen.getByRole("button", { name: /send it again/i });

    test("reserves the address again, then sends the same link", async () => {
      const user = await sendThenWait();
      await user.click(resendButton());

      expect(await screen.findByText(/sent again/i)).toHaveTextContent(/newest email/i);
      expect(reserveSignUp).toHaveBeenCalledTimes(2);
      expect(reserveSignUp).toHaveBeenLastCalledWith("tok-1", "b@gondor.test");
      expect(reserveSignUp.mock.invocationCallOrder[1]).toBeLessThan(
        sendSignInLink.mock.invocationCallOrder[1]
      );
      expect(sendSignInLink.mock.calls[1]).toEqual(sendSignInLink.mock.calls[0]);
    });

    test("sends nothing, and says why, when the invitation is gone by then", async () => {
      const user = await sendThenWait();
      reserveSignUp.mockRejectedValueOnce(new Error("This invitation has already been used. Ask for a new link."));
      await user.click(resendButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(/already been used/i);
      expect(sendSignInLink).toHaveBeenCalledTimes(1);
    });

    test("still offers another address", async () => {
      const user = await sendThenWait();
      await user.click(screen.getByRole("button", { name: /use a different email/i }));
      expect(linkButton()).toBeInTheDocument();
    });
  });

  describe("with Google", () => {
    test("reserves, signs in with the address pre-selected, joins, and reloads", async () => {
      const { onJoined } = setup();
      await fillValid();
      await userEvent.click(googleButton());

      await waitFor(() => expect(onJoined).toHaveBeenCalled());
      expect(reserveSignUp).toHaveBeenCalledWith("tok-1", "b@gondor.test");
      expect(signInWithGoogle).toHaveBeenCalledWith(false, "b@gondor.test");
      expect(joinGroupWithToken).toHaveBeenCalledWith("tok-1", "Boromir");
      expect(reloadUserContext).toHaveBeenCalled();
    });

    // The page swaps this form out as soon as somebody is signed in, which
    // Google does halfway through. It has to be told to hold on.
    test("tells the page it is busy for the whole sign-in, then done", async () => {
      const { onBusyChange, onJoined } = setup();
      await fillValid();
      await userEvent.click(googleButton());
      await waitFor(() => expect(onJoined).toHaveBeenCalled());
      expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    });

    test("explains a Google account other than the one entered", async () => {
      signInWithGoogle.mockRejectedValueOnce(gateRefusal());
      const { onJoined } = setup();
      await fillValid();
      await userEvent.click(googleButton());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        /google account you picked is not b@gondor.test/i
      );
      expect(joinGroupWithToken).not.toHaveBeenCalled();
      expect(onJoined).not.toHaveBeenCalled();
    });

    test("deletes a brand-new account whose invitation then fails", async () => {
      joinGroupWithToken.mockRejectedValueOnce(new Error("Username is already taken in this group."));
      const { onJoined } = setup();
      await fillValid();
      await userEvent.click(googleButton());
      expect(await screen.findByRole("alert")).toHaveTextContent(/already taken/i);
      expect(deleteFreshAccount).toHaveBeenCalled();
      expect(onJoined).not.toHaveBeenCalled();
    });

    test("keeps an existing account whose join fails", async () => {
      signInWithGoogle.mockResolvedValueOnce({ user: { uid: "u-old" }, isNewUser: false });
      joinGroupWithToken.mockRejectedValueOnce(new Error("You are already a member of this group."));
      setup();
      await fillValid();
      await userEvent.click(googleButton());
      await screen.findByRole("alert");
      expect(deleteFreshAccount).not.toHaveBeenCalled();
    });

    test("stays quiet when the popup is simply closed", async () => {
      signInWithGoogle.mockRejectedValueOnce(
        Object.assign(new Error("closed"), { code: "auth/popup-closed-by-user" })
      );
      setup();
      await fillValid();
      await userEvent.click(googleButton());
      await waitFor(() => expect(googleButton()).toBeEnabled());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    // A blocked popup needs a second press; the reservation already exists.
    test("does not reserve again on a second press for the same address", async () => {
      signInWithGoogle.mockRejectedValueOnce(
        Object.assign(new Error("blocked"), { code: "auth/popup-blocked" })
      );
      const { onJoined } = setup();
      await fillValid();
      await userEvent.click(googleButton());
      expect(await screen.findByRole("alert")).toHaveTextContent(/blocked the google window/i);

      await userEvent.click(googleButton());
      await waitFor(() => expect(onJoined).toHaveBeenCalled());
      expect(reserveSignUp).toHaveBeenCalledTimes(1);
    });
  });

  // A swap has no URL and no visible progress; a link out and back does.
  test("offers the way out for somebody who already has an account", () => {
    setup();
    expect(screen.getByRole("link", { name: /sign in first/i })).toHaveAttribute(
      "href",
      "/signin"
    );
  });
});
