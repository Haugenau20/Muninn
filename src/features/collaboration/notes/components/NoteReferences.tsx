// src/features/collaboration/notes/components/NoteReferences.tsx
import React, { useEffect, useMemo } from "react";
import { EntityType } from "../types";
import Typography from "../../../../core/components/Typography";
import Card from "../../../../core/components/Card";
import { useNavigation } from "shared/hooks/useNavigation";
import { useNotes } from "../context/NoteContext";
import { useCampaigns } from "features/user-management";
import { useNPCs, useLocations, useQuests, useRumors } from "features/campaign-entities";
import { matchesInText } from "../utils/entity-matching";
import { entityPath } from "../utils/entity-path";
import { Loader2, Users, MapPin, Scroll, MessageSquare } from 'lucide-react';

export interface PotentialReference {
  id: string;
  type: EntityType;
  title: string;
  name?: string;
  matchingText: string[];
}

interface NoteReferencesProps {
  /** ID of the note to find references for */
  noteId: string;
  /** Callback to expose found references */
  onReferencesFound?: (references: PotentialReference[]) => void;
  /** Callback when reference search is complete (regardless of results) */
  onSearchComplete?: () => void;
}

/**
 * Normalize text for consistent comparison. Lives in `core` since T163, so
 * the campaign records' "already exists" check compares names the same way.
 */
export { normalizeTextForComparison } from 'core/utils/text-comparison';

/** One entity as the matcher sees it: an id, a type, and the names to test. */
interface MatchCandidate {
  id: string;
  type: EntityType;
  /** Preferred display label. */
  title: string;
  name?: string;
  /** Every string worth testing against the note, most specific first. */
  candidates: string[];
}

/**
 * Campaign entities that actually appear in a note's text.
 *
 * Reads the four collections from their contexts rather than issuing four
 * `DocumentService.getCollection` calls on every note open, and tests each
 * name once against the raw note body with `matchesInText`. The previous
 * implementation re-normalized the entire note once per entity and matched on
 * dash-joined text, which let a match run across a sentence boundary.
 */
export function useNoteReferences(noteId: string): {
  references: PotentialReference[];
  isLoading: boolean;
} {
  const { getNoteById } = useNotes();
  const { activeCampaignId } = useCampaigns();
  const { npcs, isLoading: npcsLoading } = useNPCs();
  const { locations, isLoading: locationsLoading } = useLocations();
  const { quests, isLoading: questsLoading } = useQuests();
  const { rumors, isLoading: rumorsLoading } = useRumors();

  const note = getNoteById(noteId);
  const noteContent = note?.content ?? "";

  const isLoading =
    !activeCampaignId || npcsLoading || locationsLoading || questsLoading || rumorsLoading;

  const references = useMemo<PotentialReference[]>(() => {
    if (!noteContent || !activeCampaignId) return [];

    const build = (
      items: Array<Record<string, any>>,
      type: EntityType,
      fallback: string
    ): MatchCandidate[] =>
      items.map(item => ({
        id: item.id,
        type,
        title: item.name || item.title || fallback,
        name: item.name,
        // Both fields are tested, de-duplicated, empties dropped.
        candidates: Array.from(
          new Set([item.name, item.title].filter((value): value is string => !!value))
        ),
      }));

    const all: MatchCandidate[] = [
      ...build(npcs as any[], "npc", "Unnamed NPC"),
      ...build(locations as any[], "location", "Unnamed Location"),
      ...build(quests as any[], "quest", "Unnamed Quest"),
      ...build(rumors as any[], "rumor", "Unnamed Rumour"),
    ];

    return all.reduce<PotentialReference[]>((found, entity) => {
      const matchingText = entity.candidates.filter(candidate =>
        matchesInText(noteContent, candidate)
      );

      if (matchingText.length > 0) {
        found.push({
          id: entity.id,
          type: entity.type,
          title: entity.title,
          name: entity.name,
          matchingText,
        });
      }

      return found;
    }, []);
  }, [noteContent, activeCampaignId, npcs, locations, quests, rumors]);

  return { references, isLoading };
}

/**
 * Component for finding and displaying potential campaign element references in notes
 */
const NoteReferences: React.FC<NoteReferencesProps> = ({ noteId, onReferencesFound, onSearchComplete }) => {
  const { navigateToPage } = useNavigation();
  const { references, isLoading } = useNoteReferences(noteId);

  // Notify parent when references are found / search completes.
  useEffect(() => {
    if (onReferencesFound) {
      onReferencesFound(references);
    }
    if (!isLoading && onSearchComplete) {
      onSearchComplete();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [references, isLoading]);

  /**
   * Navigate to the entity's own page, or to its directory row for a rumour
   * -- see `entityPath`.
   */
  const navigateToEntity = (reference: PotentialReference) => {
    navigateToPage(entityPath(reference.type, reference.id));
  };

  /**
   * Get entity type display name
   */
  const getEntityTypeName = (type: EntityType): string => {
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
  };

  /**
   * Get icon for entity type
   */
  const getEntityIcon = (type: EntityType): React.ReactNode => {
    switch (type) {
      case "npc":
        return <Users className="w-5 h-5" />;
      case "location":
        return <MapPin className="w-5 h-5" />;
      case "quest":
        return <Scroll className="w-5 h-5" />;
      case "rumor":
        return <MessageSquare className="w-5 h-5" />;
      default:
        return null;
    }
  };

  return (
    <Card className="note-references">
      <Card.Content>
        <Typography variant="h4" className="mb-4">
          Campaign References Found
        </Typography>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 mr-3 animate-spin primary" />
            <Typography color="secondary">Searching for references...</Typography>
          </div>
        )}

        {/* References list */}
        {!isLoading && references.length > 0 && (
          <div className="space-y-2">
            {references.map((reference, index) => (
              <div
                key={`${reference.type}-${reference.id}-${index}`}
                className="flex items-center justify-between p-3 card transition-colors reference-item"
              >
                <div
                  className="flex items-center gap-3 flex-1 cursor-pointer"
                  onClick={() => navigateToEntity(reference)}
                >
                  <div className="primary">
                    {getEntityIcon(reference.type)}
                  </div>
                    <div className="flex justify-between w-full">
                    <Typography variant="body" className="font-medium">
                      {reference.title}
                    </Typography>
                    <Typography variant="body-sm" color="secondary" className="italic">
                      {getEntityTypeName(reference.type)}
                    </Typography>
                    </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && references.length === 0 && (
          <Typography color="secondary">
            No campaign elements found that match content in this note
          </Typography>
        )}
      </Card.Content>
    </Card>
  );
};

export default NoteReferences;
