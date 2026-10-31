// src/shared/components/private/PrivateCheckbox.tsx
import React, { useId } from "react";
import { Lock } from "lucide-react";
import Typography from "core/components/Typography";

interface PrivateCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Why it cannot be changed, when it cannot: a place inside a private one. */
  lockedReason?: string;
  disabled?: boolean;
}

/**
 * "Private" on every way of adding a person, place, quest or rumour (T163):
 * only its author sees it until they publish it. The whole line is the
 * target, so it stays a thumb wide on a phone.
 */
const PrivateCheckbox: React.FC<PrivateCheckboxProps> = ({ checked, onChange, lockedReason, disabled }) => {
  const hintId = useId();
  return (
    <label className="flex items-start gap-2 min-h-[44px] sm:min-h-0 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || Boolean(lockedReason)}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={hintId}
        className="mt-1 shrink-0"
      />
      <span className="flex flex-col">
        <span className="flex items-center gap-1">
          <Lock size={14} aria-hidden="true" />
          <Typography as="span" variant="body-sm">
            Private
          </Typography>
        </span>
        <Typography id={hintId} as="span" variant="body-sm" color="muted" className="text-xs">
          {lockedReason ?? "Only you see it until you publish it."}
        </Typography>
      </span>
    </label>
  );
};

export default PrivateCheckbox;
