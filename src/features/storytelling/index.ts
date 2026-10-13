// src/features/storytelling/index.ts
export { StoryProvider, useStory } from './chapters/context/StoryContext';
export { useChapterData } from './chapters/hooks/useChapterData';
export { useChapterContent } from './chapters/hooks/useChapterContent';
export { readChapterContent } from './chapters/utils/chapter-body';
export { useSagaData } from './sagas/hooks/useSagaData';
export type { Chapter, ChapterProgress, StoryProgress, StoryContextState, StoryContextValue } from './chapters/types';
export type { SagaData, SagaContentInput, SagaContextState, SagaContextValue } from './sagas/types';
// Chapter progress and bylines, as the story pages show them
export {
  deriveChapterProgress,
  summariseProgress,
  filterChapters,
} from './chapters/utils/chapter-progress';
export type { StorySummary, ChapterReadState } from './chapters/utils/chapter-progress';
export { deriveChapterByline } from './chapters/utils/chapter-byline';
// Components (used by pages/story/* and other consumers)
// BookViewer is the paginated book surface, now used only by SagaPage — the
// saga is one continuous work, so it keeps the page-turning presentation.
// Chapters read through ChapterReader instead, which scrolls.
export { default as BookViewer } from './stories/components/BookViewer';
export { default as BookshelfView } from './stories/components/BookshelfView';
export { default as ChapterList } from './stories/components/ChapterList';
export { default as ChapterBrowser } from './stories/components/ChapterBrowser';
export type { ChapterViewMode, ChapterFilterMode } from './stories/components/ChapterBrowser';
// Lazy: the example campaign loads only for a signed-out visitor.
export { ChapterExample } from './stories/example';
export { default as ChapterRail } from './stories/components/ChapterRail';
export { default as ChapterReader } from './stories/components/ChapterReader';
export { default as ChapterForm } from './chapters/components/ChapterForm';
