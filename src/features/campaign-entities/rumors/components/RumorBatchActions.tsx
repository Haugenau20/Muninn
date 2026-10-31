// src/features/campaign-entities/rumors/components/RumorBatchActions.tsx
import React, { useState } from 'react';
import Button from '../../../../core/components/Button';
import { RosterBatchBar } from 'core/components/Roster';
import { JoinOptions, RumorStatus } from '../types';
import { useRumors } from '../context/RumorContext';
import { useQuests } from '../../quests/context/QuestContext';
import { SameNameError, SameNameKind, findSameNamed, isSameName } from '../../shared/sameName';
import { describeMerge, planMerge } from '../../shared/mergeRecords';
import { useSameNameDialog } from 'shared/components/same-name/useSameNameDialog';
import { recordHref } from 'shared/components/same-name/SameNameDialog';
import DeleteConfirmationDialog from 'shared/components/DeleteConfirmationDialog';
import { useNavigation } from 'shared/hooks/useNavigation';
import { 
  CheckCircle, 
  HelpCircle, 
  XCircle, 
  Layers, 
  MessageSquare, 
  Trash
} from 'lucide-react';
import CombineRumorsDialog from './CombineRumorsDialog';
import ConvertToQuestDialog from './ConvertToQuestDialog';

interface RumorBatchActionsProps {
  selectedRumors: Set<string>;
  onComplete?: () => void;
}

/**
 * Component that displays and handles batch actions for rumors.
 * Appears when selection mode is active and rumors are selected.
 */
