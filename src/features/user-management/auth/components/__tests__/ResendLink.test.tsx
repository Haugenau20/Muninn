// src/features/user-management/auth/components/__tests__/ResendLink.test.tsx
//
// T151: a "Check your inbox" screen offered only "use a different email", so
// the way to send the same link again was labelled as something else. These
// hold the foot every such screen now shares: a resend that says it is one,
// waits that grow, and the other address still on offer.
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResendLink, {
  FIRST_RESEND_WAIT_MS,
  LONGEST_RESEND_WAIT_MS,
  resendWaitMs
} from '../ResendLink';
import { unnamedControlsIn } from '@/test-utils/accessible-names';

const onResend = jest.fn();
const onChangeAddress = jest.fn();

function renderFoot() {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const view = render(
    <ResendLink
      onResend={onResend}
      onChangeAddress={onChangeAddress}
      sentAgainNote="Open the newest email."
    />
  );
  return { user, ...view };
}

const resendButton = () => screen.getByRole('button', { name: /send it again/i });

/** The line that offers the resend and says how long is left. */
const foot = () => screen.getByText(/nothing there after a minute/i);

/** Let `ms` pass, as the page's own clock would. */
const wait = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

describe('ResendLink', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    onResend.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('offers to send the link again, by that name', () => {
    renderFoot();
    expect(resendButton()).toBeInTheDocument();
  });

  test('waits a minute after the first send, and says how long is left', () => {
    renderFoot();
    expect(resendButton()).toBeDisabled();
    expect(foot()).toHaveTextContent(/in 1 min\./);

    wait(15 * 1000);
    expect(foot()).toHaveTextContent(/in 45 s\./);

    wait(45 * 1000);
    expect(resendButton()).toBeEnabled();
    expect(foot()).not.toHaveTextContent(/ in \d/);
  });

  test('sends again when pressed, and says which email to use', async () => {
    const { user } = renderFoot();
    wait(FIRST_RESEND_WAIT_MS);
    await user.click(resendButton());

    expect(onResend).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('Sent again. Open the newest email.');
  });

  test('waits longer after each resend', async () => {
    const { user } = renderFoot();
    wait(FIRST_RESEND_WAIT_MS);
    await user.click(resendButton());
    await screen.findByRole('status');

    expect(resendButton()).toBeDisabled();
    expect(foot()).toHaveTextContent(/in 2 min\./);
    wait(2 * 60 * 1000 - 1000);
    expect(resendButton()).toBeDisabled();
    wait(1000);
    expect(resendButton()).toBeEnabled();
  });

  // Five open device requests per address, each living fifteen minutes: the
  // first five sends must not need a sixth while the first is still open.
  test('never asks for more than five sends in fifteen minutes', () => {
    const sendTimes = [0];
    for (let resends = 0; resends < 4; resends++) {
      sendTimes.push(sendTimes[sendTimes.length - 1] + resendWaitMs(resends));
    }
    const sixth = sendTimes[4] + resendWaitMs(4);
    expect(sixth - sendTimes[0]).toBeGreaterThanOrEqual(15 * 60 * 1000);
    expect(resendWaitMs(10)).toBe(LONGEST_RESEND_WAIT_MS);
  });

  test('presses while a send is under way do nothing', async () => {
    let finish: () => void = () => undefined;
    onResend.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    const { user } = renderFoot();
    wait(FIRST_RESEND_WAIT_MS);
    await user.click(resendButton());

    expect(resendButton()).toBeDisabled();
    await act(async () => { finish(); });
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  test('says why when it cannot send, and can be pressed again at once', async () => {
    onResend.mockRejectedValueOnce(
      Object.assign(new Error('Firebase: quota (auth/quota-exceeded).'), { code: 'auth/quota-exceeded' })
    );
    const { user } = renderFoot();
    wait(FIRST_RESEND_WAIT_MS);
    await user.click(resendButton());

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(resendButton()).toBeEnabled();
  });

  test('still offers another address, at any time', async () => {
    const { user } = renderFoot();
    await user.click(screen.getByRole('button', { name: /use a different email/i }));
    expect(onChangeAddress).toHaveBeenCalledTimes(1);
  });

  test('every control has an accessible name', () => {
    const { container } = renderFoot();
    expect(unnamedControlsIn(container)).toEqual([]);
  });
});
