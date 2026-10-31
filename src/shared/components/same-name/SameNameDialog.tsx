// src/shared/components/same-name/SameNameDialog.tsx
import React, { useEffect, useId, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import Dialog from "core/components/Dialog";
import Typography from "core/components/Typography";
import Button from "core/components/Button";
import Input from "core/components/Input";
import { TEXT_LIMITS } from "core/constants/textLimits";
import type { SameNameKind } from "features/campaign-entities";

/** What the player chose. */
export type SameNameChoice =
  | { action: "merge" }
  | { action: "create"; name: string }
  | { action: "open" }
  | { action: "cancel" };

/** What the dialog is asked about. */
export interface SameNameRequest {
  kind: SameNameKind;
  /** The name the player typed. */
  name: string;
  /** The existing record's id and name, as stored. */
  existingId: string;
  existingName: string;
  /**
   * What adding to it would write, one line each; `null` when the record
   * has not reached this page yet and nothing can be listed. Leave
   * `canMerge` false to offer only opening it or going ahead.
   */
  preview: string[] | null;
  /** Whether "Add what you know to it" is offered. True unless said otherwise. */
  canMerge?: boolean;
  /** The verb of the button that goes ahead: "Create" unless said otherwise. */
  createVerb?: string;
  /** Inside another dialog, such as quick add's. */
  isNested?: boolean;
}

/** Where a record of each kind opens. A rumour has no page: its row opens. */
export function recordHref(kind: SameNameKind, id: string): string {
  switch (kind) {
    case "npc":
      return `/npcs/${id}`;
    case "location":
      return `/locations/${id}`;
    case "quest":
      return `/quests/${id}`;
    case "rumor":
      return `/rumors?highlight=${id}`;
  }
}

const OTHER: Record<SameNameKind, string> = {
  npc: "someone else",
  location: "somewhere else",
  quest: "another quest",
  rumor: "another rumour",
};

/** "A Grog already exists"; a name that starts with an article goes alone. */
export function alreadyExistsTitle(name: string): string {
  const trimmed = name.trim();
  return /^(the|a|an)\s/i.test(trimmed)
    ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)} already exists`
    : `A ${trimmed} already exists`;
}

interface SameNameDialogProps extends SameNameRequest {
  onChoose: (choice: SameNameChoice) => void;
}

/**
 * "A Grog already exists" (T163): the record of that name, a way to open it,
 * and three ways on -- add what you know to it, go ahead under another name
 * (or the same one, which makes a second record on purpose), or cancel.
 *
 * Adding lists what it will write before anything is written. Nothing the
 * record holds is overwritten: what differs goes into a note.
 */
const SameNameDialog: React.FC<SameNameDialogProps> = ({
  kind,
  name,
  existingName,
  preview,
  canMerge = true,
  createVerb = "Create",
  isNested = false,
  onChoose,
}) => {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(name);
  useEffect(() => setNewName(name), [name]);
  const mergeHeading = useId();
  const otherHeading = useId();

  const cancel = () => onChoose({ action: "cancel" });

  return (
    <Dialog
      open
      onClose={cancel}
      title={alreadyExistsTitle(existingName || name)}
      maxWidth="max-w-lg"
      isNested={isNested}
      placement="sheet-on-phone"
    >
      <div className="flex flex-col gap-5">
        <div>
          <Button
            variant="link"
            onClick={() => onChoose({ action: "open" })}
            endIcon={<ArrowUpRight size={14} aria-hidden="true" />}
          >
            Open {existingName}
          </Button>
        </div>

        {canMerge && (
          <section aria-labelledby={mergeHeading} className="flex flex-col gap-2">
            <Typography id={mergeHeading} variant="h4" className="text-base">
              Add what you know to it
            </Typography>
            {preview === null ? (
              <Typography variant="body-sm" color="secondary">
                What you add goes into it; nothing it already says is changed.
              </Typography>
            ) : preview.length ? (
              <ul className="list-disc pl-5 flex flex-col gap-1">
                {preview.map((line) => (
                  <li key={line}>
                    <Typography variant="body-sm">{line}</Typography>
                  </li>
                ))}
              </ul>
            ) : (
              <Typography variant="body-sm" color="secondary">
                It already says everything you were adding.
              </Typography>
            )}
            <div>
              <Button variant="primary" onClick={() => onChoose({ action: "merge" })}>
                Add to {existingName}
              </Button>
            </div>
          </section>
        )}

        <section aria-labelledby={otherHeading} className="flex flex-col gap-2">
          <Typography id={otherHeading} variant="h4" className="text-base">
            {createVerb} as {OTHER[kind]}
          </Typography>
          {renaming ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                // A portal's events still bubble through React to the
                // surface that opened it, which may be a form of its own.
                event.stopPropagation();
                if (newName.trim()) onChoose({ action: "create", name: newName.trim() });
              }}
            >
              <Input
                label="Name"
                value={newName}
                maxLength={TEXT_LIMITS.line}
                onChange={(event) => setNewName(event.target.value)}
                helperText="Keeping the name makes a second one of the same name."
                autoFocus
                fullWidth
              />
              <div>
                <Button type="submit" variant="outline" disabled={!newName.trim()}>
                  {createVerb} {newName.trim() || name}
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button variant="outline" onClick={() => setRenaming(true)}>
                Choose a name
              </Button>
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default SameNameDialog;
