// src/core/services/firebase/storage/ImageStorageService.ts
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "firebase/storage";
import { doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import BaseFirebaseService from "../core/BaseFirebaseService";
import {
  firebaseConfig,
  useEmulators,
  emulatorHost,
  emulatorPorts
} from "../config/firebaseConfig";
import { StoredImage } from "../../../types/storedImage";
import type { PreparedImage } from "../../../utils/prepare-image";

/** Campaign entities that can carry an image. Mirrors `storage.rules.prod`. */
export type ImageEntityType = "npcs" | "locations";

/**
 * Every object is written once under a fresh name and never changed, so it
 * may be cached for a year without a replace ever showing a stale picture.
 */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** A path segment that can't be empty or climb out of its folder. */
function segment(value: string): string {
  if (!value || value.includes("/") || value === "." || value === "..") {
    throw new Error(`Invalid storage path segment: "${value}"`);
  }
  return value;
}

/**
 * The folder an entity's images live in. It mirrors the entity's Firestore
 * path, which is what lets the rules read the group from it and lets a
 * campaign's files be deleted as one prefix.
 */
export function entityImagePrefix(
  groupId: string,
  campaignId: string,
  entityType: ImageEntityType,
  entityId: string
): string {
  return [
    "groups", segment(groupId),
    "campaigns", segment(campaignId),
    entityType, segment(entityId)
  ].join("/");
}

/**
 * The folder a private record's images live in (T163): under its author's
 * group profile, which only they read, as the record itself is. Publishing
 * copies the picture to the campaign's folder (`publishPrivate`).
 */
export function privateEntityImagePrefix(
  groupId: string,
  uid: string,
  campaignId: string,
  entityType: ImageEntityType,
  entityId: string
): string {
  return [
    "groups", segment(groupId),
    "users", segment(uid),
    "campaigns", segment(campaignId),
    entityType, segment(entityId)
  ].join("/");
}

/**
 * The folder a campaign's banner lives in. Under the campaign's own folder, so
 * deleting the campaign's prefix takes the banner with it.
 */
export function campaignBannerPrefix(groupId: string, campaignId: string): string {
  return ["groups", segment(groupId), "campaigns", segment(campaignId), "banner"].join("/");
}

/** The folder a group's crest lives in. */
export function crestPrefix(groupId: string): string {
  return `groups/${segment(groupId)}/crest`;
}

/**
 * The folder a user's bug-report screenshots live in (T020). Keyed by the
 * uploader, so the rules can let each user write only their own; nobody reads
 * it from the app -- `sendContactEmail` attaches the file and deletes it.
 */
export function supportScreenshotPrefix(uid: string): string {
  return `support/${segment(uid)}`;
}

/**
 * How long an upload waits for its pending entry before failing. The entry
 * needs the server; a client that cannot reach it should still get an answer
 * rather than a progress bar that never moves.
 */
const PENDING_ENTRY_TIMEOUT_MS = 10_000;

/**
 * Where a ledger entry about an image path lives: in the path's group, in
 * `ledger`, named after the file. `firestore.rules.prod` checks both.
 *
 * @param path An image path under `groups/{groupId}/`
 * @param ledger `pendingUploads` or `releasedImages`
 * @returns The entry's collection path and document id
 */
function ledgerEntryOf(path: string, ledger: string): { collection: string; id: string } {
  const segments = path.split("/");
  const [root, groupId] = segments;
  const id = segments[segments.length - 1];
  if (root !== "groups" || !groupId || segments.length < 3 || !id) {
    throw new Error(`Not an image path in a group: "${path}"`);
  }
  return { collection: `groups/${groupId}/${ledger}`, id };
}

/**
 * Where the pending entry for an image path lives (T084): an upload whose
 * document is still to be written.
 *
 * @param path An image path under `groups/{groupId}/`
 * @returns The entry's collection path and document id
 */
export function pendingUploadOf(path: string): { collection: string; id: string } {
  return ledgerEntryOf(path, "pendingUploads");
}

/**
 * Where the released entry for an image path lives (T084): a file a document
 * is about to stop pointing at, which the daily sweep deletes if the client's
 * own delete never happens.
 *
 * @param path An image path under `groups/{groupId}/`
 * @returns The entry's collection path and document id
 */
export function releasedImageOf(path: string): { collection: string; id: string } {
  return ledgerEntryOf(path, "releasedImages");
}

/**
 * Whether a URL is a download URL for this app's own bucket.
 *
 * A member can write any string into a Firestore document, so an image URL is
 * checked before it is rendered: a planted third-party URL would let its owner
 * log the IP address of everyone who opens the page.
 */
export function isOwnBucketUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const origins = ["https://firebasestorage.googleapis.com"];
  if (useEmulators) origins.push(`http://${emulatorHost}:${emulatorPorts.storage}`);

  return (
    origins.includes(parsed.origin) &&
    parsed.pathname.startsWith(`/v0/b/${firebaseConfig.storageBucket}/o/`)
  );
}

