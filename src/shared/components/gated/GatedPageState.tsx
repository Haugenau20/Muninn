// src/shared/components/gated/GatedPageState.tsx
import React from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { buttonClasses } from "core/components/Button";
import Typography from "core/components/Typography";
import FirstCampaignForm, { type FirstCampaignValues } from "../FirstCampaignForm";
import type { CampaignOption } from "./types";

export type { CampaignOption } from "./types";

/** Props for {@link GatedPageState}. */
export interface GatedPageStateProps {
  variant: "signed-out" | "pick-campaign";
  /** Already resolved for read/write mode by `usePageGate`. */
  heading: string;
  blurb: string;
  /** Overrides the signed-out eyebrow. See `GatedPageCopy.eyebrow`. */
  eyebrow?: string;
  /**
   * Where "Sign in" goes, already carrying this page as the destination.
   *
   * An href rather than a callback because these are now real links: sign-in
   * and join are routes, so the controls that lead to them should be openable
   * in a new tab and reachable by a middle click like any other link. They
   * used to open dialogs, which is why they were buttons.
   */
  signInHref: string;
  /** Where "I have an invite link" goes. */
  joinHref: string;
  /**
   * Where "I have a link to start a group" goes (T127). `pick-campaign` with
   * no group only; omitted, the link is not offered.
   */
  startGroupHref?: string;
  /**
   * Makes the first campaign of the active group (T127). Every member may.
   * Shown as the panel's form while the reader's groups have no campaign at
   * all, and folded under the list when only other groups have some.
   * Omitted, no form is offered.
   */
  onCreateCampaign?: (values: FirstCampaignValues) => Promise<void>;
  /** The active group's name, for the folded form's label. */
  createCampaignGroupName?: string;
  /** Campaigns to offer. `pick-campaign` only. */
  campaigns?: CampaignOption[];
  /** Whether the user belongs to any group at all. `pick-campaign` only. */
  hasGroups?: boolean;
  /** Whether the campaign list is still being fetched. */
  campaignsLoading?: boolean;
  /** A failed switch, rendered above the list without clearing it. */
  selectError?: string | null;
  onSelectCampaign?: (option: CampaignOption) => void;
}

/** Small-caps eyebrow above the heading. */
const Eyebrow: React.FC<{ icon?: React.ReactNode; children: React.ReactNode }> = ({
  icon,
  children,
}) => (
  <div className="flex items-center gap-2 mb-4">
    {icon}
    <span
      data-testid="gated-eyebrow"
      className="text-xs font-semibold uppercase tracking-widest typography-muted"
    >
      {children}
    </span>
  </div>
);

/**
 * The panel a page shows when it cannot show its content yet.
 *
 * One component, one layout, on all 21 gated routes — only the heading and one
 * sentence change. It replaces per-page cards that variously said "No Group
 * Selected", "Please select a group to view NPCs" and "No Active Group or
 * Campaign", three of which were shown to signed-out visitors who had no
 * switcher on screen to act on them.
 *
 * Presentational by design: no data hooks, no services. `GatedContent` owns the
 * fetching, the dialogs and the switch.
 */
