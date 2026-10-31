// src/shared/components/private/PrivateNotice.tsx
import React from "react";
import Typography from "core/components/Typography";
import PrivateMark from "./PrivateMark";

/**
 * A private record's page says so first (T163): who can see it, and that
 * this stays true until its author publishes it.
 */
const PrivateNotice: React.FC = () => (
  <div className="flex items-center gap-2 flex-wrap">
    <PrivateMark />
    <Typography variant="body-sm" color="secondary">
      Only you see this until you publish it.
    </Typography>
  </div>
);

export default PrivateNotice;
