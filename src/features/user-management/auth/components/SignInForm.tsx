import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { DeviceSignInRequest } from 'core/services/firebase/auth/AuthService';
import Typography from 'core/components/Typography';
import Input from 'core/components/Input';
import Button from 'core/components/Button';
import { Mail } from 'lucide-react';
import clsx from 'clsx';
import {
  describeSignInError,
  isPopupDismissed
} from 'core/services/firebase/auth/signInErrors';
import { signInLinkUrl } from '../utils/email-link';
import DevEmailLinkShortcut from './DevEmailLinkShortcut';
import CodeInput from './CodeInput';
import ResendLink from './ResendLink';

interface SignInFormProps {
  /**
   * Called once a sign-in has completed on this page: Google, or another
   * device approving this one.
   */
  onSuccess?: () => void;
  /**
   * Where a magic link should take the reader once it has signed them in.
   * Already validated by the page (`safeNextPath`).
   */
  next?: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** How many digits the code the link shows has. */
const CODE_LENGTH = 6;

/**
 * The error code a refusal carries, if any.
 * @param err Whatever was thrown
 */
const errorCode = (err: unknown): string | undefined => {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' ? code : undefined;
};

/**
 * The sign-in form. Passwordless: a magic link by email, or Google.
 *
 * No `Card` and no header of its own. `SignInPage` titles it once; wrapping it
 * in a titled card inside a titled dialog is what produced the two "Sign In"
 * headings that made the case for this phase in the first place.
 *
 * No "Create Account" button either. Accounts come from invitations -- the
 * `gateAccountCreation` blocking function refuses any other -- so the honest
 * thing is a sentence saying so and a link to `/join`. Asking for a link for
 * an address with no account still sends one, because Firebase does not say
 * whether an address has an account; the refusal comes when the link is
 * opened, and that page explains it.
 *
 * Every link also opens a request for *this* device to be signed in from the
 * one the link is opened on -- usually a phone, where the inbox is. Opened
 * there, the link shows a 6-digit code, and the "Check your inbox" screen
 * takes it. If the request cannot be opened, the link is sent without it:
 * signing in on the device that opens the link must never depend on it.
 */
const SignInForm: React.FC<SignInFormProps> = ({ onSuccess, next }) => {
  const [email, setEmail] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'link' | 'google' | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [deviceRequest, setDeviceRequest] = useState<DeviceSignInRequest | null>(null);
  const [code, setCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [deviceExpired, setDeviceExpired] = useState(false);

  const {
    sendSignInLink,
    signInWithGoogle,
    startDeviceSignIn,
    claimDeviceSignIn,
    signInWithDeviceToken
  } = useAuth();

  const emailValid = EMAIL.test(email.trim());
  const busy = pending !== null;

  /**
   * Open a device request and email a link that carries it. Each send opens a
   * new request and the screen keeps only that one, so only the newest email's
   * code can be typed here.
   * @param address Where to send the link
   */
  const sendLink = async (address: string) => {
    let request: DeviceSignInRequest | null = null;
    try {
      request = await startDeviceSignIn(address);
    } catch (err) {
      console.error('Could not open a request to sign in from another device:', err);
    }
    await sendSignInLink(
      address,
      signInLinkUrl(window.location.origin, { next, device: request?.requestId }),
      rememberMe
    );
    setDeviceRequest(request);
  };

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailValid || busy) return;
    setError(null);
    setPending('link');

    try {
      const address = email.trim();
      await sendLink(address);
      setSentTo(address);
    } catch (err) {
      setError(describeSignInError(err));
    } finally {
      setPending(null);
    }
  };

  /**
   * Trade the code the link showed for a sign-in on this device.
   * @param typed The full code
   */
  const submitCode = async (typed: string) => {
    if (!deviceRequest || claiming || typed.length !== CODE_LENGTH) return;
    setClaiming(true);
    setError(null);

    try {
      const result = await claimDeviceSignIn(deviceRequest, typed);
      if (result.status === 'approved') {
        await signInWithDeviceToken(result.token, rememberMe);
        onSuccess?.();
        return;
      }
      setCode('');
      if (result.status === 'expired') {
        setDeviceExpired(true);
      } else {
        setError('That code is not ready yet. Open the link in the email first — it shows the code.');
      }
    } catch (err) {
      setCode('');
      setError(describeSignInError(err));
      // The last wrong code closes the request; anything else may be retried.
      if (errorCode(err) === 'functions/failed-precondition') setDeviceExpired(true);
    } finally {
      setClaiming(false);
    }
  };

  const handleCodeChange = (typed: string) => {
    setCode(typed);
    if (typed.length === CODE_LENGTH) submitCode(typed);
  };

