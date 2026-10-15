// src/features/user-management/auth/components/__tests__/SignInForm.test.tsx
//
// Rewritten for T022, which removed password sign-in on purpose. The form now
// offers a magic link by email, or Google. What the previous version asserted
// about the page around the form -- no heading of its own, no "create
// account", a sentence and a link to `/join`, the 30-day checkbox, the
// accessible-name and accent budgets -- is unchanged and still asserted here.
//
// Two password-era assertions are gone rather than rewritten: "one message for
// both fields" (there is one field) and "Invalid email or password" (there is
// no password). The enumeration concern behind them is handled where it now
// lives: asking for a link never says whether the address has an account.

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SignInForm from '../SignInForm';
import { unnamedControlsIn } from '@/test-utils/accessible-names';
import { formAccentsIn } from '@/test-utils/accent-budget';

const mockSendSignInLink = jest.fn();
const mockSignInWithGoogle = jest.fn();

jest.mock('@/features/user-management', () => ({
  useAuth: jest.fn(),
}));

// This component imports its hook directly (importing the domain barrel from
// inside the domain would be a circular import), so point that module at the
// barrel mock defined above.
jest.mock('../../hooks/useAuth', () => require('@/features/user-management'));

const { useAuth } = require('@/features/user-management');

function setupMocks(overrides: Record<string, any> = {}) {
  useAuth.mockReturnValue({
    sendSignInLink: mockSendSignInLink,
    signInWithGoogle: mockSignInWithGoogle,
    // No request by default: the other-device flow has its own suite below.
    startDeviceSignIn: jest.fn().mockResolvedValue(null),
    ...overrides,
  });
}

/** A Router is required: the "new here?" line links to `/join`. */
function renderForm(props: { onSuccess?: () => void; next?: string | null } = {}) {
  return render(
    <MemoryRouter>
      <SignInForm {...props} />
    </MemoryRouter>
  );
}

const emailInput = () => screen.getByRole('textbox', { name: /email/i });
const linkButton = () => screen.getByRole('button', { name: /email me a sign-in link/i });
const googleButton = () => screen.getByRole('button', { name: /continue with google/i });

/** An error shaped like the one a refused blocking function produces. */
const gateRefusal = (marker: string) =>
  Object.assign(new Error(`Firebase: ${marker}: refused (auth/internal-error).`), {
    code: 'auth/internal-error',
  });

