// src/features/user-management/admin/components/CampaignFormDialog.tsx
import React, { useEffect, useState } from 'react';
import { TEXT_LIMITS } from 'core/constants/textLimits';
import Dialog from 'core/components/Dialog';
import Input from 'core/components/Input';
import Button from 'core/components/Button';
import Typography from 'core/components/Typography';

/** Props for {@link CampaignFormDialog}. */
export interface CampaignFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Absent when creating; the campaign's current values when editing. */
  initial?: { name: string; description: string };
  onSubmit: (values: { name: string; description: string }) => Promise<void>;
}

/**
 * Create or edit a campaign.
 *
 * One dialog for both, because they are the same two fields and the same
 * decision -- "what is this campaign called". The title and the verb change;
 * nothing else does.
 *
 * The error renders *inside* the dialog. A shared error state one level up
 * would put the message behind the modal the reader is looking at, which is
 * bug #201 exactly; the view this replaced had already learned that and kept
 * dialog-scoped state for the same reason.
 */
const CampaignFormDialog: React.FC<CampaignFormDialogProps> = ({
  open,
  onClose,
  initial,
  onSubmit,
}) => {
  const editing = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset whenever the dialog is opened, so a cancelled edit does not leak
  // into the next one.
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setDescription(initial?.description ?? '');
    setError(null);
  }, [open, initial?.name, initial?.description]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), description: description.trim() });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Failed to ${editing ? 'save' : 'create'} the campaign`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? 'Rename campaign' : 'New campaign'}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Name"
          value={name}
          maxLength={TEXT_LIMITS.line}
          onChange={(event) => setName(event.target.value)}
          required
          disabled={saving}
          placeholder="The Ashen Vale"
        />

        <Input
          label="Description (optional)"
          value={description}
          maxLength={TEXT_LIMITS.text}
          onChange={(event) => setDescription(event.target.value)}
          disabled={saving}
          placeholder="One line about what this campaign is"
          isTextArea={true}
          rows={3}
        />

        {error && (
          <div
            role="alert"
            className="rounded-md border px-3 py-2 feedback-banner feedback-banner-error"
          >
            <Typography variant="body-sm">{error}</Typography>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
            className="min-h-[2.75rem]"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!name.trim() || saving}
            isLoading={saving}
            className="min-h-[2.75rem]"
          >
            {editing ? 'Save changes' : 'Create campaign'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default CampaignFormDialog;
