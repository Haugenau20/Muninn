// src/shared/components/private/PrivateMark.tsx
import React from "react";
import { Lock } from "lucide-react";

/**
 * Marks one of the reader's private records (T163) wherever it sits beside
 * the campaign's own: in a list's row and on its page. Only its author ever
 * sees one, so it says what that means rather than only showing a lock.
 */
const PrivateMark: React.FC<{ className?: string }> = ({ className = "" }) => (
  <span
    className={`chip inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs shrink-0 ${className}`}
    title="Only you see this until you publish it"
  >
    <Lock size={12} aria-hidden="true" />
    Private
  </span>
);

export default PrivateMark;
