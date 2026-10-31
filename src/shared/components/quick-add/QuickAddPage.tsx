// src/shared/components/quick-add/QuickAddPage.tsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Button from "core/components/Button";
import Breadcrumb from "shared/components/Breadcrumb";
import { usePageGate, GatedContent } from "shared/components/gated";
import type { GatedPageKey } from "shared/components/gated";
import PageShell from "shared/components/page-shell/PageShell";
import QuickAddForm from "./QuickAddForm";
import { QUICK_ADD_SPECS, splitInitialData, type QuickAddEntity } from "./quickAddSpecs";

export interface QuickAddPageProps {
  entity: QuickAddEntity;
  /** The gate's page key, e.g. "npcs". */
  gateKey: GatedPageKey;
  /** The directory this page belongs to, e.g. "/npcs". */
  sectionPath: string;
  /** The directory's name in the breadcrumb, e.g. "NPCs". */
  sectionLabel: string;
}

/**
 * Quick add's route mount: the same form, centred on an otherwise empty page.
 *
 * The route is kept because note conversion navigates to it and because a
 * pasted `/npcs/create` link has to land somewhere (`15-1` item 2). It is the
 * third mount of one component, not a second component -- the only things that
 * differ from the dialog are the chrome around it and the fact that a page can
 * be reached while signed out, which is why the gate stays.
 */
const QuickAddPage: React.FC<QuickAddPageProps> = ({
  entity,
  gateKey,
  sectionPath,
  sectionLabel,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const gate = usePageGate(gateKey, { mode: "write" });

  // Note conversion's handoff: it arrives as router state, and
  // `noteId`/`entityId` travel beside the payload to `convertInto`, which
  // marks the entity in the same commit as the record (T088).
  const noteId = location.state?.noteId as string | undefined;
  const entityId = location.state?.entityId as string | undefined;
  // The extraction's "Add as private" (T163).
  const initialPrivate = location.state?.private === true;
  const { initialName, initialLine, carry, parentId } = splitInitialData(
    entity,
    location.state?.initialData
  );

  const handleCancel = () => {
    navigate(noteId ? `/notes/${noteId}` : sectionPath);
  };

  return (
    <PageShell
      title={QUICK_ADD_SPECS[entity].labels.title}
      breadcrumb={
        <Breadcrumb
          items={[{ label: sectionLabel, href: sectionPath }, { label: "Create" }]}
          className="mb-4"
        />
      }
    >
      <div className="mb-8">
        <Button
          variant="ghost"
          onClick={handleCancel}
          startIcon={<ArrowLeft className="w-4 h-4" />}
        >
          Back to {noteId ? "Note" : sectionLabel}
        </Button>
      </div>

      <GatedContent gate={gate}>
        <div className="max-w-lg mx-auto">
          <QuickAddForm
            entity={entity}
            parentId={parentId}
            noteId={noteId}
            entityId={entityId}
            carry={carry}
            initialName={initialName}
            initialLine={initialLine}
            initialPrivate={initialPrivate}
            onCancel={handleCancel}
            // The page has a Back control of its own above the form and a
            // breadcrumb before that; stealing focus past both would skip the
            // page's own reading order.
            autoFocus={false}
          />
        </div>
      </GatedContent>
    </PageShell>
  );
};

export default QuickAddPage;
