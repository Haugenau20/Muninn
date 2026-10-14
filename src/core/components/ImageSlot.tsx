// src/core/components/ImageSlot.tsx
import React from 'react';
import clsx from 'clsx';
import { PictureSource, StoredImage } from '../types/storedImage';
import { isOwnBucketUrl } from '../services/firebase/storage/ImageStorageService';

export interface ImageSlotProps {
  /**
   * What a screen reader is told while the slot is empty. Must state the
   * *state* honestly -- that no image has been added -- rather than describing
   * an image that is not there.
   */
  label: string;
  /** A quiet line inside the band, for slots large enough to carry one. */
  caption?: string;
  /** The image to show, when one has been added. */
  image?: StoredImage | null;
  /** Alt text for `image`, e.g. "Portrait of Odile Marrow". */
  alt?: string;
  /**
   * A picture the app ships, drawn while there is no `image` (or it was
   * refused) instead of the ruled empty slot. It is decoration, not the
   * subject's picture, so the slot keeps `label` as its name -- which still
   * says that nothing has been added.
   */
  fallback?: PictureSource | null;
  /**
   * "eager" for a picture at the top of its page, where lazy loading only
   * delays what is already in view. Defaults to "lazy".
   */
  loading?: 'lazy' | 'eager';
  className?: string;
}

/**
 * The space where an entity's image goes.
 *
 * **Empty is the common state**, and it has to look deliberate: most slots
 * will be empty for most entities for the life of a campaign, and a slot that
 * only looks right once someone uploads something looks wrong almost always.
 * Diagonal ruling in the page's own sunken tone reads as reserved space with a
 * design. A stock illustration would read as a wrong picture -- which is why
 * `fallback` is opt-in: only the party crest uses it (T074), with old prints
 * of coats of arms, which read as "a crest" rather than as somebody's.
 *
 * Filled, the picture covers the frame the caller sized. The stored image is
 * uncropped and carries its own size, so any frame shape just crops it, and
 * the width and height attributes reserve the space before the bytes arrive.
 *
 * An image whose URL is not a download URL for this app's own bucket is
 * treated as absent: a member can write any string into a document, and a
 * planted third-party URL would log everyone who opens the page.
 *
 * Adding, replacing and removing is `ImageUploadControl`'s job; this only
 * shows what is there.
 */
export const ImageSlot: React.FC<ImageSlotProps> = ({
  label,
  caption,
  image,
  alt,
  fallback,
  loading = 'lazy',
  className,
}) => {
  if (image && isOwnBucketUrl(image.url)) {
    return (
      <div
        className={clsx('image-slot-filled overflow-hidden', className)}
        data-testid="image-slot"
      >
        <img
          src={image.url}
          alt={alt ?? ''}
          width={image.width}
          height={image.height}
          loading={loading}
          decoding="async"
          className="block w-full h-full object-cover"
        />
      </div>
    );
  }

  if (fallback) {
    return (
      <div
        className={clsx('image-slot-filled overflow-hidden', className)}
        role="img"
        aria-label={label}
        data-testid="image-slot"
        data-fallback="true"
      >
        <img
          src={fallback.url}
          alt=""
          width={fallback.width}
          height={fallback.height}
          loading={loading}
          decoding="async"
          className="block w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'image-slot flex items-center justify-center px-4 text-center',
        className
      )}
      role="img"
      aria-label={label}
      data-testid="image-slot"
    >
      {caption && (
        // Hidden from the accessibility tree: `role="img"` already gives this
        // element its whole accessible name, so the caption would either be
        // ignored or read twice.
        <span aria-hidden="true" className="image-slot-caption text-xs">
          {caption}
        </span>
      )}
    </div>
  );
};

export default ImageSlot;