/**
 * Uploads and deletes images in Firebase Storage.
 *
 * Callers save the returned `StoredImage` on their document, and decide the
 * order of writes (see the design's lifecycle table -- the document is always
 * written before an old file is deleted). The Firestore writes here are the
 * daily sweep's two ledgers (T084): an upload's pending entry, which says "a
 * document is about to point at this file" until the caller calls
 * `clearPendingUpload`, and a released entry, which says "a document is about
 * to stop pointing at this file" until the caller calls `clearReleasedImage`.
 */
class ImageStorageService extends BaseFirebaseService {
  private static instance: ImageStorageService;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance of ImageStorageService
   */
  public static getInstance(): ImageStorageService {
    if (!ImageStorageService.instance) {
      ImageStorageService.instance = new ImageStorageService();
    }
    return ImageStorageService.instance;
  }

  /**
   * Upload a prepared image under a new, random name in `prefix`.
   * @param prefix Folder from `entityImagePrefix`, `campaignBannerPrefix` or `crestPrefix`
   * @param image Output of `prepareImage`
   * @param onProgress Called with the fraction uploaded, 0 to 1
   * @returns What to store on the document
   */
  public async upload(
    prefix: string,
    image: PreparedImage,
    onProgress?: (fraction: number) => void
  ): Promise<StoredImage> {
    const uid = this.requireUid();
    const path = `${prefix}/${crypto.randomUUID()}.${image.extension}`;
    // The entry is written alongside the bytes, and waited for before the
    // image is handed back: the caller's document write must not reach the
    // server ahead of it, or the daily sweep could take a file whose write
    // is queued in an offline tab for an orphan (IMG-003). Without its entry
    // the image could never be saved -- the rules refuse a document that
    // points at it (T084) -- so the upload fails and takes its bytes with it.
    const recorded = this.recordPendingUpload(path, uid);
    // Awaited below; this only stops a refusal that arrives while the bytes
    // are still on their way from being reported as unhandled.
    recorded.catch(() => undefined);
    const objectRef = await this.put(path, image, onProgress, IMMUTABLE_CACHE_CONTROL);
    try {
      await recorded;
    } catch (error) {
      this.remove(path).catch((cleanup) =>
        console.warn(`Could not delete ${path}, whose upload failed; the sweep will.`, cleanup)
      );
      throw error;
    }

    return {
      path,
      url: await getDownloadURL(objectRef),
      width: image.width,
      height: image.height,
      uploadedBy: uid,
      uploadedAt: new Date().toISOString(),
      // Left out rather than undefined: Firestore refuses an undefined field.
      ...(image.brightness ? { brightness: image.brightness } : {})
    };
  }

  /**
   * Copy a private record's picture to the campaign's folder, for its
   * publish (T163). The client cannot copy a file without downloading and
   * uploading it again, so `publishImage` does it server-side, with a new
   * name, a new download token and a pending entry in the caller's name;
   * the caller clears that entry once the record points at the copy.
   *
   * @param image The private picture
   * @param recordId The id the record is published under
   * @returns The copy, to store on the published record
   */
  public async publishPrivate(image: StoredImage, recordId: string): Promise<StoredImage> {
    const groupId = image.path.split("/")[1];
    const copy = httpsCallable<{ groupId: string; path: string; recordId: string }, { path: string }>(
      this.functions,
      "publishImage"
    );
    const { data } = await copy({ groupId, path: image.path, recordId });
    return { ...image, path: data.path, url: await getDownloadURL(ref(this.storage, data.path)) };
  }

  /**
   * Upload a prepared screenshot for a bug report, under a new, random name in
   * the signed-in user's own support folder.
   *
   * Returns the path alone: the rules let nobody read the folder, so there is
   * no download URL to ask for. The path goes to `sendContactEmail`, which
   * attaches the file to the email and then deletes it.
   *
   * @param image Output of `prepareImage`
   * @param onProgress Called with the fraction uploaded, 0 to 1
   * @returns The object path
   */
  public async uploadScreenshot(
    image: PreparedImage,
    onProgress?: (fraction: number) => void
  ): Promise<string> {
    const path = `${supportScreenshotPrefix(this.requireUid())}/${crypto.randomUUID()}.${image.extension}`;
    await this.put(path, image, onProgress);
    return path;
  }

