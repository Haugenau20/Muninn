// src/features/user-management/admin/pages/AdminPeoplePage.tsx
import React, { useCallback, useEffect, useState } from 'react';
import Typography from 'core/components/Typography';
import Button from 'core/components/Button';
import Dialog from 'core/components/Dialog';
import DeleteConfirmationDialog from 'shared/components/DeleteConfirmationDialog';
import { useGroups } from '../../groups/hooks/useGroups';
import { useInvitations } from '../../groups/hooks/useInvitations';
import MembersCard from '../components/MembersCard';
import PendingInvitationsCard from '../components/PendingInvitationsCard';
import InviteLinkDialog from '../components/InviteLinkDialog';
import { buildInviteLink } from '../utils/invite-link';
import { REGISTRATION_TOKEN_LIFETIME_MS } from 'core/utils/registration-token';
import { useAdminOutlet } from './admin-outlet';
import { memberId, type GroupMember, type RegistrationToken } from '../types';

/**
 * `/admin/people` -- membership and invitation, which are one job.
 *
 * Four tabs became three views because the fourth was mostly a redirect, and
 * two of the remaining tables were the same people told twice. What is left is
 * the model in two cards: who is in the group, and who has been asked but has
 * not answered. An accepted invitation moves from the second list to the first,
 * and that is the whole of it.
 *
 * Members come from the route's band, which has already fetched them to count
 * them; fetching the same collection twice on one screen would be the
 * duplication this page exists to remove.
 */
