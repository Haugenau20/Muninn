// src/pages/npcs/NPCsPage.tsx
import React from "react";
import Button from "core/components/Button";
import { NPCDirectory, NPCExample, useNPCs } from "features/campaign-entities";
import { usePageGate, GatedContent } from "shared/components/gated";
import PageShell from "shared/components/page-shell/PageShell";
import { useNavigation } from "shared/context/NavigationContext";
import { Plus } from "lucide-react";

/**
 * NPCs index.
 *
 * The `contextError` memo that used to live here — and, identically, in
 * `NPCContext` — is gone: the page renders whatever `usePageGate` says the
 * state is, and the words come from `gated-page-copy`. The retry handler is
 * wired through so the shared error panel's "Try again" button re-fetches
 * this page's own data instead of only the generic gate.
 *
 * It reads `useNPCs()` rather than `useNPCData()`: the page and the provider
 * used to hold two independently fetched copies of the same collection, so a
 * write through the context refreshed one while the page rendered the other.
 */
const NPCsPage: React.FC = () => {
  const { navigateToPage } = useNavigation();
  // Reads the provider this page writes through, rather than a second loader
  // of its own. Two independently fetched copies meant a write updated one and
  // the page rendered the other (T046).
  const { npcs, isLoading, loadError, refreshNPCs } = useNPCs();

  const gate = usePageGate("npcs", {
    loading: isLoading,
    error: loadError,
    onRetry: () => {
      void refreshNPCs();
    },
  });

  return (
    <PageShell
      title="NPCs"
      subtitle="Keep track of all the characters you've met in your adventures"
      actions={
        gate.canAct && (
          <Button
            onClick={() => navigateToPage("/npcs/create")}
            startIcon={<Plus className="w-5 h-5" />}
          >
            Add NPC
          </Button>
        )
      }
    >
      <GatedContent gate={gate} signedOutExample={<NPCExample />}>
        {/*
          No `onNPCUpdate` or `onNPCDelete`: the list is the provider's
          listener copy (T032), which follows every write without being asked.
        */}
        <NPCDirectory npcs={npcs} />
      </GatedContent>
    </PageShell>
  );
};

export default NPCsPage;
