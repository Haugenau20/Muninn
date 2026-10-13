// src/shared/components/gated/GatedContent.tsx
import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import {
  useGroups,
  useCampaigns,
  signInPathFor,
} from "features/user-management";
import Button from "core/components/Button";
import Typography from "core/components/Typography";
import GatedPageState from "./GatedPageState";
import type { CampaignOption } from "./types";
import { useSelectableCampaigns } from "./useSelectableCampaigns";
import type { PageGate } from "./usePageGate";

/** Props for {@link GatedContent}. */
export interface GatedContentProps {
  /** The page's gate, from `usePageGate`. */
  gate: PageGate;
  /** What to render once the gate is `ready`. */
  children: React.ReactNode;
  /**
   * What the page will hold, shown to a signed-out visitor under the panel
   * (T150): the page's example rows (`NPCExample` and its siblings). A prop
   * rather than a lookup by page, because this module cannot import the
   * features that draw them. Members never see it, whatever their campaign
   * holds.
   */
  signedOutExample?: React.ReactNode;
}

/**
 * A skeleton, not a message.
 *
 * State 1 exists precisely so that nothing is *claimed* while the answer is
 * unknown — every "please select a group" flash on a fresh page load came from
 * a page rendering its state-3 copy during restore. The blocks are hidden from
 * assistive technology and the status role carries the meaning instead.
 */
const Skeleton: React.FC = () => (
  <div role="status" aria-busy="true" data-testid="gated-skeleton">
    <span className="sr-only">Loading</span>
    <div className="space-y-4" aria-hidden="true">
      <div className="h-10 w-1/3 rounded animate-pulse bg-secondary" />
      <div className="h-24 rounded animate-pulse bg-secondary" />
      <div className="h-24 rounded animate-pulse bg-secondary" />
    </div>
  </div>
);

/**
 * Renders whichever of the gated states the page is in, or its content.
 *
 * Owns the cross-group campaign fetch and the switch, so a page adopting the
 * gate writes two lines.
 *
 * It used to own two dialogs as well. Signing in from a gated page now
 * navigates to `/signin`, carrying this page as the destination -- which is
 * the whole point: the dialog had nowhere to put where you were, so signing in
 * to read one quest returned you to the campaign's front door.
 */
const GatedContent: React.FC<GatedContentProps> = ({ gate, children, signedOutExample }) => {
  const [selectError, setSelectError] = useState<string | null>(null);
  const location = useLocation();

  const { groups, activeGroupId, setActiveGroup } = useGroups();
  const { createCampaign, setActiveCampaign } = useCampaigns();

  const isPicking = gate.state === "pick-campaign";
  const { options, loading: campaignsLoading } = useSelectableCampaigns(isPicking);

  /**
   * Switch to the chosen campaign, moving group first when it lives elsewhere.
   *
   * The order matters: `setActiveGroup` loads that group's campaigns and
   * activates one, so calling it second would overwrite the campaign we just
   * chose. Same-group picks skip it entirely.
   */
  const handleSelectCampaign = async (option: CampaignOption) => {
    setSelectError(null);
    try {
      if (option.groupId !== activeGroupId) {
        await setActiveGroup(option.groupId);
      }
      await setActiveCampaign(option.campaignId);
    } catch (error) {
      setSelectError(
        error instanceof Error ? error.message : "Could not open that campaign."
      );
    }
  };

  /**
   * Make the first campaign in the active group and open it (T127). Offered
   * only while the reader's groups have none, which the panel decides.
   */
  const handleCreateCampaign = async ({
    name,
    description,
  }: {
    name: string;
    description: string;
  }) => {
    if (!activeGroupId) throw new Error("No active group selected");
    const campaignId = await createCampaign(activeGroupId, name, description);
    await setActiveCampaign(campaignId);
  };

  // Whether the active group has no campaign of its own, judged once the
  // cross-group list is in; only then is starting one offered.
  const activeGroupHasNone =
    !!activeGroupId &&
    !campaignsLoading &&
    !options.some((option) => option.groupId === activeGroupId);

  const panel =
    gate.state === "signed-out" || isPicking ? (
      <GatedPageState
        variant={gate.state === "signed-out" ? "signed-out" : "pick-campaign"}
        heading={gate.heading}
        blurb={gate.copy.blurb}
        eyebrow={gate.copy.eyebrow}
        signInHref={signInPathFor(location)}
        joinHref="/join"
        // A founder link (T127); the page asks for it when it has no token.
        startGroupHref="/join?founder="
        onCreateCampaign={activeGroupHasNone ? handleCreateCampaign : undefined}
        createCampaignGroupName={groups.find((group) => group.id === activeGroupId)?.name}
        campaigns={options}
        hasGroups={groups.length > 0}
        campaignsLoading={campaignsLoading}
        selectError={selectError}
        onSelectCampaign={handleSelectCampaign}
      />
    ) : null;

  return (
    <>
      {gate.state === "resolving" && <Skeleton />}

      {panel}

      {gate.state === "signed-out" && signedOutExample}

      {gate.state === "error" && (
        <div className="mx-auto w-full max-w-[560px] rounded-lg p-8 card">
          <Typography variant="h2" className="mb-2">
            Couldn't load {gate.copy.noun}.
          </Typography>
          <Typography color="error" className="mb-6">
            {gate.error}
          </Typography>
          {gate.onRetry && (
            <Button variant="primary" onClick={gate.onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}

      {gate.state === "ready" && children}

    </>
  );
};

export default GatedContent;