const AdminPeoplePage: React.FC = () => {
  const { user, activeGroup, activeGroupId, deleteUser, setMemberRole } = useGroups();
  const {
    generateRegistrationToken,
    getRegistrationTokens,
    revealRegistrationToken,
    deleteRegistrationToken,
    updateRegistrationTokenNotes,
  } = useInvitations();
  const { members, membersLoading, membersError, reloadMembers } =
    useAdminOutlet();

  const [invitations, setInvitations] = useState<RegistrationToken[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const [inviteDialog, setInviteDialog] = useState<{
    open: boolean;
    link: string;
    note?: string;
    expiresAt?: RegistrationToken['expiresAt'];
  }>({ open: false, link: '' });

  const [pendingRemoval, setPendingRemoval] = useState<GroupMember | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<GroupMember | null>(null);
  const [changingRole, setChangingRole] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<RegistrationToken | null>(
    null
  );

  const loadInvitations = useCallback(async () => {
    if (!activeGroupId) return;
    setInvitationsLoading(true);
    try {
      const all = (await getRegistrationTokens()) as RegistrationToken[];
      // Used tokens are dropped here and nowhere else, so no view downstream
      // has to remember to filter them.
      setInvitations(all.filter((invitation) => !invitation.used));
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load invitations'
      );
    } finally {
      setInvitationsLoading(false);
    }
  }, [activeGroupId, getRegistrationTokens]);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations]);

  /**
   * One click, one link.
   *
   * No note field in front of the action: the note was a form standing between
   * an admin and the only thing they came here for, and it is optional.
   */
  const handleInvite = async () => {
    setError(null);
    setInviting(true);
    try {
      const token = await generateRegistrationToken('');
      setInviteDialog({
        open: true,
        link: buildInviteLink(window.location.origin, token, activeGroupId),
        // The service stamps the same lifetime from its own clock a moment
        // earlier. The sentence names only a day, so the two can disagree
        // only if that moment straddles midnight -- and then by one day.
        expiresAt: new Date(Date.now() + REGISTRATION_TOKEN_LIFETIME_MS),
      });
      await loadInvitations();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to create an invitation'
      );
    } finally {
      setInviting(false);
    }
  };

  /**
   * Show an open invitation's link again.
   *
   * The list holds only each invitation's id, its token's hash (T145), from
   * which no link can be built; the token comes from the server, which keeps
   * a sealed copy for the group's admins.
   */
  const handleCopyLink = async (invitation: RegistrationToken) => {
    setError(null);
    try {
      const token = await revealRegistrationToken(invitation.id);
      setInviteDialog({
        open: true,
        link: buildInviteLink(window.location.origin, token, activeGroupId),
        note: invitation.notes,
        expiresAt: invitation.expiresAt,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to copy the invitation'
      );
    }
  };

  /**
   * Name an invitation after the fact.
   *
   * The row updates locally rather than re-reading the collection: the write
   * touches one field this page already holds, and a refetch would cost a
   * round trip to learn what it just sent.
   */
  const handleRenameNote = async (
    invitation: RegistrationToken,
    notes: string
  ) => {
    setError(null);
    try {
      await updateRegistrationTokenNotes(invitation.id, notes);
      setInvitations((previous) =>
        previous.map((item) =>
          item.id === invitation.id ? { ...item, notes } : item
        )
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save the invitation note'
      );
    }
  };

  const handleConfirmRevoke = async () => {
    if (!pendingRevoke) return;
    setError(null);
    try {
      await deleteRegistrationToken(pendingRevoke.id);
      setInvitations((previous) =>
        previous.filter((item) => item.id !== pendingRevoke.id)
      );
      setPendingRevoke(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to revoke the invitation'
      );
    }
  };

  const handleConfirmRemoval = async () => {
    const id = pendingRemoval ? memberId(pendingRemoval) : undefined;
    if (!id) return;
    setError(null);
    try {
      await deleteUser(id);
      setPendingRemoval(null);
      await reloadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  const applyRole = async (member: GroupMember, role: 'admin' | 'member') => {
    const id = memberId(member);
    if (!id) return;
    setError(null);
    setChangingRole(true);
    try {
      await setMemberRole(id, role);
      setPendingPromotion(null);
      await reloadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change the role');
      setPendingPromotion(null);
    } finally {
      setChangingRole(false);
    }
  };

  /**
   * Promotion asks first; demotion does not.
   *
   * Making someone an admin hands them everything this page does -- including
   * making you a member -- and nothing on screen would undo it if they chose
   * to. Making an admin a member is reversible by you, here, at once.
   */
  const handleChangeRole = (member: GroupMember, role: 'admin' | 'member') => {
    if (role === 'admin') {
      setPendingPromotion(member);
    } else {
      applyRole(member, role);
    }
  };

  const groupName = activeGroup?.name ?? 'this group';
  const shownError = error ?? membersError;

  return (
    <div className="max-w-7xl mx-auto px-4 pb-10 space-y-4">
      {/* On a page the banner has somewhere to live, so it lives at the top of
          the view rather than being lost off the end of a scrolling dialog
          (#201). Washed ground, body ink -- never the hue on its own wash. */}
      {shownError && (
        <div
          role="alert"
          className="rounded-md border px-4 py-3 feedback-banner feedback-banner-error"
        >
          <Typography>{shownError}</Typography>
        </div>
      )}

      <MembersCard
        members={members}
        currentUserId={user?.uid}
        loading={membersLoading}
        inviting={inviting}
        onInvite={handleInvite}
        onRemove={setPendingRemoval}
        onChangeRole={handleChangeRole}
      />

      <PendingInvitationsCard
        invitations={invitations}
        loading={invitationsLoading}
        onCopyLink={handleCopyLink}
        onRevoke={setPendingRevoke}
        onRenameNote={handleRenameNote}
      />

      <InviteLinkDialog
        open={inviteDialog.open}
        onClose={() => setInviteDialog({ open: false, link: '' })}
        link={inviteDialog.link}
        groupName={groupName}
        note={inviteDialog.note}
        expiresAt={inviteDialog.expiresAt}
      />

      {/* Both destructive confirms go through the shared dialog rather than a
          bespoke one, so 14-5's sweep -- naming the verb on the button instead
          of "Delete" -- fixes one component and both of these inherit it. The
          blast radius is stated here, which is the part that is this page's to
          know. */}
      <DeleteConfirmationDialog
        isOpen={!!pendingRemoval}
        onClose={() => setPendingRemoval(null)}
        onConfirm={handleConfirmRemoval}
        itemType="member"
        itemName={pendingRemoval?.username ?? ''}
        message={`Remove ${pendingRemoval?.username ?? 'this member'} from ${groupName}? They lose access to the group and everything recorded in it; what they have already written stays. This cannot be undone.`}
      />

      <Dialog
        open={!!pendingPromotion}
        onClose={() => setPendingPromotion(null)}
        title={`Make ${pendingPromotion?.username ?? 'this member'} an admin?`}
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <Typography color="secondary">
            They will be able to invite and remove members, manage campaigns
            and change anyone&apos;s role in {groupName} — including yours.
          </Typography>
          <div className="flex justify-end gap-4">
            <Button
              variant="ghost"
              onClick={() => setPendingPromotion(null)}
              disabled={changingRole}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => pendingPromotion && applyRole(pendingPromotion, 'admin')}
              isLoading={changingRole}
              className="min-h-[2.75rem]"
            >
              Make admin
            </Button>
          </div>
        </div>
      </Dialog>

      <DeleteConfirmationDialog
        isOpen={!!pendingRevoke}
        onClose={() => setPendingRevoke(null)}
        onConfirm={handleConfirmRevoke}
        itemType="invitation"
        itemName={pendingRevoke?.notes ?? 'this invitation'}
        message={`Revoke this invitation? The link stops working immediately, so anyone who still has it cannot join ${groupName}. This cannot be undone.`}
      />
    </div>
  );
};

export default AdminPeoplePage;
