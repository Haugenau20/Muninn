// src/features/user-management/groups/pages/JoinPage.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Typography from 'core/components/Typography';
import { Check } from 'lucide-react';
import { useAuth } from '../../auth/hooks/useAuth';
import { useGroups } from '../hooks/useGroups';
import { useInvitations } from '../hooks/useInvitations';
import { useJoinGroupCompletion } from '../hooks/useJoinGroupCompletion';
import { CAMPAIGN_HOME } from '../../auth/utils/next-path';
import JoinAsExistingUser from '../components/JoinAsExistingUser';
import JoinAsNewUser from '../components/JoinAsNewUser';
import JoinTokenPrompt from '../components/JoinTokenPrompt';
import StartGroup from '../components/StartGroup';
import { FOUNDER_PARAM } from '../utils/founder-link';

/** Where the page is, which decides what it renders. */
type TokenState = 'absent' | 'checking' | 'valid' | 'rejected';

/**
 * `/join` -- the invitation, as a page.
 *
 * An invite link is a link, and until this phase it landed nowhere: the token
 * was read from the query by a dialog that only opened if something else
 * opened it. The route is the destination the link always implied.
 *
 * Two things this page does that the dialog could not:
 *
 * - **A token that arrived by link is stated, not re-entered.** Presenting a
 *   pre-filled text field asks the reader to check a value they cannot verify
 *   and must not edit. The paste field appears only when there is no `token`
 *   in the query -- the "I have an invite" path.
 * - **A bad link is a page state, not a red line under a field.** The link is
 *   the problem and the next step is asking whoever sent it; there is nothing
 *   to retype.
 *
 * A **founder link** (`/join?founder=…`, T127) is an invitation to start a
 * group rather than join one, and gets its own flow (`StartGroup`).
 */
const JoinPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { activeGroupUserProfile } = useGroups();
  const { validateToken } = useInvitations();
  const completeJoin = useJoinGroupCompletion();

  const linkToken = searchParams.get('token');
  // Present, even empty, on a founder link or on the page that asks for one.
  const founderToken = searchParams.get(FOUNDER_PARAM);
  const groupId = searchParams.get('groupId') ?? '';
  // True while the new-account form is mid-way through a Google sign-in; see
  // `JoinAsNewUserProps.onBusyChange`.
  const [signingUp, setSigningUp] = useState(false);
  const [token, setToken] = useState(linkToken ?? '');
  const [state, setState] = useState<TokenState>(linkToken ? 'checking' : 'absent');

  useEffect(() => {
    setToken(linkToken ?? '');
    setState(linkToken ? 'checking' : 'absent');
  }, [linkToken]);

  const check = useCallback(
    async (candidate: string) => {
      if (!candidate) {
        setState('absent');
        return;
      }
      setState('checking');
      try {
        setState((await validateToken(candidate)) ? 'valid' : 'rejected');
      } catch {
        setState('rejected');
      }
    },
    [validateToken]
  );

  useEffect(() => {
    if (linkToken) check(linkToken);
  }, [linkToken, check]);

  const handleJoined = async () => {
    await completeJoin();
    navigate(CAMPAIGN_HOME, { replace: true });
  };

  const band = (
    <div className="-mx-4 -mt-4 py-8 sm:py-10 hero-band">
      <div className="px-4">
        <div className="max-w-xl mx-auto">
          <Typography
            variant="body-sm"
            className="hero-eyebrow text-[11px] font-semibold uppercase tracking-wider"
          >
            You have been invited to join
          </Typography>
          {/* The group is deliberately not named here. A `groups/{id}` read
              requires `isGroupMember`, and the person reading this page is by
              definition not a member yet -- so naming it would mean either a
              failed read or opening group documents to the world. The
              invitation is confirmed instead, which is the fact that actually
              matters to the reader. */}
          <Typography variant="h1" className="mt-2 text-3xl sm:text-4xl">
            A campaign in Muninn
          </Typography>
        </div>
      </div>
    </div>
  );

  if (founderToken !== null) {
    return <StartGroup founderToken={founderToken.trim()} />;
  }

  return (
    <>
      {band}
      <div className="max-w-xl mx-auto px-4 py-8">
        {state === 'checking' && (
          <div role="status" aria-busy="true">
            <span className="sr-only">Checking your invitation</span>
            <div className="h-24 rounded animate-pulse bg-secondary" aria-hidden="true" />
          </div>
        )}

        {/* A page state. The link is what is wrong, and no amount of retyping
            fixes it -- the next step is a conversation. */}
        {state === 'rejected' && (
          <div className="card rounded-lg px-6 py-8">
            <Typography variant="h2" className="font-heading text-xl mb-2">
              This invitation cannot be used
            </Typography>
            <Typography color="secondary">
              The link is invalid, has expired, or somebody has already used it.
              Each invitation works once. Ask whoever sent it for a fresh link.
            </Typography>
          </div>
        )}

        {state === 'absent' && (
          <JoinTokenPrompt
            token={token}
            onTokenChange={setToken}
            onSubmit={() => check(token)}
          />
        )}

        {state === 'valid' && (
          <div className="space-y-6">
            <div
              className="flex items-center gap-2 rounded-md border px-3 py-2 feedback-banner feedback-banner-success"
              data-testid="invitation-confirmed"
            >
              <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
              <Typography variant="body-sm">
                {linkToken
                  ? 'Invitation accepted from the link — nothing to paste.'
                  : 'Invitation accepted.'}
              </Typography>
            </div>

            {authLoading && !signingUp ? (
              <div role="status" aria-busy="true">
                <span className="sr-only">Loading</span>
                <div className="h-24 rounded animate-pulse bg-secondary" aria-hidden="true" />
              </div>
            ) : user && !signingUp ? (
              /* Already signed in: told so, and offered the join. Showing a
                 registration form to somebody who already has an account is
                 what the dialog did. */
              <JoinAsExistingUser
                token={token}
                username={activeGroupUserProfile?.username}
                onJoined={handleJoined}
              />
            ) : (
              <JoinAsNewUser
                token={token}
                groupId={groupId}
                onJoined={handleJoined}
                onBusyChange={setSigningUp}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default JoinPage;
