// src/pages/notes/NotesPage.tsx
import React from "react";
import Button from "core/components/Button";
import { NotesList, NoteExample, useNotes, useCreateNote } from "features/collaboration";
import { useCampaigns } from "features/user-management";
import { usePageGate, GatedContent } from "shared/components/gated";
import PageShell from "shared/components/page-shell/PageShell";
import { Plus } from "lucide-react";

/**
 * Notes index.
 *
 * Uses the `notes` page key, whose `requires` is `"campaign"` — `NoteContext`
 * sets `filteredNotes = []` whenever there is no `activeCampaignId` ("If no
 * active campaign, show no notes"), so a member with a group but no campaign
 * chosen has nothing to read and belongs on the campaign picker, not here.
 * (This page used to gate on `"group"` alone, on the mistaken belief that
 * `NoteContext` only *filtered* by campaign rather than discarding everything
 * without one.)
 *
 * The header action is additionally gated on `activeCampaignId`, which is now
 * redundant with the page-level gate above but kept as a direct guard on the
 * write path itself.
 */
const NotesPage: React.FC = () => {
  const { isLoading } = useNotes();
  const { activeCampaignId, activeCampaign } = useCampaigns();
  const { createAndOpen } = useCreateNote();

  const gate = usePageGate("notes", { loading: isLoading });

  return (
    <PageShell
      className="notes-page"
      title="Notes"
      subtitle={
        activeCampaign
          ? `Your private notes for ${activeCampaign.name}. Only you can read them.`
          : "Your private notes. Only you can read them."
      }
      actions={
        gate.canAct &&
        activeCampaignId && (
          <Button
            onClick={createAndOpen}
            variant="primary"
            className="create-note-button"
            startIcon={<Plus className="w-5 h-5" />}
          >
            New note
          </Button>
        )
      }
    >
      <GatedContent gate={gate} signedOutExample={<NoteExample />}>
        <NotesList />
      </GatedContent>
    </PageShell>
  );
};

export default NotesPage;
