// src/shared/components/gated/GatedSignInBand.tsx
import React from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { buttonClasses } from "core/components/Button";
import Typography from "core/components/Typography";

/** Props for {@link GatedSignInBand}. */
export interface GatedSignInBandProps {
  /** The page's signed-out heading, from `GATED_COPY`. */
  heading: string;
  /** One line: what the example below is, and that the reader's own is private. */
  line: string;
  /** Where "Sign in" goes, carrying this page as the destination. */
  signInHref: string;
  /** Where "I have an invite link" goes. */
  joinHref: string;
}

/**
 * The sign-in on a page that shows a signed-out visitor its example: one
 * slim band above the example instead of the large panel, so what the
 * visitor sees first is the page working, not a description of it.
 *
 * Drawn on the card surface, not the band surface its name suggests: the
 * band carries no accent and no primary action (`colour-schema.md` D125),
 * and Sign in is both.
 */
const GatedSignInBand: React.FC<GatedSignInBandProps> = ({ heading, line, signInHref, joinHref }) => (
  <div className="flex flex-wrap items-center gap-x-5 gap-y-4 rounded-md px-5 py-4 card">
    <Lock size={18} aria-hidden="true" className="shrink-0 typography-muted" />

    <div className="flex-[1_1_22rem] min-w-0">
      <Typography as="h2" variant="body-lg" className="font-heading font-semibold typography-heading">
        {heading}
      </Typography>
      <Typography variant="body-sm" color="secondary">
        {line}
      </Typography>
    </div>

    <div className="flex flex-wrap gap-3">
      <Link to={signInHref} className={buttonClasses({ variant: "primary" })}>
        Sign in
      </Link>
      <Link to={joinHref} className={buttonClasses({ variant: "outline" })}>
        I have an invite link
      </Link>
    </div>
  </div>
);

export default GatedSignInBand;
