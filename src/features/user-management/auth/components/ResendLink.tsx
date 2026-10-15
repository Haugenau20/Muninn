// src/features/user-management/auth/components/ResendLink.tsx
import React, { useEffect, useState } from 'react';
import Typography from 'core/components/Typography';
import { describeSignInError } from 'core/services/firebase/auth/signInErrors';

/** Props for {@link ResendLink}. */
export interface ResendLinkProps {
  /**
   * Send the same link to the same address again. Throws when it cannot; the
   * error is described here.
   */
  onResend: () => Promise<void>;
  /** Go back to the form to type another address. */
  onChangeAddress: () => void;
  /**
   * Said once a link has been sent again, after "Sent again." -- which email
   * to use now that there is more than one.
   */
  sentAgainNote: string;
}

/** How long the first resend waits, counted from the first send. */
export const FIRST_RESEND_WAIT_MS = 60 * 1000;

/** The longest any resend waits. */
export const LONGEST_RESEND_WAIT_MS = 10 * 60 * 1000;

/**
 * How long to wait before the next resend, after `resends` of them.
 *
 * It doubles each time: one, two, four, eight minutes, then ten. Sign-in opens
 * a device request with every send, at most five open per address within their
 * fifteen-minute life (`MAX_OPEN_REQUESTS`); waits that double keep a reader
 * who keeps pressing under that, so no resend goes out without its code.
 * Nothing on the server limits how often the browser asks Firebase for a link,
 * so this is also the only brake on a button pressed over and over.
 *
 * @param resends How many times the link has been sent again
 */
export const resendWaitMs = (resends: number): number =>
  Math.min(FIRST_RESEND_WAIT_MS * 2 ** resends, LONGEST_RESEND_WAIT_MS);

/**
 * A wait as the reader sees it: "45 s", or "2 min 5 s".
 * @param ms What is left, in milliseconds
 */
const formatWait = (ms: number): string => {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
};

/**
 * The foot of a "Check your inbox" screen: send the link again, or go back
 * for another address (T151).
 *
 * Every screen that emails a sign-in link uses it -- signing in, joining from
 * an invitation, a founder link -- so a missed email is answered the same way
 * on all three. Mounted when the first link has gone, so the first wait is
 * counted from then. The countdown is plain text, not a live region: a screen
 * reader would otherwise read out every second.
 */
const ResendLink: React.FC<ResendLinkProps> = ({ onResend, onChangeAddress, sentAgainNote }) => {
  const [resends, setResends] = useState(0);
  const [readyAt, setReadyAt] = useState(() => Date.now() + FIRST_RESEND_WAIT_MS);
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const waiting = readyAt > now;

  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const resend = async () => {
    if (waiting || sending) return;
    setSending(true);
    setError(null);
    try {
      await onResend();
      const sentAt = Date.now();
      setReadyAt(sentAt + resendWaitMs(resends + 1));
      setNow(sentAt);
      setResends(resends + 1);
    } catch (err) {
      setError(describeSignInError(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2">
      {resends > 0 && (
        <div role="status">
          <Typography variant="body-sm">
            Sent again. {sentAgainNote}
          </Typography>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-md border px-3 py-2 feedback-banner feedback-banner-error"
        >
          <Typography variant="body-sm">{error}</Typography>
        </div>
      )}
      <Typography variant="body-sm" color="secondary">
        Nothing there after a minute? Check your spam folder, or{' '}
        <button
          type="button"
          className="button-link underline disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={resend}
          disabled={waiting || sending}
        >
          send it again
        </button>
        {waiting && ` in ${formatWait(readyAt - now)}`}.
      </Typography>
      <Typography variant="body-sm" color="secondary">
        Wrong address?{' '}
        <button type="button" className="button-link underline" onClick={onChangeAddress}>
          Use a different email
        </button>
        .
      </Typography>
    </div>
  );
};

export default ResendLink;
