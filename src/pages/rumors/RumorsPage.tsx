// src/pages/rumors/RumorsPage.tsx
import React from "react";
import { RumorDirectory, RumorExample, useRumors } from "features/campaign-entities";
import { usePageGate, GatedContent } from "shared/components/gated";
import PageShell from "shared/components/page-shell/PageShell";

/**
 * Rumors index.
 *
 * `RumorDirectory` carries the progress bar, the category chips, the search
 * field and bulk-select. Rendering it over an empty array — which is what the
 * signed-out page used to do — put five controls on screen that could not act,
 * which reads as broken rather than as gated. `GatedContent` renders it only
 * in the `ready` state.
 *
 * It carries no *Add Rumor* action: `15-7` put a composer at the top of the
 * list, and a second way in that leaves for `/rumors/create` would be the
 * page contradicting the control directly below it.
 */
const RumorsPage: React.FC = () => {
  const { rumors, isLoading, loadError } = useRumors();

  const gate = usePageGate("rumors", {
    /*
      `isLoading` already means "there is nothing to show yet" rather than "a
      fetch is in flight": `useRumorData` draws that line now, for every
      consumer at once, so this page no longer has to draw it again. The rule
      and the measurement behind it are on `useQuestData`.
    */
    loading: isLoading,
    error: loadError,
  });

  return (
    <PageShell
      title="Rumours"
      subtitle="Track and investigate rumours from across the realm"
    >
      <GatedContent gate={gate} signedOutExample={<RumorExample />}>
        <RumorDirectory rumors={rumors} isLoading={false} />
      </GatedContent>
    </PageShell>
  );
};

export default RumorsPage;
