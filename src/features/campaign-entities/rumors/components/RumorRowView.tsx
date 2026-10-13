// src/features/campaign-entities/rumors/components/RumorRowView.tsx
import React from "react";
import Typography from "core/components/Typography";
import { RosterField } from "core/components/Roster";
import StateLadder from "shared/components/row-controls/StateLadder";
import type { Rumor, RumorStatus } from "../types";
import {
  RUMOR_STATUS_OPTIONS,
  formatSourceType,
  normalizeRumorStatus,
} from "../utils/rumor-presentation";

/** Props for {@link RumorRowView}. */
export interface RumorRowViewProps {
  rumor: Rumor;
  /** The name the row shows, for the ladder's label. */
  name: string;
  /** The people and places the rumour points at, by name. */
  pointsAt: readonly string[];
  onStatusChange: (status: RumorStatus) => void | Promise<unknown>;
  onOpenQuest: (questId: string) => void;
}

/**
 * A rumour's open row for a reader who may not edit it: the same facts the
 * editor holds, as text. The open row is where a member edits a rumour, so
 * without this a reader who cannot would be handed a form.
 */
const RumorRowView: React.FC<RumorRowViewProps> = ({ rumor, name, pointsAt, onStatusChange, onOpenQuest }) => (
  <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-7 pt-4">
    <div className="flex flex-col gap-4">
      <RosterField label="What was heard" emptyText="Nothing written down">
        {rumor.content ? <Typography variant="body-sm">{rumor.content}</Typography> : undefined}
      </RosterField>

      <RosterField label="Heard from" emptyText="Nobody said">
        {rumor.sourceType || rumor.sourceName ? (
          <Typography variant="body-sm">
            {[rumor.sourceType && formatSourceType(rumor.sourceType), rumor.sourceName].filter(Boolean).join(" · ")}
          </Typography>
        ) : undefined}
      </RosterField>

      <StateLadder
        label="Is it true?"
        options={RUMOR_STATUS_OPTIONS}
        value={normalizeRumorStatus(rumor.status)}
        ariaLabel={`Status of ${name}`}
        onChange={async (status) => {
          await onStatusChange(status);
        }}
      />
    </div>

    <div className="flex flex-col gap-4">
      <RosterField label="Points at" emptyText="Nothing yet">
        {pointsAt.length ? <Typography variant="body-sm">{pointsAt.join(", ")}</Typography> : undefined}
      </RosterField>

      {rumor.convertedToQuestId && (
        <RosterField label="Became a quest">
          <button
            type="button"
            onClick={() => onOpenQuest(rumor.convertedToQuestId!)}
            className="self-start text-left px-2.5 py-1.5 rounded-md selectable-item"
          >
            <Typography variant="body-sm">Open the quest</Typography>
          </button>
        </RosterField>
      )}
    </div>
  </div>
);

export default RumorRowView;
