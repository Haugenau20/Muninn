// src/features/collaboration/index.ts

// Note context and hooks
export { NoteProvider, useNotes } from './notes/context/NoteContext';
export { useCreateNote } from './notes/hooks/useCreateNote';
// Note presentation helpers — pure, no Firebase, safe for any consumer.
export { deriveTitle, displayTitle, MAX_DERIVED_TITLE_LENGTH, LEGACY_DEFAULT_TITLE } from './notes/utils/note-title';
export { matchesInText } from './notes/utils/entity-matching';
export { formatLastSaved } from './notes/utils/save-status';
// Components consumed by pages/notes/* and other external consumers
export { default as NotesList } from './notes/components/NotesList';
// Lazy: the example campaign loads only for a signed-out visitor.
export { NoteExample } from './notes/example';
export { default as NoteEditor } from './notes/components/NoteEditor';
export { default as NoteCard } from './notes/components/NoteCard';
export { default as NoteReferences } from './notes/components/NoteReferences';
export { default as CampaignLinksPanel } from './notes/components/CampaignLinksPanel';
export { useNoteReferences } from './notes/components/NoteReferences';
export type { NoteEditorRef } from './notes/components/NoteEditor';
// Named helpers re-exported from NoteReferences for consumers outside the
// collaboration domain
export type { PotentialReference } from './notes/components/NoteReferences';
export { normalizeTextForComparison } from './notes/components/NoteReferences';
// Note types
export type { Note, NoteStatus, ExtractedEntity, EntityType, NoteContextValue } from './notes/types';

// Entity extraction: usage context and hooks
export { UsageProvider, useUsageContext } from './entity-extraction/context/UsageContext';
export { useEntityExtractor } from './entity-extraction/hooks/useEntityExtractor';
// Entity extraction components consumed by pages/notes/*
export { default as UsageMeter } from './entity-extraction/components/UsageMeter';
export { default as EntityCard } from './entity-extraction/components/EntityCard';
// Entity extraction / usage types
export type {
  UsagePeriod,
  PeriodUsage,
  EntityExtractionUsage,
  UsageStatus,
  UsageLimitError,
} from './entity-extraction/types';

// NOTE: `entity-extraction/services/EntityExtractionService` and
// `entity-extraction/services/entityMapper` are deliberately NOT re-exported
// here. Both import only direct service files (`services/firebase/core/*`,
// `services/openai/types`), not the `services/firebase` index, so they don't
// carry the eager-Firebase-init hazard described above — but they currently
// have no consumers outside this domain (only used via the useEntityExtractor
// hook and UsageContext, both already re-exported).
// Import by path if that changes.
