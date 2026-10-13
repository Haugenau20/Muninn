// src/shared/components/gated/index.ts

/**
 * Public surface of the gated-page-state module.
 *
 * A page needs exactly two of these — `usePageGate` and `GatedContent`. The
 * rest are exported for tests and for the one page (Home) that branches on the
 * state itself.
 */
export { default as GatedContent } from "./GatedContent";
export { default as GatedPageState } from "./GatedPageState";
export { usePageGate } from "./usePageGate";
export { useSelectableCampaigns } from "./useSelectableCampaigns";
export {
  GATED_COPY,
  gatedHeading,
} from "./gated-page-copy";
export type { GatedContentProps } from "./GatedContent";
export type { GatedPageStateProps } from "./GatedPageState";
export type { CampaignOption } from "./types";
export type { GateState, PageGate, PageGateOptions } from "./usePageGate";
export type {
  GatedContextRequirement,
  GatedPageCopy,
  GatedPageKey,
} from "./gated-page-copy";