  const handleGoogle = async () => {
    if (busy) return;
    setError(null);
    setPending('google');

    try {
      await signInWithGoogle(rememberMe);
      onSuccess?.();
    } catch (err) {
      if (!isPopupDismissed(err)) {
        setError(
          describeSignInError(
            err,
            'There is no account for this Google address. Accounts are created from an invitation link — ask someone in your group for one.'
          )
        );
      }
    } finally {
      setPending(null);
    }
  };

  /** Send the link to the same address again, starting the code over. */
  const resendLink = async () => {
    if (!sentTo) return;
    setError(null);
    await sendLink(sentTo);
    setCode('');
    setDeviceExpired(false);
  };

  if (sentTo) {
    return (
      <div className="w-full space-y-4" data-testid="sign-in-link-sent">
        <div
          role="status"
          className="rounded-md border px-3 py-3 feedback-banner feedback-banner-success"
        >
          <Typography className="font-medium">Check your inbox</Typography>
          <Typography variant="body-sm">
            We sent a sign-in link to <strong>{sentTo}</strong>.{' '}
            {deviceRequest
              ? 'Open it on any device — your phone is fine — and type the code it shows here.'
              : 'Open it on this device and you are in — no password needed.'}
          </Typography>
        </div>
        {deviceRequest && (
          <form
            className="card rounded-lg px-4 py-4 space-y-4"
            data-testid="device-sign-in"
            onSubmit={(event) => {
              event.preventDefault();
              submitCode(code);
            }}
          >
            {deviceExpired ? (
              <Typography variant="body-sm" color="secondary">
                This code can no longer be used. Send a new link to try again.
              </Typography>
            ) : (
              <>
                <CodeInput
                  label="Code from the link"
                  value={code}
                  onChange={handleCodeChange}
                  length={CODE_LENGTH}
                />
                <Button
                  type="submit"
                  disabled={claiming || code.length !== CODE_LENGTH}
                  isLoading={claiming}
                  className="w-full min-h-[2.75rem]"
                >
                  {claiming ? 'Signing you in…' : 'Sign in'}
                </Button>
              </>
            )}
          </form>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-md border px-3 py-2 feedback-banner feedback-banner-error"
          >
            <Typography variant="body-sm">{error}</Typography>
          </div>
        )}
        <ResendLink
          onResend={resendLink}
          onChangeAddress={() => {
            setSentTo(null);
            setDeviceRequest(null);
            setCode('');
            setDeviceExpired(false);
            setError(null);
          }}
          sentAgainNote={
            deviceRequest
              ? 'Type the code from the newest email. A code from an earlier one will not work here.'
              : 'Open the newest email on this device.'
          }
        />
        <DevEmailLinkShortcut email={sentTo} />
      </div>
    );
  }

  return (
    <div className="w-full">
      <form onSubmit={handleSendLink} className="space-y-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={busy}
        />

        <div className="flex items-center">
          <input
            type="checkbox"
            id="rememberMe"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className={clsx(
              "h-4 w-4 rounded focus:ring-offset-1",
              `input`,
              `focus:primary card-border`
            )}
            disabled={busy}
          />
          <label
            htmlFor="rememberMe"
            className={clsx(
              "ml-2 block text-sm",
              `typography`
            )}
          >
            Keep me signed in for 30 days
          </label>
        </div>

        {/* Washed ground, hue at the boundary, body ink for the text. Putting
            the hue's own ink on its own wash is the pairing the colour schema
            forbids. */}
        {error && (
          <div
            role="alert"
            className="rounded-md border px-3 py-2 feedback-banner feedback-banner-error"
          >
            <Typography variant="body-sm">{error}</Typography>
          </div>
        )}

        <Button
          type="submit"
          disabled={busy || !emailValid}
          className="w-full min-h-[2.75rem]"
          startIcon={<Mail />}
          isLoading={pending === 'link'}
        >
          {pending === 'link' ? 'Sending link...' : 'Email me a sign-in link'}
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3" aria-hidden="true">
        <div className="flex-1 border-t card-divider" />
        <Typography variant="body-sm" color="muted">or</Typography>
        <div className="flex-1 border-t card-divider" />
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={handleGoogle}
        disabled={busy}
        isLoading={pending === 'google'}
        className="w-full min-h-[2.75rem]"
      >
        Continue with Google
      </Button>

      <div className="mt-6 pt-6 border-t card-divider">
        <Typography className="font-medium mb-1">New to this group?</Typography>
        <Typography variant="body-sm" color="secondary">
          Accounts are created from an invitation. Open the link an admin sent
          you, or{' '}
          <Link to="/join" className="button-link underline">
            paste its token
          </Link>
          .
        </Typography>
      </div>
    </div>
  );
};

export default SignInForm;
