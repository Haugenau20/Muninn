// src/features/collaboration/notes/components/CampaignLinksView.tsx
import React from "react";
import { Loader2, Search } from "lucide-react";
import Typography from "../../../../core/components/Typography";
import Button from "../../../../core/components/Button";
import EntitySigil from "../../../../core/components/EntitySigil";
import { EXTRACTION_FACTS } from "../../../../core/constants/privacy";
import type { EntityType } from "../types";

/** A record of the campaign the note names. */
export interface CampaignLink {
  id: string;
  type: EntityType;
  title: string;
}

/** A name a scan found that the campaign does not hold yet. */
export interface CampaignLinkDetection {
  id: string;
  text: string;
  type: EntityType;
  /** From 0 to 1. */
  confidence: number;
}

/** Props for {@link CampaignLinksView}. */
export interface CampaignLinksViewProps {
  references: readonly CampaignLink[];
  detections: readonly CampaignLinkDetection[];
  onScan: () => void;
  /** While a scan runs: the button spins. */
  scanning?: boolean;
  scanDisabled?: boolean;
  onOpenReference: (reference: CampaignLink) => void;
  onAdd: (detection: CampaignLinkDetection) => void;
  /** Detections being added right now: their button spins. */
  addingIds?: ReadonlySet<string>;
  /** Under the disclosure: the panel's state and anything that went wrong. */
  status?: React.ReactNode;
}

/** "an NPC" reads correctly; "a location" does not take "an". */
function articleFor(type: EntityType): string {
  return type === "npc" ? "an" : "a";
}

/** The word a type is called by. */
export function getEntityTypeName(type: EntityType): string {
  switch (type) {
    case "npc":
      return "NPC";
    case "location":
      return "Location";
    case "quest":
      return "Quest";
    case "rumor":
      return "Rumour";
    default:
      return type;
  }
}

/**
 * What the campaign-links panel draws: the header with Scan note, the
 * disclosure, the records the note names and the names a scan found. Data
 * and actions come in as props -- `CampaignLinksPanel` scans, saves and adds;
 * the notes page's signed-out example shows a scan it never ran.
 */
const CampaignLinksView: React.FC<CampaignLinksViewProps> = ({
  references,
  detections,
  onScan,
  scanning = false,
  scanDisabled = false,
  onOpenReference,
  onAdd,
  addingIds,
  status,
}) => (
  <div className="campaign-links card rounded-xl p-4">
    {/* Header — always rendered, even when both groups are empty */}
    <div className="flex items-center justify-between gap-3">
      <Typography variant="body" className="font-semibold">
        Campaign links
      </Typography>
      <Button
        variant="outline"
        size="sm"
        onClick={onScan}
        disabled={scanDisabled}
        startIcon={scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
      >
        Scan note
      </Button>
    </div>

    {/*
      The disclosure belongs where the decision is made, not only on the
      privacy page. One line: what leaves, and where it goes. Unconditional --
      the button's disabled state says nothing about where the text travels
      once it is usable again.
    */}
    <Typography variant="body-sm" color="muted" className="mt-2">
      Sends this note's text to {EXTRACTION_FACTS.provider} to look for names.{" "}
      <a href="/privacy#entity-extraction" className="underline">
        How this works
      </a>
    </Typography>

    {status}

    {/* Group 1 — matched */}
    {references.length > 0 && (
      <div className="mt-4">
        <Typography variant="caption" color="muted" className="text-[11px] uppercase tracking-wider">
          {`IN YOUR CAMPAIGN · ${references.length}`}
        </Typography>
        <div className="mt-2 space-y-1">
          {references.map((reference) => (
            <button
              key={`${reference.type}-${reference.id}`}
              type="button"
              onClick={() => onOpenReference(reference)}
              className="dropdown-item w-full flex items-center gap-3 px-2 py-1.5 rounded text-left"
            >
              {/* Its own mark, as on its page; the type name at the end of the row says what kind. */}
              <EntitySigil entityId={reference.id} name={reference.title} size={20} />
              <Typography variant="body-sm" className="flex-1 truncate">
                {reference.title}
              </Typography>
              <Typography variant="body-sm" color="secondary" className="flex-shrink-0">
                {getEntityTypeName(reference.type)}
              </Typography>
            </button>
          ))}
        </div>
      </div>
    )}

    {/* Group 2 — detected, not yet in the campaign */}
    {detections.length > 0 && (
      <div className="mt-4">
        <Typography variant="caption" className="text-[11px] uppercase tracking-wider feedback-warning">
          {`DETECTED, NOT IN YOUR CAMPAIGN · ${detections.length}`}
        </Typography>
        <div className="mt-2 space-y-2">
          {detections.map((entity) => (
            <div key={entity.id} className="flex items-center gap-3 p-2 rounded bg-secondary">
              <div className="min-w-0 flex-1">
                <Typography variant="body-sm" className="font-medium truncate">
                  {entity.text}
                </Typography>
                <Typography variant="caption" color="secondary">
                  {`looks like ${articleFor(entity.type)} ${getEntityTypeName(entity.type)} · ${Math.round(
                    entity.confidence * 100
                  )}% confidence`}
                </Typography>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onAdd(entity)}
                disabled={addingIds?.has(entity.id) ?? false}
              >
                {addingIds?.has(entity.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
              </Button>
            </div>
          ))}
        </div>
      </div>
    )}

    {/* Footnote — only where it is relevant */}
    {(references.length > 0 || detections.length > 0) && (
      <Typography variant="caption" color="muted" className="block mt-4">
        Scanning saves your note first.
      </Typography>
    )}
  </div>
);

export default CampaignLinksView;
