// src/shared/components/private/PublishButton.tsx
import React, { useCallback, useRef, useState } from "react";
import { Send } from "lucide-react";
import Button from "core/components/Button";
import Dialog from "core/components/Dialog";
import Typography from "core/components/Typography";
import type { PrivateKind, PublishListed, PublishOutcome, PublishQuestions } from "features/campaign-entities";
import { useSameNameDialog } from "shared/components/same-name/useSameNameDialog";
import { recordHref } from "shared/components/same-name/SameNameDialog";
import { useNavigation } from "shared/hooks/useNavigation";

const KIND_NAME: Record<PrivateKind, string> = {
  npc: "person",
  location: "place",
  quest: "quest",
  rumor: "rumour",
};

interface PublishButtonProps {
  /**
   * `usePublish()`'s function, handed in rather than imported: the rumour
   * row inside the feature renders this, and a shared component importing
   * the feature back would make a cycle.
   */
  publish: (kind: PrivateKind, id: string, ask: PublishQuestions) => Promise<PublishOutcome>;
  kind: PrivateKind;
  id: string;
  name: string;
  /** Told where it went, when its id changed or it was added to another record. */
  onPublished?: (id: string) => void;
}

/**
 * Publish one of the author's private records (T163): it moves into the
 * campaign, where everyone in the group sees it. Asks first, naming every
 * record that goes with it, and says that it cannot be undone -- deleting it
 * stays the way out. A record whose name a shared one carries is asked
 * about as "already exists" is.
 */
const PublishButton: React.FC<PublishButtonProps> = ({ publish, kind, id, name, onPublished }) => {
  const sameName = useSameNameDialog();
  const { navigateToPage } = useNavigation();
  const [listed, setListed] = useState<PublishListed[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = useRef<((go: boolean) => void) | null>(null);

  const confirm = useCallback(
    (records: PublishListed[]) =>
      new Promise<boolean>((resolve) => {
        answer.current = resolve;
        setListed(records);
      }),
    []
  );
  const decide = (go: boolean) => {
    setListed(null);
    answer.current?.(go);
    answer.current = null;
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await publish(kind, id, {
        confirm,
        sameName: (question) => sameName.ask({ ...question, createVerb: "Publish" }),
      });
      if (outcome.published) {
        const now = outcome.ids[`${kind}:${id}`];
        if (now && now !== id) onPublished?.(now);
      } else if (outcome.open) {
        navigateToPage(recordHref(outcome.open.kind, outcome.open.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish it.");
    } finally {
      setBusy(false);
    }
  };

  const others = (listed ?? []).filter((record) => record.id !== id || record.kind !== kind);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void run()}
        isLoading={busy}
        disabled={busy}
        startIcon={<Send size={14} aria-hidden="true" />}
      >
        Publish
      </Button>
      {error && (
        <Typography variant="body-sm" color="error" role="alert">
          {error}
        </Typography>
      )}

      <Dialog open={listed !== null} onClose={() => decide(false)} title={`Publish ${name}?`} maxWidth="max-w-md">
        <div className="flex flex-col gap-4">
          <Typography color="secondary">
            Everyone in the group will see it. Publishing cannot be undone; deleting it stays the way out.
          </Typography>
          {others.length > 0 && (
            <div className="flex flex-col gap-2">
              <Typography variant="body-sm">
                A conversion or a combine joined it to these, so they are published with it:
              </Typography>
              <ul className="list-disc pl-5">
                {others.map((record) => (
                  <li key={`${record.kind}:${record.id}`}>
                    <Typography variant="body-sm">
                      {record.name || "Untitled"} ({KIND_NAME[record.kind]})
                    </Typography>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => decide(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => decide(true)}>
              {others.length ? `Publish all ${others.length + 1}` : "Publish"}
            </Button>
          </div>
        </div>
      </Dialog>
      {sameName.dialog}
    </>
  );
};

export default PublishButton;