describe('SignInForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
  });

  describe('rendering', () => {
    test('asks for an email and nothing else', () => {
      renderForm();
      expect(emailInput()).toBeInTheDocument();
      expect(document.querySelector('input[type="password"]')).toBeNull();
    });

    test('offers a magic link and Google', () => {
      renderForm();
      expect(linkButton()).toBeInTheDocument();
      expect(googleButton()).toBeInTheDocument();
    });

    test('renders the keep-me-signed-in checkbox', () => {
      renderForm();
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
      expect(screen.getByText(/keep me signed in for 30 days/i)).toBeInTheDocument();
    });

    test('does not offer the link until the address looks like one', async () => {
      renderForm();
      expect(linkButton()).toBeDisabled();
      await userEvent.type(emailInput(), 'a@b.test');
      expect(linkButton()).toBeEnabled();
    });

    test('shows no error initially', () => {
      renderForm();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    // The form is titled by the page, once.
    test('contributes no heading of its own', () => {
      renderForm();
      expect(screen.queryAllByRole('heading')).toHaveLength(0);
    });

    test('does not offer to create an account', () => {
      renderForm();
      expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
    });

    test('says where accounts come from, and links to /join', () => {
      renderForm();
      expect(screen.getByText(/accounts are created from an invitation/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /paste its token/i })).toHaveAttribute('href', '/join');
    });
  });

  describe('magic link', () => {
    test('sends a link that opens /auth/link, carrying the destination', async () => {
      mockSendSignInLink.mockResolvedValueOnce(undefined);
      renderForm({ next: '/npcs' });
      await userEvent.type(emailInput(), 'a@b.test');
      await userEvent.click(linkButton());
      await waitFor(() =>
        expect(mockSendSignInLink).toHaveBeenCalledWith(
          'a@b.test',
          `${window.location.origin}/auth/link?next=%2Fnpcs`,
          false
        )
      );
    });

    // The 30-day semantics are wiring this change must not lose.
    test('passes rememberMe=true when the checkbox is checked', async () => {
      mockSendSignInLink.mockResolvedValueOnce(undefined);
      renderForm();
      await userEvent.type(emailInput(), 'a@b.test');
      await userEvent.click(screen.getByRole('checkbox'));
      await userEvent.click(linkButton());
      await waitFor(() =>
        expect(mockSendSignInLink).toHaveBeenCalledWith('a@b.test', expect.any(String), true)
      );
    });

    test('says where the link went, and offers another address', async () => {
      mockSendSignInLink.mockResolvedValueOnce(undefined);
      renderForm();
      await userEvent.type(emailInput(), 'a@b.test');
      await userEvent.click(linkButton());

      expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
      expect(screen.getByText('a@b.test')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /use a different email/i }));
      expect(emailInput()).toBeInTheDocument();
    });

    test('does not call onSuccess -- nobody is signed in until the link is opened', async () => {
      mockSendSignInLink.mockResolvedValueOnce(undefined);
      const onSuccess = jest.fn();
      renderForm({ onSuccess });
      await userEvent.type(emailInput(), 'a@b.test');
      await userEvent.click(linkButton());
      await screen.findByText(/check your inbox/i);
      expect(onSuccess).not.toHaveBeenCalled();
    });

    test('shows an error when the link cannot be sent', async () => {
      mockSendSignInLink.mockRejectedValueOnce(
        Object.assign(new Error('quota'), { code: 'auth/too-many-requests' })
      );
      renderForm();
      await userEvent.type(emailInput(), 'a@b.test');
      await userEvent.click(linkButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
    });

    test('disables both buttons while sending', async () => {
      let resolve: () => void = () => {};
      mockSendSignInLink.mockImplementationOnce(() => new Promise<void>((r) => { resolve = r; }));
      renderForm();
      await userEvent.type(emailInput(), 'a@b.test');
      await userEvent.click(linkButton());
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /sending link/i })).toBeDisabled()
      );
      expect(googleButton()).toBeDisabled();
      resolve();
      await screen.findByText(/check your inbox/i);
    });
  });

  describe('Google', () => {
    test('signs in with the chosen session length and calls onSuccess', async () => {
      mockSignInWithGoogle.mockResolvedValueOnce({ user: { uid: 'u' }, isNewUser: false });
      const onSuccess = jest.fn();
      renderForm({ onSuccess });
      await userEvent.click(screen.getByRole('checkbox'));
      await userEvent.click(googleButton());
      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
      expect(mockSignInWithGoogle).toHaveBeenCalledWith(true);
    });

    test('explains an uninvited Google account, and does not call onSuccess', async () => {
      mockSignInWithGoogle.mockRejectedValueOnce(gateRefusal('INVITE_REQUIRED'));
      const onSuccess = jest.fn();
      renderForm({ onSuccess });
      await userEvent.click(googleButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(/no account for this google address/i);
      expect(onSuccess).not.toHaveBeenCalled();
    });

    test('says so when the site is full', async () => {
      mockSignInWithGoogle.mockRejectedValueOnce(gateRefusal('ACCOUNTS_FULL'));
      renderForm();
      await userEvent.click(googleButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(/not taking new accounts/i);
    });

    test('stays quiet when the popup is simply closed', async () => {
      mockSignInWithGoogle.mockRejectedValueOnce(
        Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' })
      );
      renderForm();
      await userEvent.click(googleButton());
      await waitFor(() => expect(googleButton()).toBeEnabled());
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});

describe('SignInForm — names and accents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
  });

  test('every control has an accessible name', () => {
    const { container } = renderForm();
    expect(unnamedControlsIn(container)).toEqual([]);
  });

  test('stays within the form accent budget', () => {
    const { container } = renderForm();
    expect(formAccentsIn(container).length).toBeLessThanOrEqual(2);
  });
});

describe('SignInForm — signing in with the code the link shows', () => {
  const mockStartDeviceSignIn = jest.fn();
  const mockClaimDeviceSignIn = jest.fn();
  const mockSignInWithDeviceToken = jest.fn();
  const REQUEST = { requestId: 'req-1', secret: 'sec', expiresAt: Date.now() + 15 * 60 * 1000 };

  /** A refusal shaped like one from a callable. */
  const callableError = (code: string, message: string) =>
    Object.assign(new Error(message), { code: `functions/${code}` });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendSignInLink.mockResolvedValue(undefined);
    mockStartDeviceSignIn.mockResolvedValue(REQUEST);
    mockClaimDeviceSignIn.mockResolvedValue({ status: 'approved', token: 'tok' });
    mockSignInWithDeviceToken.mockResolvedValue({ user: { uid: 'u1' }, isNewUser: false });
    setupMocks({
      startDeviceSignIn: mockStartDeviceSignIn,
      claimDeviceSignIn: mockClaimDeviceSignIn,
      signInWithDeviceToken: mockSignInWithDeviceToken,
    });
  });

  /** Ask for a link, and wait for the "Check your inbox" screen. */
  async function sendLink(props: { onSuccess?: () => void; next?: string | null } = {}, remember = false) {
    renderForm(props);
    await userEvent.type(emailInput(), 'frodo@shire.dev');
    if (remember) await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(linkButton());
    await screen.findByTestId('sign-in-link-sent');
  }

  const digits = () => screen.getAllByRole('textbox', { name: /digit \d of 6/i });
  const signInButton = () => screen.getByRole('button', { name: /^sign in$/i });

  test('puts the request in the link it sends', async () => {
    await sendLink({ next: '/quests' });
    expect(mockStartDeviceSignIn).toHaveBeenCalledWith('frodo@shire.dev');
    const url = new URL(mockSendSignInLink.mock.calls[0][1]);
    expect(url.searchParams.get('device')).toBe('req-1');
    expect(url.searchParams.get('next')).toBe('/quests');
  });

  test('asks for the 6-digit code the link shows, in six boxes', async () => {
    await sendLink();
    expect(screen.getByRole('group', { name: /code from the link/i })).toBeInTheDocument();
    expect(digits()).toHaveLength(6);
    expect(screen.getByTestId('sign-in-link-sent')).toHaveTextContent(/type the code it shows here/i);
  });

  // Signing in on the device that opens the link must never depend on this.
  test('still sends a plain link, and asks for no code, when the request cannot be opened', async () => {
    mockStartDeviceSignIn.mockRejectedValueOnce(new Error('Too many sign-in requests.'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await sendLink();
    errorSpy.mockRestore();
    const url = new URL(mockSendSignInLink.mock.calls[0][1]);
    expect(url.searchParams.get('device')).toBeNull();
    expect(screen.queryByTestId('device-sign-in')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('signs in as soon as the sixth digit is typed, keeping the 30-day choice', async () => {
    const onSuccess = jest.fn();
    await sendLink({ onSuccess }, true);
    await userEvent.type(digits()[0], '482913');

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mockClaimDeviceSignIn).toHaveBeenCalledTimes(1);
    expect(mockClaimDeviceSignIn).toHaveBeenCalledWith(REQUEST, '482913');
    expect(mockSignInWithDeviceToken).toHaveBeenCalledWith('tok', true);
  });

  test('takes a pasted code', async () => {
    const onSuccess = jest.fn();
    await sendLink({ onSuccess });
    await userEvent.click(digits()[0]);
    await userEvent.paste('482913');

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mockClaimDeviceSignIn).toHaveBeenCalledWith(REQUEST, '482913');
  });

  test('does not offer to sign in before all six digits are there', async () => {
    await sendLink();
    await userEvent.type(digits()[0], '4829');
    expect(signInButton()).toBeDisabled();
    expect(mockClaimDeviceSignIn).not.toHaveBeenCalled();
  });

  test('a wrong code says so, clears the boxes, and can be typed again', async () => {
    const onSuccess = jest.fn();
    mockClaimDeviceSignIn.mockRejectedValueOnce(
      callableError('invalid-argument', 'That code does not match. 2 tries left.')
    );
    await sendLink({ onSuccess });
    await userEvent.type(digits()[0], '000000');

    expect(await screen.findByRole('alert')).toHaveTextContent(/2 tries left/);
    digits().forEach((box) => expect(box).toHaveValue(''));
    expect(onSuccess).not.toHaveBeenCalled();

    await userEvent.type(digits()[0], '482913');
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  test('says the code is no longer usable once the last try is spent', async () => {
    mockClaimDeviceSignIn.mockRejectedValueOnce(
      callableError('failed-precondition', 'That code does not match either, so this request is closed. Send a new link.')
    );
    await sendLink();
    await userEvent.type(digits()[0], '000000');

    expect(await screen.findByRole('alert')).toHaveTextContent(/request is closed/);
    expect(screen.getByTestId('device-sign-in')).toHaveTextContent(/can no longer be used/i);
    expect(screen.queryByRole('group', { name: /code from the link/i })).not.toBeInTheDocument();
  });

  test('says the code is no longer usable when the request has expired', async () => {
    mockClaimDeviceSignIn.mockResolvedValueOnce({ status: 'expired' });
    await sendLink();
    await userEvent.type(digits()[0], '482913');

    expect(await screen.findByText(/can no longer be used/i)).toBeInTheDocument();
    expect(mockSignInWithDeviceToken).not.toHaveBeenCalled();
  });

  test('explains a code typed before the link was opened', async () => {
    mockClaimDeviceSignIn.mockResolvedValueOnce({ status: 'pending' });
    await sendLink();
    await userEvent.type(digits()[0], '482913');

    expect(await screen.findByRole('alert')).toHaveTextContent(/open the link in the email first/i);
    expect(mockSignInWithDeviceToken).not.toHaveBeenCalled();
  });

  test('says so when the sign-in with the token fails', async () => {
    const onSuccess = jest.fn();
    mockSignInWithDeviceToken.mockRejectedValueOnce(
      Object.assign(new Error('offline'), { code: 'auth/network-request-failed' })
    );
    await sendLink({ onSuccess });
    await userEvent.type(digits()[0], '482913');

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test('forgets the request when the reader goes back to use a different email', async () => {
    await sendLink();
    await userEvent.click(screen.getByRole('button', { name: /use a different email/i }));
    expect(screen.queryByTestId('device-sign-in')).not.toBeInTheDocument();
    expect(emailInput()).toBeInTheDocument();
  });

  // T151: the same address again, without going back to the form.
  describe('sending the link again', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    /** Ask for a link with a clock the test moves, and wait out the first resend wait. */
    async function sendThenWait() {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      renderForm({ next: '/quests' });
      await user.type(emailInput(), 'frodo@shire.dev');
      await user.click(screen.getByRole('checkbox'));
      await user.click(linkButton());
      await screen.findByTestId('sign-in-link-sent');
      act(() => { jest.advanceTimersByTime(60 * 1000); });
      return user;
    }

    const resendButton = () => screen.getByRole('button', { name: /send it again/i });

    test('is offered on the "Check your inbox" screen, after a wait', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      renderForm();
      await user.type(emailInput(), 'frodo@shire.dev');
      await user.click(linkButton());
      await screen.findByTestId('sign-in-link-sent');
      expect(resendButton()).toBeDisabled();
      act(() => { jest.advanceTimersByTime(60 * 1000); });
      expect(resendButton()).toBeEnabled();
    });

    test('sends to the same address with a new request, keeping the destination and session length', async () => {
      const user = await sendThenWait();
      mockStartDeviceSignIn.mockResolvedValueOnce({ ...REQUEST, requestId: 'req-2' });
      await user.click(resendButton());

      await screen.findByText(/sent again/i);
      await waitFor(() => expect(mockSendSignInLink).toHaveBeenCalledTimes(2));
      expect(mockStartDeviceSignIn).toHaveBeenLastCalledWith('frodo@shire.dev');
      const [address, link, remember] = mockSendSignInLink.mock.calls[1];
      expect(address).toBe('frodo@shire.dev');
      expect(new URL(link).searchParams.get('device')).toBe('req-2');
      expect(new URL(link).searchParams.get('next')).toBe('/quests');
      expect(remember).toBe(true);
    });

    test('says only the newest code works, and claims with the new request', async () => {
      const user = await sendThenWait();
      const second = { ...REQUEST, requestId: 'req-2' };
      mockStartDeviceSignIn.mockResolvedValueOnce(second);
      await user.click(resendButton());

      expect(await screen.findByText(/sent again/i)).toHaveTextContent(
        /code from the newest email/i
      );
      await user.type(digits()[0], '482913');
      await waitFor(() => expect(mockClaimDeviceSignIn).toHaveBeenCalledWith(second, '482913'));
    });

    test('offers the code again once a spent request is replaced', async () => {
      const user = await sendThenWait();
      mockClaimDeviceSignIn.mockRejectedValueOnce(
        callableError('failed-precondition', 'This sign-in request has expired.')
      );
      await user.type(digits()[0], '000000');
      expect(await screen.findByText(/can no longer be used/i)).toBeInTheDocument();

      await user.click(resendButton());
      await screen.findByText(/sent again/i);
      expect(screen.queryByText(/can no longer be used/i)).not.toBeInTheDocument();
      expect(digits()).toHaveLength(6);
    });

    test('asks for no code when the new request cannot be opened', async () => {
      const user = await sendThenWait();
      mockStartDeviceSignIn.mockRejectedValueOnce(new Error('Too many sign-in requests.'));
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await user.click(resendButton());
      expect(await screen.findByText(/sent again/i)).toHaveTextContent(/on this device/i);
      errorSpy.mockRestore();
      expect(screen.queryByTestId('device-sign-in')).not.toBeInTheDocument();
      expect(new URL(mockSendSignInLink.mock.calls[1][1]).searchParams.get('device')).toBeNull();
    });

    test('says why when the link cannot be sent again, and keeps the screen', async () => {
      const user = await sendThenWait();
      mockSendSignInLink.mockRejectedValueOnce(
        Object.assign(new Error('Firebase: (auth/too-many-requests).'), { code: 'auth/too-many-requests' })
      );
      await user.click(resendButton());
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.getByTestId('sign-in-link-sent')).toBeInTheDocument();
    });
  });

  test('every control on the code screen has an accessible name', async () => {
    const { container } = renderForm();
    await userEvent.type(emailInput(), 'frodo@shire.dev');
    await userEvent.click(linkButton());
    await screen.findByTestId('sign-in-link-sent');
    expect(unnamedControlsIn(container)).toEqual([]);
  });
});
