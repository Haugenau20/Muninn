// src/features/collaboration/notes/components/NoteSheet.tsx
import React from "react";
import { ArrowLeft, Archive, Trash2 } from "lucide-react";
import Input from "../../../../core/components/Input";
import Typography from "../../../../core/components/Typography";

/** Props for {@link NoteSheet}. */
export interface NoteSheetProps {
  title: string;
  content: string;
  /** Absent, the title can be read and not changed. */
  onTitleChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  /** Absent, the body can be read and not changed. */
  onContentChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** Turns the fields, Archive and Delete off: a note this reader may not change. */
  disabled?: boolean;
  onBack?: () => void;
  backDisabled?: boolean;
  onArchive?: () => void;
  onDelete?: () => void;
  /** Under the title: where it came from, when it was not written. */
  titleCaption?: React.ReactNode;
  /** The footer's left side: whether it is saved. */
  status: React.ReactNode;
  /** The footer's right side: the word count, and how to save. */
  footerNote: string;
  bodyRef?: React.Ref<HTMLTextAreaElement>;
}

/** How many words a note holds, as its footer counts them. */
export const countWords = (content: string): number =>
  content.trim() ? content.trim().split(/\s+/).length : 0;

/**
 * The sheet a note is written on: the top bar, the title, the body and the
 * footer. `NoteEditor` holds the note, saves it and fills this in; the notes
 * page's signed-out example fills it with a note that is never saved.
 */
const NoteSheet: React.FC<NoteSheetProps> = ({
  title,
  content,
  onTitleChange,
  onContentChange,
  disabled = false,
  onBack,
  backDisabled = false,
  onArchive,
  onDelete,
  titleCaption,
  status,
  footerNote,
  bodyRef,
}) => (
  <div className="note-editor card rounded-xl flex flex-col min-h-[70vh]">
    {/* Top bar */}
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b card-divider text-[13px]">
      <button
        type="button"
        onClick={onBack}
        disabled={backDisabled}
        className="flex items-center gap-1.5 typography-secondary hover:underline disabled:opacity-50"
      >
        <ArrowLeft className="w-4 h-4" />
        All notes
      </button>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onArchive}
          disabled={disabled}
          className="flex items-center gap-1.5 typography-secondary hover:underline disabled:opacity-50"
        >
          <Archive className="w-4 h-4" />
          Archive
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          className="flex items-center gap-1.5 typography-error hover:underline disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>
    </div>

    {/* The writing itself */}
    <div className="flex-1 flex flex-col px-8 py-6">
      {/*
        `text-ellipsis` on an input renders the "…" only while the field is
        unfocused, which is exactly the behaviour wanted here: a long title
        reads with a clear truncation mark, and clicking in to edit reveals
        the whole value. Without it the title clips mid-letter
        ("...at the Stonehill Inn in P") with nothing to signal that more
        text exists. This covers explicit titles too, which are uncapped.
      */}
      <input
        value={title}
        onChange={onTitleChange}
        readOnly={!onTitleChange}
        placeholder="Untitled note"
        disabled={disabled}
        aria-label="Note title"
        className="note-title w-full bg-transparent border-none outline-none typography-heading text-[30px] font-medium placeholder:opacity-40 overflow-hidden text-ellipsis whitespace-nowrap"
      />

      {titleCaption}

      {/*
        On the primitive every other field uses (09-2, item 5), with its
        visible label: the control was already named for a screen reader by
        its `aria-label`, so that attribute went rather than sitting on top of
        a real label element and shadowing it.
      */}
      <Input
        ref={bodyRef as React.Ref<HTMLTextAreaElement>}
        isTextArea
        label="Note content"
        value={content}
        onChange={onContentChange}
        readOnly={!onContentChange}
        placeholder="Write your note here..."
        disabled={disabled}
        fullWidth
        containerClassName="flex-1 mt-5"
        className="note-textarea flex-1 resize-none text-[17px] leading-[1.65] placeholder:opacity-40"
        style={{ minHeight: "40vh" }}
      />
    </div>

    {/* Footer: save state stated once, and only once */}
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t card-divider bg-secondary text-[13px]">
      {status}
      <Typography variant="body-sm" color="secondary" className="text-[13px]">
        {footerNote}
      </Typography>
    </div>
  </div>
);

export default NoteSheet;
