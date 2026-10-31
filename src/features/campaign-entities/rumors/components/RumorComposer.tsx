// src/features/campaign-entities/rumors/components/RumorComposer.tsx
import React, { useId, useState } from 'react';
import { TEXT_LIMITS } from 'core/constants/textLimits';
import { Plus } from 'lucide-react';
import Button from 'core/components/Button';
import Input from 'core/components/Input';
import Typography from 'core/components/Typography';
import PrivateCheckbox from 'shared/components/private/PrivateCheckbox';

export interface RumorComposerProps {
  /**
   * Create the rumour and resolve with its id. Must reject on failure — the
   * composer keeps the typed text and says why (§7). `private` when the
   * player ticked "Private" (T163).
   */
  onAdd: (content: string, options?: { private?: boolean }) => Promise<string>;
  className?: string;
}

/**
 * Why the disabled button explains itself.
 *
 * *Add rumour* is disabled until the field has something in it, which is
 * correct and which read as broken: the maintainer's first encounter with this
 * row was pressing the button, getting nothing, and concluding it did not
 * work. A disabled control that says nothing is indistinguishable from one
 * that is simply not wired up.
 *
 * Chrome does not show a `title` on a disabled button -- pointer events are
 * suppressed on it -- so the tooltip belongs to the *wrapper*, and the same
 * sentence is bound to the button through `aria-describedby` for anyone who
 * cannot hover.
 */
const NEEDS_SOMETHING = 'Write it down first — then this adds it.';

/**
 * The composer row, permanently at the top of the list (item 1).
 *
 * A rumour is the one thing in this product you write down *while someone is
 * still talking*. Everything else can wait for a form; this cannot, and until
 * now it took a route change to `/rumors/create`, a seven-field form and a
 * navigation back to the list to record one sentence overheard in a tavern.
 *
 * **The field is what was heard, not a title.** It took the title until the
 * maintainer pointed out the obvious: a title worth typing is a sentence, and
 * a sentence never fits the row that has to render it — so the one thing you
 * wrote while someone was still talking was the one thing you could not read
 * back. What you type is now the rumour's *content*, and the list names the
 * row from its first line until you give it a shorter title on purpose.
 *
 * Write it, press Add, and the new rumour's row opens underneath with the
 * title field focused — the sentence is already recorded, so the only thing
 * left is to name it, and that can wait. **No dialog and no navigation** —
 * there is no page to land on, which is the whole design of this entity
 * (§2.1).
 *
 * Deliberately not `15-1`'s quick add: that opens a dialog and then sends you
 * to the record's own page, and a rumour has neither. The one-field shape is
 * the same idea in the place this entity actually lives.
 */
export const RumorComposer: React.FC<RumorComposerProps> = ({ onAdd, className }) => {
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'adding' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  // Kept between rumours: one heard in a one-to-one session is seldom alone.
  const [isPrivate, setPrivate] = useState(false);
  const hintId = useId();

  const trimmed = text.trim();
  const empty = !trimmed;

  const submit = async () => {
    if (!trimmed || state === 'adding') return;
    setState('adding');
    setError(null);
    try {
      await (isPrivate ? onAdd(trimmed, { private: true }) : onAdd(trimmed));
      // Only now: the row below is the confirmation, and it carries the text
      // that was typed here.
      setText('');
      setState('idle');
    } catch (err) {
      // The typed text stays. Somebody heard something and said it out loud;
      // losing it to a failed write is the one unforgivable version of this.
      setState('failed');
      setError(err instanceof Error ? err.message : 'Could not add the rumour. Your text is still here.');
    }
  };

  return (
    <div className={className}>
      <div className="card rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap sm:flex-nowrap">
        <Plus size={16} aria-hidden="true" className="shrink-0 typography-secondary" />
        <div className="flex-1 min-w-0 w-full sm:w-auto">
          <Input
            // The placeholder is the prompt, so a visible label above it would
            // say the same words twice in a one-line composer. The accessible
            // name carries them for anyone who cannot see the placeholder.
            aria-label="Heard something? Write it down here"
            placeholder="Heard something? Write it down here…"
            value={text}
            maxLength={TEXT_LIMITS.text}
            disabled={state === 'adding'}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // One line, so Enter means "add it" rather than a newline.
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        {/*
          The title lives on the wrapper, not the button: a disabled button
          receives no pointer events, so its own tooltip never appears.
        */}
        <span className="shrink-0" title={empty ? NEEDS_SOMETHING : undefined}>
          <Button
            size="sm"
            aria-describedby={empty ? hintId : undefined}
            onClick={() => void submit()}
            disabled={empty || state === 'adding'}
          >
            {state === 'adding' ? 'Adding…' : 'Add rumour'}
          </Button>
        </span>
      </div>

      <div className="mt-2 px-1">
        <PrivateCheckbox checked={isPrivate} onChange={setPrivate} disabled={state === 'adding'} />
      </div>

      {/* Hovering is not available to everyone; the same sentence, read out. */}
      <span id={hintId} className="sr-only">
        {NEEDS_SOMETHING}
      </span>

      {error && (
        <Typography variant="body-sm" color="error" role="alert" className="mt-2">
          {error}
        </Typography>
      )}
    </div>
  );
};

export default RumorComposer;
