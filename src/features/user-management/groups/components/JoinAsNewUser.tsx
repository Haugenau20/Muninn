// src/features/user-management/groups/components/JoinAsNewUser.tsx
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
import { useUsernameCheck } from '../hooks/useUsernameCheck';
import { useInvitations } from '../hooks/useInvitations';

/** Props for {@link JoinAsNewUser}. */
export interface JoinAsNewUserProps {
  token: string;
  /** The invitation's group, from the invite link. */
  groupId: string;
  onJoined: () => Promise<void> | void;
  /**
   * Told when a Google sign-in starts and ends. The page swaps this form for
   * the signed-in one as soon as somebody is signed in -- which a Google
   * sign-in does halfway through this form's own work -- so it has to know to
   * keep this form mounted until that work is finished.
   */
  onBusyChange?: (busy: boolean) => void;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Creating an account from an invitation. Passwordless: a magic link by
 * email, or Google.
 *
 * A **step on this page**, not a form swapped in where another one was. The
 * order is the order of the sentence the page is telling: the invitation is
 * confirmed above, then your name in this group, then the account itself.
 *
 * The name comes before the email deliberately. It is the field people get
 * wrong -- it is not an account name, it is what the rest of the table will see
 * beside everything you write -- so it is asked first, while attention is on
 * the group rather than on credentials.
 *
 * **The email is asked for even on the Google path.** Accounts are
 * invite-only, and the check happens in a blocking function that sees nothing
 * but the account about to be created. So the invitation is first claimed for
 * an address (`reserveSignUp`), and only an account with that address may be
 * created. The address is passed to Google as the one to pre-select.
 */
const JoinAsNewUser: React.FC<JoinAsNewUserProps> = ({ token, groupId, onJoined, onBusyChange }) => {
  const { reserveSignUp, joinGroupWithToken } = useInvitations();
  const { sendSignInLink, signInWithGoogle, deleteFreshAccount, reloadUserContext } = useAuth();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<'link' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // The address the invitation is currently reserved for, so a second press
  // of the Google button (after a blocked popup, say) does not reserve again.
  const [reservedFor, setReservedFor] = useState<string | null>(null);

  const nameCheck = useUsernameCheck(username);

  const address = email.trim();
  const emailValid = EMAIL.test(address);
  const canSubmit = nameCheck.ready && emailValid && pending === null;

  const reserve = async () => {
    if (reservedFor === address.toLowerCase()) return;
    await reserveSignUp(token, address);
    setReservedFor(address.toLowerCase());
  };

  /**
   * Email the link that carries the invitation.
   * @param to Where to send it
   */
  const sendLink = (to: string) =>
    sendSignInLink(
      to,
      signInLinkUrl(window.location.origin, {
        invitation: { groupId, token, username: username.trim() }
      })
    );

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
    onBusyChange?.(true);
    try {
      try {
        await reserve();
      } catch (err) {
        setError(describeSignInError(err));
        return;
      }

      let isNewUser: boolean;
      try {
        ({ isNewUser } = await signInWithGoogle(false, address));
      } catch (err) {
        if (!isPopupDismissed(err)) {
          setError(
            describeSignInError(
              err,
              `The Google account you picked is not ${address}. Pick that account, or change the email above to the one you want to use.`
            )
          );
        }
        return;
      }

      try {
        await joinGroupWithToken(token, username.trim());
      } catch (err) {
        if (isNewUser) {
          try {
            await deleteFreshAccount();
          } catch (deleteError) {
            console.error('Error cleaning up an account whose invitation failed:', deleteError);
          }
          setReservedFor(null);
        }
        setError(err instanceof Error ? err.message : 'Could not join the group');
        return;
      }

      await reloadUserContext();
      await onJoined();
    } finally {
      setPending(null);
      onBusyChange?.(false);
    }
  };

  /**
   * Send the link again. The address is reserved again first, unconditionally:
   * that renews the reservation the new link will need, and says so here if
   * the invitation has been spent or has expired since the first send.
   */
  const resendLink = async () => {
    if (!sentTo) return;
    await reserveSignUp(token, sentTo);
    setReservedFor(sentTo.toLowerCase());
    await sendLink(sentTo);
  };

  if (sentTo) {
    return (
      <div className="card rounded-lg px-6 py-6 space-y-4" data-testid="join-link-sent">
        <div
          role="status"
          className="rounded-md border px-3 py-3 feedback-banner feedback-banner-success"
        >
          <Typography className="font-medium">Check your inbox</Typography>
          <Typography variant="body-sm">
            We sent a link to <strong>{sentTo}</strong>. Opening it signs you
            in — creating your account if this address does not have one yet —
            and joins you to the group as <strong>{username.trim()}</strong>.
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
          Create your account
        </Typography>
        <Typography color="secondary" variant="body-sm">
          You only need one. It carries across every group you are invited to.
          There is no password — you sign in with a link we email you, or with
          Google.
        </Typography>
      </div>

      <Input
        label="Your name in this group"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        required
        disabled={pending !== null}
        helperText="3–20 characters. Other members see this name on everything you write. It is not an account name."
        error={nameCheck.error ?? undefined}
        successMessage={nameCheck.ready ? 'That name is free' : undefined}
      />

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
        Email me a link to join
      </Button>

      <Button
        type="button"
        variant="outline"
        onClick={handleGoogle}
        disabled={!canSubmit}
        isLoading={pending === 'google'}
        className="w-full min-h-[2.75rem]"
      >
        Join with Google
      </Button>

      <Typography variant="body-sm" color="secondary">
        Already have an account?{' '}
        <Link to="/signin" className="button-link underline">
          Sign in first
        </Link>{' '}
        and the invitation will still be here.
      </Typography>
    </form>
  );
};

export default JoinAsNewUser;
