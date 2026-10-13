// src/features/collaboration/notes/example/NoteExample.tsx
import React, { useRef } from "react";
import { Check } from "lucide-react";
import Typography from "core/components/Typography";
import ExampleRegion from "shared/example-campaign/ExampleRegion";
import { EXAMPLE_CAMPAIGN } from "shared/example-campaign/example-campaign";
import { useAutoGrow } from "shared/hooks/useAutoGrow";
import NoteSheet, { countWords } from "../components/NoteSheet";
import CampaignLinksView, { type CampaignLink } from "../components/CampaignLinksView";

const { note, npcs, locations } = EXAMPLE_CAMPAIGN;
const CONTENT = note.paragraphs.join("\n\n");
const WORDS = countWords(CONTENT);

/** The example's people and places the note names, as the links panel lists them. */
const REFERENCES: CampaignLink[] = note.references.map((id) => {
  const npc = npcs.find((candidate) => candidate.id === id);
  if (npc) return { id, type: "npc", title: npc.name };
  const place = locations.find((candidate) => candidate.id === id);
  return { id, type: "location", title: place?.name ?? id };
});

/** Every control here: drawn as a member sees it, answered with nothing. */
const nothing = () => undefined;

/**
 * The notes page as a signed-out visitor sees it (design 4a): one player's
 * session note from the example campaign, open on the real note sheet with
 * the campaign-links panel beside it, already scanned -- the names it holds,
 * and the five it found that the campaign does not.
 *
 * Nothing reacts. The note can be read and not changed; Archive, Delete,
 * Scan note and Add look as they do for a member and do nothing; the scan is
 * the fixture's, so nothing is ever sent to the extractor.
 */
const NoteExample: React.FC = () => {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(bodyRef, CONTENT);

  return (
    <ExampleRegion caption="One player's note from the Ashen Vale">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
        <NoteSheet
          title={note.title}
          content={CONTENT}
          onBack={nothing}
          onArchive={nothing}
          onDelete={nothing}
          status={
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 feedback-success" />
              <Typography variant="body-sm" color="secondary" className="text-[13px]">
                Example note · read-only
              </Typography>
            </div>
          }
          footerNote={`${WORDS.toLocaleString()} words`}
          bodyRef={bodyRef}
        />
        <CampaignLinksView
          references={REFERENCES}
          detections={note.detections}
          onScan={nothing}
          onOpenReference={nothing}
          onAdd={nothing}
        />
      </div>
    </ExampleRegion>
  );
};

export default NoteExample;