  /**
   * The document now points at `path`, or never will: its pending entry can
   * go. Never throws -- an entry left behind only keeps its file until the
   * sweep's lease runs out, so the user's action has still succeeded.
   * @param path `StoredImage.path`
   */
  public clearPendingUpload(path: string): void {
    const warn = (error: unknown) =>
      console.warn(`Could not clear the pending entry for ${path}; the sweep's lease will.`, error);
    try {
      const { collection, id } = pendingUploadOf(path);
      deleteDoc(doc(this.db, collection, id)).catch(warn);
    } catch (error) {
      warn(error);
    }
  }

  /**
   * Record that a document is about to stop pointing at `path` (T084), so the
   * daily sweep deletes the file if the caller's own delete never runs -- a
   * failed request, a closed tab. Without the record only the monthly full
   * sweep would find it. Call it before the write that drops the image, and
   * `clearReleasedImage` once the file is gone.
   *
   * Never throws, and does not wait: a record that fails costs nothing but a
   * month's wait for the full sweep, and the user's action must not wait on
   * clean-up. Its order against the document write does not matter either:
   * the sweep checks the document before it deletes anything.
   * @param path `StoredImage.path`
   */
  public recordReleasedImage(path: string): void {
    const warn = (error: unknown) =>
      console.warn(`Could not record ${path} as released; the monthly sweep will find it.`, error);
    try {
      const uid = this.requireUid();
      const { collection, id } = releasedImageOf(path);
      setDoc(doc(this.db, collection, id), { path, uid, createdAt: serverTimestamp() }).catch(warn);
    } catch (error) {
      warn(error);
    }
  }

  /**
   * The released file is deleted: its entry can go. Never throws -- a stale
   * entry costs the sweep one read before it deletes the entry itself.
   * @param path `StoredImage.path`
   */
  public clearReleasedImage(path: string): void {
    const warn = (error: unknown) =>
      console.warn(`Could not clear the released entry for ${path}; the sweep will.`, error);
    try {
      const { collection, id } = releasedImageOf(path);
      deleteDoc(doc(this.db, collection, id)).catch(warn);
    } catch (error) {
      warn(error);
    }
  }

  /**
   * Record `path` as an upload whose document is still to be written.
   *
   * Required: the rules refuse a document write that points at a file with no
   * live entry (T084), so this rejects when the entry is refused, and when it
   * has not answered within {@link PENDING_ENTRY_TIMEOUT_MS}.
   */
  private async recordPendingUpload(path: string, uid: string): Promise<void> {
    const { collection, id } = pendingUploadOf(path);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`The pending entry for ${path} did not answer.`)),
        PENDING_ENTRY_TIMEOUT_MS
      );
    });
    try {
      await Promise.race([
        setDoc(doc(this.db, collection, id), { path, uid, createdAt: serverTimestamp() }),
        timedOut
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Delete an image. An object that is already gone counts as deleted, so a
   * retried cleanup never fails on its own earlier success.
   * @param path `StoredImage.path`
   */
  public async remove(path: string): Promise<void> {
    try {
      await deleteObject(ref(this.storage, path));
    } catch (error) {
      if ((error as { code?: string }).code === "storage/object-not-found") return;
      throw error;
    }
  }

  /** The signed-in user's id; every upload needs one. */
  private requireUid(): string {
    const uid = this.getCurrentUser()?.uid;
    if (!uid) {
      throw new Error("Not authenticated");
    }
    return uid;
  }

  /**
   * Write `image` to `path` and wait for the upload to finish.
   * @param path The full object path
   * @param image Output of `prepareImage`
   * @param onProgress Called with the fraction uploaded, 0 to 1
   * @param cacheControl The object's `Cache-Control`, if any
   * @returns A reference to the written object
   */
  private async put(
    path: string,
    image: PreparedImage,
    onProgress?: (fraction: number) => void,
    cacheControl?: string
  ) {
    const objectRef = ref(this.storage, path);
    const task = uploadBytesResumable(objectRef, image.blob, {
      contentType: image.contentType,
      ...(cacheControl ? { cacheControl } : {})
    });

    await new Promise<void>((resolve, reject) => {
      task.on(
        "state_changed",
        snapshot => {
          if (onProgress && snapshot.totalBytes > 0) {
            onProgress(snapshot.bytesTransferred / snapshot.totalBytes);
          }
        },
        reject,
        resolve
      );
    });
    return objectRef;
  }
}

export default ImageStorageService;
