// src/features/user-management/groups/components/__tests__/FounderSignUp.test.tsx
//
// The account step of a founder link. Held here: the reservation comes before
// the link, and a missed email can be sent again (T151) without going back to
// the form.
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import FounderSignUp from "../FounderSignUp";

jest.mock("@/features/user-management/groups/hooks/useInvitations", () => ({
  useInvitations: jest.fn(),
}));
jest.mock("@/features/user-management/auth/hooks/useAuth", () => ({
  useAuth: jest.fn(),
}));

const {
  useInvitations,
} = require("@/features/user-management/groups/hooks/useInvitations");
const { useAuth } = require("@/features/user-management/auth/hooks/useAuth");

const reserveFounderSignUp = jest.fn();
const sendSignInLink = jest.fn();
const signInWithGoogle = jest.fn();

const linkButton = () => screen.getByRole("button", { name: /email me a sign-in link/i });
const resendButton = () => screen.getByRole("button", { name: /send it again/i });

/** Send the first link with a clock the test moves. */
async function sendFirstLink() {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(
    <MemoryRouter>
      <FounderSignUp founderToken="f-tok" />
    </MemoryRouter>
  );
  await user.type(screen.getByLabelText(/^email/i), "rowan@table.test");
  await user.click(linkButton());
  await screen.findByText(/check your inbox/i);
  return user;
}

describe("FounderSignUp", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    useInvitations.mockReturnValue({ reserveFounderSignUp });
    useAuth.mockReturnValue({ sendSignInLink, signInWithGoogle });
    reserveFounderSignUp.mockResolvedValue(undefined);
    sendSignInLink.mockResolvedValue(undefined);
  });

  afterEach(() => jest.useRealTimers());

  test("reserves the address, then sends a link that carries the founder token", async () => {
    await sendFirstLink();
    expect(reserveFounderSignUp).toHaveBeenCalledWith("f-tok", "rowan@table.test");
    expect(reserveFounderSignUp.mock.invocationCallOrder[0]).toBeLessThan(
      sendSignInLink.mock.invocationCallOrder[0]
    );
    const [address, url] = sendSignInLink.mock.calls[0];
    expect(address).toBe("rowan@table.test");
    expect(new URL(url).searchParams.get("founder")).toBe("f-tok");
  });

  test("offers to send the link again after a minute", async () => {
    await sendFirstLink();
    expect(resendButton()).toBeDisabled();
    act(() => { jest.advanceTimersByTime(60 * 1000); });
    expect(resendButton()).toBeEnabled();
  });

  test("reserves the address again, then sends the same link", async () => {
    const user = await sendFirstLink();
    act(() => { jest.advanceTimersByTime(60 * 1000); });
    await user.click(resendButton());

    expect(await screen.findByText(/sent again/i)).toHaveTextContent(/newest email/i);
    expect(reserveFounderSignUp).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(sendSignInLink).toHaveBeenCalledTimes(2));
    expect(sendSignInLink.mock.calls[1]).toEqual(sendSignInLink.mock.calls[0]);
  });

  test("sends nothing, and says why, when the founder link is used by then", async () => {
    const user = await sendFirstLink();
    act(() => { jest.advanceTimersByTime(60 * 1000); });
    reserveFounderSignUp.mockRejectedValueOnce(
      new Error("This link to start a group has already been used. Ask for a new one.")
    );
    await user.click(resendButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/already been used/i);
    expect(sendSignInLink).toHaveBeenCalledTimes(1);
  });

  test("still offers another address", async () => {
    const user = await sendFirstLink();
    await user.click(screen.getByRole("button", { name: /use a different email/i }));
    expect(linkButton()).toBeInTheDocument();
  });
});
