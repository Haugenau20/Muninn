// src/features/user-management/groups/components/FounderSignUp.tsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import Typography from 'core/components/Typography';
import Input from 'core/components/Input';
import Button from 'core/components/Button';
import {
  describeSignInError,
  isPopupDismissed
} from 'core/services/firebase/auth/signInErrors';
import { useAuth } from '../../auth/hooks/useAuth';
import { signInLinkUrl } from '../../auth/utils/email-link';
import DevEmailLinkShortcut from '../../auth/components/DevEmailLinkShortcut';
import ResendLink from '../../auth/components/ResendLink';
import { useInvitations } from '../hooks/useInvitations';

/** Props for {@link FounderSignUp}. */
export interface FounderSignUpProps {
  /** The founder link's token. */
  founderToken: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The account step of a founder link (T127): an email, then a magic link or
 * Google, as on an invitation into a group.
 *
 * The address is reserved first (`reserveSignUp` with the founder token),
 * because accounts are invite-only and the blocking function that creates them
 * admits only a reserved address. That call is also where a spent or expired
 * link is first refused: founder invitations are server-only, so nothing could
 * check the link sooner.
 *
 * Signing in spends nothing. The link page asks for the group next, and only
 * naming it spends the link, so a founder who stops here can come back to the
 * same link. Unlike an invitation, nothing here can fail after the account
 * exists, so a fresh account is never deleted again.
 *
 * Someone who already has an account can use this form too: signing in with
 * that address creates nothing.
 */
const FounderSignUp: React.FC<FounderSignUpProps> = ({ founderToken }) => {
  const { reserveFounderSignUp } = useInvitations();
  const { sendSignInLink, signInWithGoogle } = useAuth();

  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<'link' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // The address the link is reserved for, so a second press of the Google
  // button (after a blocked popup, say) does not reserve again.
  const [reservedFor, setReservedFor] = useState<string | null>(null);

  const address = email.trim();
  const emailValid = EMAIL.test(address);
  const canSubmit = emailValid && pending === null;

  const reserve = async () => {
    if (reservedFor === address.toLowerCase()) return;
    await reserveFounderSignUp(founderToken, address);
    setReservedFor(address.toLowerCase());
  };

  /**
   * Email the link that carries the founder token.
   * @param to Where to send it
   */
  const sendLink = (to: string) =>
    sendSignInLink(to, signInLinkUrl(window.location.origin, { founder: founderToken }));

  const handleSendLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setPending('link');
    setError(null);
    try {
      await reserve();
      await sendLink(address);
      setSentTo(address);
    } catch (err) {
      setError(describeSignInError(err));
    } finally {
      setPending(null);
    }
  };

  const handleGoogle = async () => {
    if (!canSubmit) return;
    setPending('google');
    setError(null);
    try {
      await reserve();
      await signInWithGoogle(false, address);
      // Signed in: the page moves on to naming the group by itself.
    } catch (err) {
      if (!isPopupDismissed(err)) {
        setError(
          describeSignInError(
            err,
            `The Google account you picked is not ${address}. Pick that account, or change the email above to the one you want to use.`
          )
        );
      }
    } finally {
      setPending(null);
    }
  };

  /**
   * Send the link again. The address is reserved again first, unconditionally:
   * that renews the reservation the new link will need, and says so here if
   * the founder link has been used or has expired since the first send.
   */
  const resendLink = async () => {
    if (!sentTo) return;
    await reserveFounderSignUp(founderToken, sentTo);
    setReservedFor(sentTo.toLowerCase());
    await sendLink(sentTo);
  };

  if (sentTo) {
    return (
      <div className="card rounded-lg px-6 py-6 space-y-4" data-testid="founder-link-sent">
        <div
          role="status"
          className="rounded-md border px-3 py-3 feedback-banner feedback-banner-success"
        >
          <Typography className="font-medium">Check your inbox</Typography>
          <Typography variant="body-sm">
            We sent a link to <strong>{sentTo}</strong>. Opening it signs you
            in — creating your account if this address does not have one yet —
            and brings you back here to name your group.
          </Typography>
        </div>
        <ResendLink
          onResend={resendLink}
          onChangeAddress={() => setSentTo(null)}
          sentAgainNote="Open the newest email."
        />
        <DevEmailLinkShortcut email={sentTo} />
      </div>
    );
  }

  return (
    <form onSubmit={handleSendLink} className="card rounded-lg px-6 py-6 space-y-4">
      <div>
        <Typography variant="h2" className="font-heading text-xl mb-1">
          First, your account
        </Typography>
        <Typography color="secondary" variant="body-sm">
          You only need one. It carries across every group you start or join.
          There is no password — you sign in with a link we email you, or with
          Google. Then you name your group.
        </Typography>
      </div>

      <Input
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
        disabled={pending !== null}
        helperText="Using Google? Enter your Google address."
        error={email && !emailValid ? 'Enter a valid email address' : undefined}
      />

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
        disabled={!canSubmit}
        isLoading={pending === 'link'}
        startIcon={<Mail />}
        className="w-full min-h-[2.75rem]"
      >
        Email me a sign-in link
      </Button>

      <Button
        type="button"
        variant="outline"
        onClick={handleGoogle}
        disabled={!canSubmit}
        isLoading={pending === 'google'}
        className="w-full min-h-[2.75rem]"
      >
        Continue with Google
      </Button>

      <Typography variant="body-sm" color="secondary">
        Already have an account? Enter its address above, or{' '}
        <Link to="/signin" className="button-link underline">
          sign in
        </Link>{' '}
        first and open your link again.
      </Typography>
    </form>
  );
};

export default FounderSignUp;
