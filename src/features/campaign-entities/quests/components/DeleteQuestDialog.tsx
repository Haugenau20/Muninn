// src/features/campaign-entities/quests/components/DeleteQuestDialog.tsx
import React, { useState } from 'react';
import Dialog from 'core/components/Dialog';
import Button from 'core/components/Button';
import Typography from 'core/components/Typography';

export interface DeleteQuestDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The quest being deleted. */
  title: string;
  /**
   * What else loses a link, in words already resolved to names -- "2 rumours
   * were converted into it", "Cinderford points at it". Never ids.
   */
  losses: string[];
  /** Must reject on failure -- nothing here claims success before it resolves. */
  onConfirm: () => Promise<void>;
}

/**
 * Deleting a quest, asked once, naming what else loses a link.
 *
 * A quest is the most linked-to record in the product: rumours convert into
 * it, locations and NPCs relate to it, notes mention it. Deleting one is
 * therefore never a local act, and "This cannot be undone" -- all the dialog it
 * replaces said -- describes the wrong risk. Phase 14 §6: name the object and
 * the blast radius.
 *
 * It lives on the quest's page rather than in the directory row (`15-5` item
 * 12). A row is read while scanning five of them, and the destructive control
 * for a record should sit beside the record, not in the list of them.
 */
export const DeleteQuestDialog: React.FC<DeleteQuestDialogProps> = ({
  isOpen,
  onClose,
  title,
  losses,
  onConfirm,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm();
      setIsDeleting(false);
      onClose();
    } catch (err) {
      // Stays open and says what happened: closing on a failed delete would
      // leave the record on screen with no account of why it is still there.
      setIsDeleting(false);
      setError(err instanceof Error ? err.message : 'Could not delete this quest.');
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} title={`Delete ${title}?`} maxWidth="max-w-lg">
      <div className="flex flex-col gap-4">
        <Typography>{title} is removed for everyone.</Typography>

        {losses.length > 0 && (
          <div className="flex flex-col gap-2">
            <Typography variant="body-sm">What still points at it:</Typography>
            <ul className="list-disc pl-5 space-y-1">
              {losses.map((loss) => (
                <li key={loss}>
                  <Typography variant="body-sm" color="secondary">
                    {loss}
                  </Typography>
                </li>
              ))}
            </ul>
            {/*
              Said plainly rather than implied: nothing here rewrites those
              records, so their links become links to a quest that is gone.
            */}
            <Typography variant="body-sm" color="secondary" className="text-xs">
              Those records are left as they are — their links will point at a quest that no
              longer exists.
            </Typography>
          </div>
        )}

        <Typography variant="body-sm" color="secondary">
          This cannot be undone.
        </Typography>

        {error && (
          <Typography variant="body-sm" color="error" role="alert">
            {error}
          </Typography>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isDeleting}>
            Keep it
          </Button>
          {/*
            The confirm names the quest, as the sibling location dialog does:
            the control that opens this dialog says "Delete quest", and two
            controls reading identically is how someone confirms a delete they
            were still deciding about (the same fix 14.5 made for the rumour
            list).
          */}
          <Button
            className="delete-button"
            onClick={() => void handleConfirm()}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting…' : `Delete ${title}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default DeleteQuestDialog;
