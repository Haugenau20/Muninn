// src/features/user-management/admin/pages/AdminGroupPage.tsx
import React, { useEffect, useState } from 'react';
import { TEXT_LIMITS } from 'core/constants/textLimits';
import { Link } from 'react-router-dom';
import Typography from 'core/components/Typography';
import Button from 'core/components/Button';
import Input from 'core/components/Input';
import Dialog from 'core/components/Dialog';
import { formatDisplayDate } from 'shared/utils/dateFormatter';
import { Check, Copy, Pencil, Plus } from 'lucide-react';
import { useGroups } from '../../groups/hooks/useGroups';
import { useAdminOutlet } from './admin-outlet';
import { memberId } from '../types';
import LeaveGroupDialog from '../../profiles/components/LeaveGroupDialog';
import DeleteGroupDialog from '../components/DeleteGroupDialog';

/**
 * `/admin/group` -- what this group is, and the ways out of it: leaving it,
 * or deleting it for everyone.
 *
 * The closing note that told the reader to use the "Users" and "Registration
 * Tokens" tabs is gone, and nothing replaces it. The navigation is three links
 * at the top of the page now; a workspace that has to explain its own tabs was
 * a workspace in the wrong container, which is the argument this whole phase
 * rests on.
 */
const AdminGroupPage: React.FC = () => {
  const { groups, activeGroupId, activeGroup, activeGroupUserProfile, createGroup, updateGroup } = useGroups();
  const { members } = useAdminOutlet();

  const [copied, setCopied] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // The founder's name in the new group, starting from their name in this one.
  const [founderName, setFounderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const group = groups.find((candidate) => candidate.id === activeGroupId) ?? activeGroup;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopyId = async () => {
    if (!group) return;
    try {
      await navigator.clipboard.writeText(group.id);
      setCopied(true);
    } catch (err) {
      console.error('Failed to copy the group id:', err);
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !founderName.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createGroup({
        name: name.trim(),
        description: description.trim(),
        username: founderName.trim(),
      });
      setName('');
      setDescription('');
      setCreateOpen(false);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create the group'
      );
    } finally {
      setCreating(false);
    }
  };

  /** Opens the edit dialog on the group as it stands now, not a stale draft. */
  const openEdit = () => {
    if (!group) return;
    setEditName(group.name);
    setEditDescription(group.description ?? '');
    setEditError(null);
    setEditOpen(true);
  };

  const handleEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editName.trim() || saving) return;
    setSaving(true);
    setEditError(null);
    try {
      await updateGroup(editName.trim(), editDescription.trim());
      setEditOpen(false);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : 'Failed to save the group'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!group) {
    return (
      <div className="max-w-3xl mx-auto px-4 pb-10">
        <Typography color="secondary">No group selected.</Typography>
      </div>
    );
  }

  /**
   * Who created the group, as a historical fact.
   *
   * Named carefully: this is *history*, not authority. An admin is any member
   * holding the role and there may be several, so nothing here says "owner",
   * and nothing anywhere says "the admin" in the singular.
   */
  const creator = members.find((member) => memberId(member) === group.createdBy);
  const createdByLabel = creator?.username ?? 'someone no longer in the group';

  /**
   * Whether leaving would strip the group of its last admin (T035).
   *
   * The `removeUserFromGroup` Cloud Function refuses it, so this is not the
   * guard -- the profile page's Leave control is a second door onto the same
   * call, and the server answers both. What this page adds is the way out:
   * promote someone on People, then leave. Offering a button the server will
   * refuse, and explaining why only afterwards, would be the wrong order.
   *
   * Nobody else in the group is the exception: there is nobody to hand it to,
   * and the function lets the last person out.
   */
  const adminCount = members.filter(
    (member) => member.role?.toLowerCase() === 'admin'
  ).length;
  const mustPromoteFirst = adminCount === 1 && members.length > 1;

  return (
    <div className="max-w-3xl mx-auto px-4 pb-10 space-y-4">
      <section className="card rounded-lg" aria-labelledby="group-heading">
        <div className="px-4 sm:px-6 py-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Typography
                variant="h2"
                id="group-heading"
                className="font-heading text-2xl break-words"
              >
                {group.name}
              </Typography>
              {group.description && (
                <Typography color="secondary" className="mt-1">
                  {group.description}
                </Typography>
              )}
            </div>
            {/* The name and description are the only two things about a group
                anyone may change -- who made it, and when, are history. The
                control this page once removed had no `onClick` at all; this
                one is backed by `GroupService.updateGroup` (T036). */}
            <Button
              variant="ghost"
              size="sm"
              onClick={openEdit}
              startIcon={<Pencil size={16} />}
              className="min-h-[2.75rem] flex-shrink-0"
            >
              Edit
            </Button>
          </div>

          {/* Facts about the group, in sans, as metadata rather than fields. */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t card-divider">
            <div>
              <Typography variant="caption" color="muted" className="uppercase tracking-wide">
                Created by
              </Typography>
              <dd>
                <Typography>{createdByLabel}</Typography>
              </dd>
            </div>
            <div>
              <Typography variant="caption" color="muted" className="uppercase tracking-wide">
                Created
              </Typography>
              <dd>
                <Typography>
                  {formatDisplayDate(group.createdAt, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </Typography>
              </dd>
            </div>
          </dl>

          {/* Nobody types this from memory, so it is a value to copy rather
              than a field to read. */}
          <div className="pt-2 border-t card-divider">
            <Typography variant="caption" color="muted" className="uppercase tracking-wide">
              Group ID
            </Typography>
            <div className="mt-1 flex items-center gap-2 rounded-md p-2 card-subtle card-border">
              <code className="font-mono text-xs break-all min-w-0 flex-1">
                {group.id}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyId}
                startIcon={copied ? <Check size={16} /> : <Copy size={16} />}
                className="min-h-[2.75rem]"
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Out of the header, deliberately. Creating a *different* group is not
          an administrative task of this one, and a primary button top-right
          beside this group's own identity invites exactly the wrong click. */}
      <div className="px-1">
        <Button
          variant="ghost"
          onClick={() => {
            setFounderName(activeGroupUserProfile?.username ?? '');
            setCreateOpen(true);
          }}
          startIcon={<Plus className="w-4 h-4" />}
          className="min-h-[2.75rem]"
        >
          Create a different group
        </Button>
      </div>

      {/* Separated by more space than anything else on the page, and last, so a
          scrolling thumb does not reach it first. A heading, spacing and a
          hairline carry the weight; the fill is spent on the confirm button
          inside the dialog, and red appears nowhere else. */}
      <section
        className="card rounded-lg mt-12"
        aria-labelledby="danger-heading"
      >
        <div className="px-4 sm:px-6 py-5">
          <Typography
            variant="h3"
            id="danger-heading"
            className="font-heading text-lg mb-1"
          >
            Leaving
          </Typography>
          <Typography color="secondary" variant="body-sm" className="mb-4">
            You lose access to {group.name} and everything recorded in it. What
            you have written stays for the others.
          </Typography>

          {mustPromoteFirst && (
            <div className="rounded-md border px-3 py-2 mb-4 feedback-banner feedback-banner-warning">
              <Typography variant="body-sm">
                You are the only admin. Before you leave,{' '}
                <Link to="/admin/people" className="underline">
                  make another member an admin
                </Link>{' '}
                so someone can still invite members and manage campaigns in{' '}
                {group.name}.
              </Typography>
            </div>
          )}
          <Button
            variant="ghost"
            onClick={() => setLeaveOpen(true)}
            disabled={mustPromoteFirst}
            className="delete-button min-h-[2.75rem]"
          >
            Leave {group.name}
          </Button>
        </div>
      </section>

      {/* T037. Last of all, below leaving: it ends the group for everyone,
          where leaving ends it only for you. */}
      <section
        className="card rounded-lg"
        aria-labelledby="delete-group-heading"
      >
        <div className="px-4 sm:px-6 py-5">
          <Typography
            variant="h3"
            id="delete-group-heading"
            className="font-heading text-lg mb-1"
          >
            Deleting the group
          </Typography>
          <Typography color="secondary" variant="body-sm" className="mb-4">
            Deletes {group.name} for every member, with every campaign and note
            in it. Members keep their accounts.
          </Typography>
          <Button
            variant="ghost"
            onClick={() => setDeleteOpen(true)}
            className="delete-button min-h-[2.75rem]"
          >
            Delete {group.name}
          </Button>
        </div>
      </section>

      <LeaveGroupDialog open={leaveOpen} onClose={() => setLeaveOpen(false)} />
      <DeleteGroupDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} />

      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit ${group.name}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleEdit} className="space-y-4">
          <Typography color="secondary" variant="body-sm">
            Everyone in the group sees the new name straight away.
          </Typography>

          <Input
            label="Name"
            value={editName}
            maxLength={TEXT_LIMITS.line}
            onChange={(event) => setEditName(event.target.value)}
            required
            disabled={saving}
          />

          <Input
            label="Description (optional)"
            value={editDescription}
            maxLength={TEXT_LIMITS.text}
            onChange={(event) => setEditDescription(event.target.value)}
            disabled={saving}
            isTextArea={true}
            rows={3}
          />

          {editError && (
            <div
              role="alert"
              className="rounded-md border px-3 py-2 feedback-banner feedback-banner-error"
            >
              <Typography variant="body-sm">{editError}</Typography>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditOpen(false)}
              disabled={saving}
              className="min-h-[2.75rem]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!editName.trim() || saving}
              isLoading={saving}
              className="min-h-[2.75rem]"
            >
              Save
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a different group"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <Typography color="secondary" variant="body-sm">
            A group is a table of players. You will be its first admin, and
            {' '}{group.name} is unaffected.
          </Typography>

          <Input
            label="Name"
            value={name}
            maxLength={TEXT_LIMITS.line}
            onChange={(event) => setName(event.target.value)}
            required
            disabled={creating}
            placeholder="Thursday Night Table"
          />

          <Input
            label="Description (optional)"
            value={description}
            maxLength={TEXT_LIMITS.text}
            onChange={(event) => setDescription(event.target.value)}
            disabled={creating}
            isTextArea={true}
            rows={3}
          />

          <Input
            label="Your name in the new group"
            value={founderName}
            minLength={3}
            maxLength={20}
            onChange={(event) => setFounderName(event.target.value)}
            required
            disabled={creating}
            helperText="3–20 characters. The other members will see it on everything you write there."
          />

          {createError && (
            <div
              role="alert"
              className="rounded-md border px-3 py-2 feedback-banner feedback-banner-error"
            >
              <Typography variant="body-sm">{createError}</Typography>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
              className="min-h-[2.75rem]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || creating}
              isLoading={creating}
              className="min-h-[2.75rem]"
            >
              Create group
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};

export default AdminGroupPage;
