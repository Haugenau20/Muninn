// src/features/campaign-entities/rumors/components/CombineRumorsDialog.tsx
import React, { useState, useEffect } from 'react';
import { TEXT_LIMITS } from 'core/constants/textLimits';
import { Rumor, RumorStatus } from '../types';
import Dialog from '../../../../core/components/Dialog';
import Typography from '../../../../core/components/Typography';
import Button from '../../../../core/components/Button';
import Input from '../../../../core/components/Input';
import Select from '../../../../core/components/Select';
import { X, Layers, AlertCircle } from 'lucide-react';
import { rumorParagraph, rumorTitleText } from '../utils/rumor-title';

interface CombineRumorsDialogProps {
  open: boolean;
  onClose: () => void;
  rumorIds: string[];
  rumors: Rumor[];
  /** Resolves with the rumour combined into, or null when nothing was (T163). */
  onCombine: (rumorIds: string[], newRumor: Partial<Rumor>) => Promise<string | null>;
}

/**
 * Dialog for combining multiple rumors into a single new rumor
 */
const CombineRumorsDialog: React.FC<CombineRumorsDialogProps> = ({
  open,
  onClose,
  rumorIds,
  rumors,
  onCombine
}) => {

  // Form state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<RumorStatus>('unconfirmed');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedRumorIds, setSelectedRumorIds] = useState<string[]>([]);

  // Pre-populate the form based on the selected rumors
  useEffect(() => {
    if (open && rumorIds.length > 0) {
      setSelectedRumorIds(rumorIds);
      
      // Generate a default title based on the date
      const now = new Date().toLocaleDateString();
      setTitle(`Combined Rumour (${now})`);
      
      // Combine content from all selected rumors
      const rumorsToMerge = rumorIds
        .map(id => rumors.find(r => r.id === id))
        .filter(Boolean) as Rumor[];
      
      const combinedContent = rumorsToMerge.map(rumor => 
        rumorParagraph(rumor, { attributed: true })
      ).join('\n\n');
      
      setContent(combinedContent);
    }
  }, [open, rumorIds, rumors]);

  // Remove a rumor from the selection
  const handleRemoveRumor = (rumorId: string) => {
    setSelectedRumorIds(prev => prev.filter(id => id !== rumorId));
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (selectedRumorIds.length < 2) {
      setError('Please select at least 2 rumours to combine');
      return;
    }

    if (!title || !content) {
      setError('Title and content are required');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const combined = await onCombine(selectedRumorIds, {
        title,
        content,
        status
      });

      // Cancelled at "already exists": the choices stay as they were.
      if (combined !== null) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to combine rumours');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get selected rumors objects
  const selectedRumors = selectedRumorIds
    .map(id => rumors.find(r => r.id === id))
    .filter(Boolean) as Rumor[];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Combine Rumours"
      maxWidth="max-w-3xl"
    >
      <div className="space-y-6">
        {/* Selected Rumors */}
        <div>
          <Typography variant="h4" className="mb-3">
            Selected Rumours
          </Typography>
          {selectedRumors.length > 0 ? (
            <div className="space-y-2 max-h-40 overflow-y-auto p-2 border rounded-lg card-content">
              {selectedRumors.map(rumor => (
                <div
                  key={rumor.id}
                  className="flex items-center justify-between p-2 rounded-lg selectable-item"
                >
                  <div className="flex-1">
                    <Typography variant="body-sm" className="font-medium">
                      {rumorTitleText(rumor)}
                    </Typography>
                    <Typography variant="body-sm" color="secondary">
                      Source: {rumor.sourceName}
                    </Typography>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveRumor(rumor.id)}
                    disabled={isSubmitting || selectedRumorIds.length <= 2}
                  >
                    <X size={16} />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Typography color="secondary">
              No rumours selected. Please select at least 2 rumours to combine.
            </Typography>
          )}
        </div>

        {/* Combined Rumor Form */}
        <div className="space-y-4">
          <Typography variant="h4">
            Combined Rumour
          </Typography>

          <Input
            label="Title *"
            value={title}
            maxLength={TEXT_LIMITS.line}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={isSubmitting}
          />

          <Input
            label="Content *"
            value={content}
            maxLength={TEXT_LIMITS.text}
            onChange={(e) => setContent(e.target.value)}
            isTextArea
            required
            disabled={isSubmitting}
          />

          <div>
            <Select
              label="Status *"
              value={status}
              onChange={(e) => setStatus(e.target.value as RumorStatus)}
              required
              disabled={isSubmitting}
            >
              <option value="unconfirmed">Unconfirmed</option>
              <option value="confirmed">Confirmed</option>
              <option value="false">False</option>
            </Select>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-center gap-2 form-error">
            <AlertCircle size={16} />
            <Typography color="error">{error}</Typography>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || selectedRumorIds.length < 2}
            startIcon={<Layers />}
            isLoading={isSubmitting}
          >
            Combine Rumours
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default CombineRumorsDialog;