const RumorBatchActions: React.FC<RumorBatchActionsProps> = ({
  selectedRumors,
  onComplete
}) => {
  const { rumors, updateRumorsStatus, deleteRumors, combineRumors, convertToQuest } = useRumors();
  const { navigateToPage } = useNavigation();
  const sameName = useSameNameDialog();

  // Dialog state
  const [showCombineDialog, setShowCombineDialog] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  // The quests, while converting: the title is checked against them (T163).
  const { quests } = useQuests({ subscribe: showConvertDialog });
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Selected rumors
  const selectedRumorIds = Array.from(selectedRumors);
  const selectedRumorObjects = rumors.filter(rumor => selectedRumors.has(rumor.id));

  // Batch status update
  const handleBatchStatusUpdate = async (status: RumorStatus) => {
    try {
      setIsProcessing(true);
      setActionError(null);

      // One write for the whole selection (T032, PERF-06).
      await updateRumorsStatus(selectedRumorIds, status);

      onComplete?.();
    } catch (err) {
      setActionError(`Failed to update rumour status: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error('Failed to update rumour status:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Batch delete
  const handleBatchDelete = async () => {
    setShowDeleteConfirmation(true);
  };

  // Confirm delete
  const confirmDelete = async () => {
    try {
      setIsProcessing(true);
      setActionError(null);

      // One write for the whole selection (T032, PERF-06).
      await deleteRumors(selectedRumorIds);

      setShowDeleteConfirmation(false);
      onComplete?.();
    } catch (err) {
      setActionError(`Failed to delete rumours: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error('Failed to delete rumours:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * A combine or a conversion whose title a record already carries (T163):
   * ask, then add to that record (`into`), go ahead under the name chosen,
   * or stop. Another name is checked again; the same one kept makes a
   * second record.
   *
   * @param kind What the title names: the combined rumour, or the quest
   * @param title The title as written
   * @param incoming What the new record would say, for the dialog's list
   * @param run The combine or the conversion, under a title and options
   * @returns The record joined into, or null when nothing was written
   */
  const joinAsking = async (
    kind: Extract<SameNameKind, 'rumor' | 'quest'>,
    title: string,
    incoming: object,
    run: (title: string, options: JoinOptions) => Promise<string>
  ): Promise<string | null> => {
    let name = title;
    let options: JoinOptions = { askOnSameName: true };
    for (;;) {
      try {
        // The rumours are checked by the context, which holds them; the
        // quests here, where they are read.
        const twin = kind === 'quest' && options.askOnSameName ? findSameNamed('quest', name, quests) : undefined;
        if (twin) throw new SameNameError('quest', twin.id, twin.title);
        return await run(name, options);
      } catch (err) {
        if (!(err instanceof SameNameError)) throw err;
        const existing = (kind === 'quest' ? quests : rumors).find(record => record.id === err.existingId);
        const choice = await sameName.ask({
          kind,
          name,
          existingId: err.existingId,
          existingName: err.existingName,
          preview: existing ? describeMerge(planMerge(kind, existing, incoming)) : null,
          createVerb: kind === 'quest' ? 'Convert' : 'Combine',
          isNested: true,
        });
        if (choice.action === 'cancel') return null;
        if (choice.action === 'open') {
          setShowCombineDialog(false);
          setShowConvertDialog(false);
          navigateToPage(recordHref(kind, err.existingId));
          return null;
        }
        if (choice.action === 'merge') {
          options = { into: err.existingId };
        } else {
          options = { askOnSameName: !isSameName(choice.name, name) };
          name = choice.name;
        }
      }
    }
  };

  // Handle combine rumors
  const handleCombineSubmit = async (rumorIds: string[], newRumor: any) => {
    try {
      setIsProcessing(true);
      setActionError(null);

      const newRumorId = await joinAsking('rumor', newRumor.title ?? '', newRumor, (title, options) =>
        combineRumors(rumorIds, { ...newRumor, title }, options)
      );
      if (newRumorId === null) return null;
      setShowCombineDialog(false);
      onComplete?.();
      return newRumorId;
    } catch (err) {
      setActionError(`Failed to combine rumours: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error('Failed to combine rumours:', err);
      throw err;
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle convert to quest
  const handleConvertSubmit = async (rumorIds: string[], questData: any) => {
    try {
      setIsProcessing(true);
      setActionError(null);

      const questId = await joinAsking('quest', questData.title ?? '', questData, (title, options) =>
        convertToQuest(rumorIds, { ...questData, title }, options)
      );
      if (questId === null) return null;
      setShowConvertDialog(false);
      onComplete?.();
      // The quest that was just authored, at its own address (`15-5` item 11).
      // Conversion used to leave you in the rumour list with the new quest
      // nowhere on screen -- the record existed and nothing linked to it.
      navigateToPage(`/quests/${questId}`);
      return questId;
    } catch (err) {
      setActionError(`Failed to convert rumours to quest: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error('Failed to convert rumours to quest:', err);
      throw err;
    } finally {
      setIsProcessing(false);
    }
  };

  if (selectedRumors.size === 0) {
    return null;
  }

  // Create portal elements for dialogs to render them at the root level
  const portalElements = (
    <>
      {/* Render dialogs in portal to make them appear above everything */}
        <>
          <CombineRumorsDialog
            open={showCombineDialog}
            onClose={() => setShowCombineDialog(false)}
            rumorIds={selectedRumorIds}
            rumors={selectedRumorObjects}
            onCombine={handleCombineSubmit}
          />

          <ConvertToQuestDialog
            open={showConvertDialog}
            onClose={() => setShowConvertDialog(false)}
            rumorIds={selectedRumorIds}
            rumors={selectedRumorObjects}
            onConvert={handleConvertSubmit}
          />

          <DeleteConfirmationDialog
            isOpen={showDeleteConfirmation}
            onClose={() => setShowDeleteConfirmation(false)}
            onConfirm={confirmDelete}
            itemName={`${selectedRumors.size} rumours`}
            itemType="Rumour"
            message={`Are you sure you want to delete ${selectedRumors.size} rumours? This cannot be undone.`}
          />

          {sameName.dialog}
        </>
    </>
  );

  return (
    <>
      <RosterBatchBar label={`${selectedRumors.size} rumours selected`} error={actionError}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleBatchStatusUpdate('confirmed')}
          startIcon={<CheckCircle size={16} className="feedback-success" />}
          disabled={isProcessing}
        >
          Mark Confirmed
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleBatchStatusUpdate('unconfirmed')}
          startIcon={<HelpCircle size={16} className="feedback-warning" />}
          disabled={isProcessing}
        >
          Mark Unconfirmed
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleBatchStatusUpdate('false')}
          startIcon={<XCircle size={16} className="feedback-error" />}
          disabled={isProcessing}
        >
          Mark False
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowCombineDialog(true)}
          startIcon={<Layers size={16} />}
          disabled={selectedRumors.size < 2 || isProcessing}
        >
          Combine
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowConvertDialog(true)}
          startIcon={<MessageSquare size={16} />}
          disabled={isProcessing}
        >
          Convert to Quest
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleBatchDelete}
          startIcon={<Trash size={16} className="feedback-error" />}
          disabled={isProcessing}
        >
          Delete
        </Button>
      </RosterBatchBar>

      {/* Render portals for dialogs */}
      {portalElements}
    </>
  );
};

export default RumorBatchActions;