const GatedPageState: React.FC<GatedPageStateProps> = ({
  variant,
  heading,
  blurb,
  eyebrow = "Private campaign",
  signInHref,
  joinHref,
  startGroupHref,
  onCreateCampaign,
  createCampaignGroupName,
  campaigns = [],
  hasGroups = false,
  campaignsLoading = false,
  selectError = null,
  onSelectCampaign,
}) => {
  const isSignedOut = variant === "signed-out";

  // Which of the four pick-campaign situations we are in. Kept as one value
  // so the heading, the line and the actions cannot disagree with each other.
  //
  // "loading" guards against a real defect: `useSelectableCampaigns`
  // initialises `loading: false` and only flips it true inside its effect, so
  // on first paint -- and for the whole cross-group fetch after that --
  // `campaigns` is `[]` for a reason that has nothing to do with whether the
  // user has any. Falling through to "no-campaigns" there would tell a member
  // who has campaigns, just not fetched yet, that there are none -- exactly
  // the "claim something while the answer is unknown" defect this whole gated
  // system exists to remove. A member with no group at all needs no fetch to
  // know that (`hasGroups` is synchronous), so "no-groups" still wins first.
  const pickSituation = !hasGroups
    ? "no-groups"
    : campaignsLoading && campaigns.length === 0
    ? "loading"
    : campaigns.length === 0
    ? "no-campaigns"
    : "choose";

  const pickHeading =
    pickSituation === "no-groups"
      ? "Join a group"
      : pickSituation === "loading"
      ? "Finding your campaigns"
      : pickSituation === "no-campaigns"
      ? "No campaigns yet"
      : "Which campaign?";

  // Player-facing wording, not a description of the data model. These lines
  // used to say "The Companion is invite-only. Ask your DM for a join link."
  // and "A group admin creates the first campaign" -- both name roles the
  // reader may not have (any player can be the group admin, and a campaign
  // here works whether or not the DM ever signs in), and both explain the
  // system rather than telling the reader what to do next.
  const pickLine =
    pickSituation === "no-groups"
      ? "Ask whoever set up your campaign for a join link."
      : pickSituation === "loading"
      ? "One moment…"
      : pickSituation === "no-campaigns"
      ? onCreateCampaign
        ? "Start the first one. Everyone in your group can read it and add to it."
        : "Your first campaign will appear here as soon as it's created."
      : `You're in ${campaigns.length === 1 ? "one campaign" : `${campaigns.length} campaigns`}. ` +
        "Pick one to carry on — you can switch any time from the campaign " +
        "name in the header.";

  return (
    <div className="mx-auto w-full max-w-[560px] rounded-lg p-8 card">
      {isSignedOut ? (
        <Eyebrow icon={<Lock className="w-4 h-4 typography-muted" aria-hidden="true" />}>
          {eyebrow}
        </Eyebrow>
      ) : (
        <Eyebrow>Signed in · no campaign chosen</Eyebrow>
      )}

      <Typography variant="h2" className="mb-4 typography-heading">
        {isSignedOut ? heading : pickHeading}
      </Typography>

      <Typography color="secondary" className="mb-6">
        {isSignedOut ? blurb : pickLine}
      </Typography>

      {isSignedOut ? (
        <>
          <div className="flex flex-wrap gap-3">
            <Link to={signInHref} className={buttonClasses({ variant: "primary" })}>
              Sign in
            </Link>
            <Link to={joinHref} className={buttonClasses({ variant: "outline" })}>
              I have an invite link
            </Link>
          </div>
        </>
      ) : (
        <>
          {selectError && (
            <Typography color="error" className="mb-4">
              {selectError}
            </Typography>
          )}

          {pickSituation === "choose" && (
            <ul className="space-y-2">
              {campaigns.map((option) => (
                <li key={`${option.groupId}:${option.campaignId}`}>
                  <button
                    type="button"
                    onClick={() => onSelectCampaign?.(option)}
                    className="w-full flex items-baseline gap-2 rounded-md px-4 py-3 text-left selectable-item card-border"
                  >
                    <span className="font-semibold">{option.campaignName}</span>
                    <span className="text-sm typography-secondary">
                      · {option.groupName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* The list spans every group; the active one may still have
              none, and its members may start it here (T127). */}
          {pickSituation === "choose" && !campaignsLoading && onCreateCampaign && (
            <details className="mt-6">
              <summary className="cursor-pointer font-semibold primary">
                Start a campaign in {createCampaignGroupName ?? "your group"}
              </summary>
              <div className="mt-4">
                <FirstCampaignForm onCreate={onCreateCampaign} />
              </div>
            </details>
          )}

          {pickSituation === "choose" && campaignsLoading && (
            <Typography variant="body-sm" color="secondary" className="mt-3">
              Still looking for more campaigns…
            </Typography>
          )}

          {pickSituation === "no-groups" && (
            <div className="flex flex-wrap gap-3">
              <Link to={joinHref} className={buttonClasses({ variant: "primary" })}>
                I have an invite link
              </Link>
              {startGroupHref && (
                <Link to={startGroupHref} className={buttonClasses({ variant: "outline" })}>
                  I have a link to start a group
                </Link>
              )}
            </div>
          )}

          {pickSituation === "no-campaigns" && onCreateCampaign && (
            <FirstCampaignForm onCreate={onCreateCampaign} />
          )}
        </>
      )}
    </div>
  );
};

export default GatedPageState;
