// src/shared/components/row-controls/StateLadder.tsx
import React from "react";
import clsx from "clsx";
import Typography from "core/components/Typography";
import { usePendingWrite } from "./usePendingWrite";

export interface StateLadderOption<V extends string> {
  value: V;
  /** What the button says. Always a word -- nothing is encoded by colour alone. */
  label: string;
}

/*
 * There was a `selectedClassName` here, and `15-4` removed it rather than
 * fixing its spelling. Three things were wrong with it at once:
 *
 * 1. **No option ever named a class that exists.** The location and rumour
 *    ladders asked for `knowledge-0/1/2` and the quest ladder for
 *    `outcome-completed` / `outcome-failed`; no stylesheet defines any of the
 *    five. `css-class-manifest.test.ts` walks defined-but-unapplied and
 *    deliberately not the reverse -- that direction would report every Tailwind
 *    utility in the product -- so a class name passed as *data* had no gate at
 *    all, and the ladders looked right because `chip-toggle-selected` was doing
 *    the work.
 * 2. **It could not have worked anyway.** `.chip-toggle-selected` sets `color`
 *    and is declared later in `components.css` than `.valence-*`, so at equal
 *    specificity it wins whatever the option asks for.
 * 3. **The reference does not ask for it.** `S2`, `S4` and `S8` all draw the
 *    selected step as the same chip, because a ladder is a control and the
 *    selected chip says "this is the current one" -- not what the state means.
 *    The state's own hue belongs to the *word* in the row, which is
 *    `RosterStatus` and the valence ramp.
 */

export interface StateLadderProps<V extends string> {
  /** The micro-label above the buttons, e.g. "Status". */
  label: string;
  options: readonly StateLadderOption<V>[];
  value: V;
  /** Perform the write. Rejecting shows the reason beside the control. */
  onChange: (next: V) => Promise<unknown>;
  /** Names the group for assistive technology, e.g. "Status of Recover the drowned ledger". */
  ariaLabel: string;
  /**
   * Which surface the ladder is drawn on.
   *
   * `page` is the ordinary case. `band` is an entity page's header, where the
   * selected chip cannot use `chip-toggle-selected`: that reaches for
   * `--accent-ink`, which the colour schema solves against page, card and
   * sunken and **not** against the band (~1.9:1, D125). On the band the chip
   * takes the band's own neutral pair, which is what the reference shows.
   */
  tone?: "page" | "band";
  className?: string;
}

/**
 * A short ladder of states, changed in one click from the row.
 *
 * Three or four buttons, never a dropdown: these are the fields people
 * currently open a whole form to change -- a quest's status, an NPC's stance, a
 * location's or a rumour's knowledge step. The mocks (`S2`, `S6`, `S8`) show
 * buttons for exactly this reason.
 *
 * Every step is a **word** as well as a colour (design language §2), and the
 * write obeys §7: the button that is lit is the one the *record* holds, not
 * the one just clicked, until the server agrees.
 */
export function StateLadder<V extends string>({
  label,
  options,
  value,
  onChange,
  ariaLabel,
  tone = "page",
  className,
}: StateLadderProps<V>) {
  const { isPending, error, run } = usePendingWrite();
  const onBand = tone === "band";

  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-2 flex-wrap">
        <Typography
          variant="body-sm"
          color={onBand ? undefined : "muted"}
          className={clsx(
            "text-[11px] font-semibold uppercase tracking-wider",
            onBand && "hero-muted"
          )}
          id={`${ariaLabel}-label`}
        >
          {label}
        </Typography>

        <div
          role="group"
          aria-label={ariaLabel}
          className="flex items-center gap-1 flex-wrap"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                // A ladder is a set of states, one of which is current --
                // exactly what `aria-pressed` describes.
                aria-pressed={isSelected}
                disabled={isPending}
                onClick={() => {
                  if (isSelected) return;
                  void run(() => onChange(option.value));
                }}
                className={clsx(
                  // 44px on a phone, tighter from `sm` up -- the rule
                  // `ObjectiveCheckbox` already follows, and the one `15-7`
                  // measured this ladder against at 320px (it was 32px, which
                  // is under every touch-target floor).
                  "px-3 py-1 rounded-full text-sm min-h-[44px] sm:min-h-[32px]",
                  "disabled:opacity-60 disabled:cursor-wait",
                  onBand ? "band-chip" : "chip-toggle",
                  isSelected && (onBand ? "band-chip-selected" : "chip-toggle-selected")
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {isPending && (
          // Never a tick: the record has not changed yet.
          <Typography
            variant="body-sm"
            color={onBand ? undefined : "secondary"}
            className={onBand ? "hero-muted" : undefined}
            aria-live="polite"
          >
            Saving…
          </Typography>
        )}
      </div>

      {error && (
        <Typography variant="body-sm" color="error" role="alert">
          {error}
        </Typography>
      )}
    </div>
  );
}

export default StateLadder;
