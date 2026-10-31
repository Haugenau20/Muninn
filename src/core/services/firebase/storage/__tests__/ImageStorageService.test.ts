// src/core/services/firebase/storage/__tests__/ImageStorageService.test.ts

/**
 * Tests for ImageStorageService and its path and URL helpers.
 *
 * The Storage SDK is mocked; `uploadBytesResumable` returns a task whose
 * `on('state_changed', …)` the test drives by hand.
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockStorage = { name: 'storage' };
const mockAuth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'uploader-1' } };
const mockRef = jest.fn((_storage: unknown, path: string) => ({ fullPath: path }));
const mockUploadBytesResumable = jest.fn();
const mockGetDownloadURL = jest.fn();
const mockDeleteObject = jest.fn();
const mockFirestoreDoc = jest.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
const mockSetDoc = jest.fn();
const mockDeleteDoc = jest.fn();
const SERVER_TIME = { sentinel: 'serverTimestamp' };

jest.mock('firebase/storage', () => ({
  getStorage: jest.fn(() => mockStorage),
  connectStorageEmulator: jest.fn(),
  ref: function () { return (mockRef as Function).apply(null, arguments); },
  uploadBytesResumable: function () { return (mockUploadBytesResumable as Function).apply(null, arguments); },
  getDownloadURL: function () { return (mockGetDownloadURL as Function).apply(null, arguments); },
  deleteObject: function () { return (mockDeleteObject as Function).apply(null, arguments); },
}));
jest.mock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => mockAuth),
  connectAuthEmulator: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  getFirestore: jest.fn(() => ({})),
  initializeFirestore: jest.fn(() => ({})),
  memoryLocalCache: jest.fn(),
  clearIndexedDbPersistence: jest.fn(() => Promise.resolve()),
  persistentLocalCache: jest.fn(),
  persistentMultipleTabManager: jest.fn(),
  connectFirestoreEmulator: jest.fn(),
  doc: function () { return (mockFirestoreDoc as Function).apply(null, arguments); },
  setDoc: function () { return (mockSetDoc as Function).apply(null, arguments); },
  deleteDoc: function () { return (mockDeleteDoc as Function).apply(null, arguments); },
  serverTimestamp: () => SERVER_TIME,
}));
jest.mock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
const mockCallable = jest.fn();
const mockHttpsCallable = jest.fn((_functions: unknown, _name: string) => mockCallable);
jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  connectFunctionsEmulator: jest.fn(),
  httpsCallable: function () { return (mockHttpsCallable as Function).apply(null, arguments); },
}));

const mockConfig = {
  firebaseConfig: { apiKey: 'test', projectId: 'test', storageBucket: 'test-bucket.firebasestorage.app' },
  useEmulators: false,
  emulatorHost: 'localhost',
  emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001', storage: '9199' },
};
jest.mock('../../config/firebaseConfig', () => mockConfig);

import ImageStorageService, {
  entityImagePrefix,
  privateEntityImagePrefix,
  crestPrefix,
  campaignBannerPrefix,
  supportScreenshotPrefix,
  isOwnBucketUrl,
  IMMUTABLE_CACHE_CONTROL,
} from '../ImageStorageService';
import type { PreparedImage } from '../../../../utils/prepare-image';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Observer = {
  next?: (s: { bytesTransferred: number; totalBytes: number }) => void;
  error?: (e: unknown) => void;
  complete?: () => void;
};

/** An upload task whose progress, failure and completion the test triggers. */
function fakeTask() {
  const observer: Observer = {};
  return {
    observer,
    task: {
      on: jest.fn((_event: string, next: Observer['next'], error: Observer['error'], complete: Observer['complete']) => {
        observer.next = next;
        observer.error = error;
        observer.complete = complete;
        return () => undefined;
      }),
    },
  };
}

const prepared: PreparedImage = {
  blob: new Blob(['x'], { type: 'image/webp' }),
  width: 1600,
  height: 1200,
  contentType: 'image/webp',
  extension: 'webp',
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = { uid: 'uploader-1' };
  mockConfig.useEmulators = false;
  mockSetDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
});

// ─── Path helpers ────────────────────────────────────────────────────────────

describe('path helpers', () => {
  it('builds an entity prefix that mirrors the Firestore path', () => {
    expect(entityImagePrefix('g1', 'c1', 'npcs', 'n1')).toBe('groups/g1/campaigns/c1/npcs/n1');
    expect(entityImagePrefix('g1', 'c1', 'locations', 'l1')).toBe('groups/g1/campaigns/c1/locations/l1');
  });

  it("builds a campaign's banner prefix inside the campaign's own folder", () => {
    // Inside it, so deleteCampaign's prefix delete takes the banner too.
    expect(campaignBannerPrefix('g1', 'c1')).toBe('groups/g1/campaigns/c1/banner');
  });

  it('builds the crest prefix under the group', () => {
    expect(crestPrefix('g1')).toBe('groups/g1/crest');
  });

  it("builds a support prefix keyed by the uploader, outside every group", () => {
    expect(supportScreenshotPrefix('u1')).toBe('support/u1');
  });

  it('refuses an id that would escape its folder', () => {
    expect(() => entityImagePrefix('g1', 'c1', 'npcs', '../x')).toThrow();
    expect(() => crestPrefix('')).toThrow();
    expect(() => campaignBannerPrefix('g1', '..')).toThrow();
    expect(() => supportScreenshotPrefix('a/b')).toThrow();
  });
});

// ─── isOwnBucketUrl ──────────────────────────────────────────────────────────

describe('isOwnBucketUrl', () => {
  const prod = 'https://firebasestorage.googleapis.com/v0/b/test-bucket.firebasestorage.app/o/groups%2Fg1%2Fcrest%2Fa.webp?alt=media&token=t';
  const emulator = 'http://localhost:9199/v0/b/test-bucket.firebasestorage.app/o/groups%2Fg1%2Fcrest%2Fa.webp?alt=media&token=t';

  it('accepts a download URL for this bucket', () => {
    expect(isOwnBucketUrl(prod)).toBe(true);
  });

  it('rejects another bucket on the same host', () => {
    expect(isOwnBucketUrl(prod.replace('test-bucket', 'someone-else'))).toBe(false);
  });

  it('rejects a foreign host, which could log every viewer', () => {
    expect(isOwnBucketUrl('https://tracker.example.com/v0/b/test-bucket.firebasestorage.app/o/x.webp')).toBe(false);
  });

  it('rejects plain http to the production host', () => {
    expect(isOwnBucketUrl(prod.replace('https:', 'http:'))).toBe(false);
  });

  it('rejects things that are not URLs at all', () => {
    expect(isOwnBucketUrl('javascript:alert(1)')).toBe(false);
    expect(isOwnBucketUrl('')).toBe(false);
  });

  it('accepts the emulator only while emulators are in use', () => {
    expect(isOwnBucketUrl(emulator)).toBe(false);
    mockConfig.useEmulators = true;
    expect(isOwnBucketUrl(emulator)).toBe(true);
  });
});

// ─── upload ──────────────────────────────────────────────────────────────────

describe('ImageStorageService.upload', () => {
  const service = ImageStorageService.getInstance();

  it('uploads under a fresh name in the prefix, with type and immutable caching', async () => {
    const { task, observer } = fakeTask();
    mockUploadBytesResumable.mockReturnValue(task);
    mockGetDownloadURL.mockResolvedValue('https://example/url');

    const pending = service.upload('groups/g1/crest', prepared);
    observer.complete!();
    const image = await pending;

    const path = mockRef.mock.calls[0][1];
    expect(path).toMatch(/^groups\/g1\/crest\/[0-9a-f-]{36}\.webp$/);
    expect(mockRef.mock.calls[0][0]).toBe(mockStorage);
    expect(mockUploadBytesResumable).toHaveBeenCalledWith(
      { fullPath: path },
      prepared.blob,
      { contentType: 'image/webp', cacheControl: IMMUTABLE_CACHE_CONTROL }
    );
    expect(IMMUTABLE_CACHE_CONTROL).toMatch(/immutable/);
    expect(image).toMatchObject({
      path,
      url: 'https://example/url',
      width: 1600,
      height: 1200,
      uploadedBy: 'uploader-1',
    });
    expect(Number.isNaN(Date.parse(image.uploadedAt))).toBe(false);
  });

  it('stores the brightness measured at preparation with the image', async () => {
    const { task, observer } = fakeTask();
    mockUploadBytesResumable.mockReturnValue(task);
    mockGetDownloadURL.mockResolvedValue('u');
    const brightness = { cols: 1, rows: 1, cells: [0.5] };

    const pending = service.upload('groups/g1/crest', { ...prepared, brightness });
    observer.complete!();

    expect((await pending).brightness).toEqual(brightness);
  });

  it('leaves the brightness out, not undefined, when there is none -- Firestore refuses undefined', async () => {
    const { task, observer } = fakeTask();
    mockUploadBytesResumable.mockReturnValue(task);
    mockGetDownloadURL.mockResolvedValue('u');

    const pending = service.upload('groups/g1/crest', prepared);
    observer.complete!();

    expect('brightness' in (await pending)).toBe(false);
  });

  it('never reuses a name, so a replace cannot hit a cached old image', async () => {
    for (let i = 0; i < 2; i++) {
      const { task, observer } = fakeTask();
      mockUploadBytesResumable.mockReturnValueOnce(task);
      mockGetDownloadURL.mockResolvedValueOnce('u');
      const pending = service.upload('groups/g1/crest', prepared);
      observer.complete!();
      await pending;
    }
    expect(mockRef.mock.calls[0][1]).not.toBe(mockRef.mock.calls[1][1]);
  });

  it('reports progress as a fraction', async () => {
    const { task, observer } = fakeTask();
    mockUploadBytesResumable.mockReturnValue(task);
    mockGetDownloadURL.mockResolvedValue('u');
    const onProgress = jest.fn();

    const pending = service.upload('groups/g1/crest', prepared, onProgress);
    observer.next!({ bytesTransferred: 50, totalBytes: 200 });
    observer.complete!();
    await pending;

    expect(onProgress).toHaveBeenCalledWith(0.25);
  });

  it('rejects when the upload fails, without asking for a URL', async () => {
    const { task, observer } = fakeTask();
    mockUploadBytesResumable.mockReturnValue(task);

    const pending = service.upload('groups/g1/crest', prepared);
    observer.error!(Object.assign(new Error('denied'), { code: 'storage/unauthorized' }));

    await expect(pending).rejects.toMatchObject({ code: 'storage/unauthorized' });
    await flush();
    expect(mockGetDownloadURL).not.toHaveBeenCalled();
  });

  it('refuses to upload when nobody is signed in', async () => {
    mockAuth.currentUser = null;
    await expect(service.upload('groups/g1/crest', prepared)).rejects.toThrow(/Not authenticated/);
    expect(mockUploadBytesResumable).not.toHaveBeenCalled();
  });
});

// T084 (IMG-003): an upload is recorded as pending, so the daily sweep does
// not take it for an orphan while its document write is still on its way.
describe('ImageStorageService.upload -- the pending entry', () => {
  const service = ImageStorageService.getInstance();

  /** Start an upload and let its bytes finish; hands back the promise. */
  const uploadAndFinish = () => {
    const { task, observer } = fakeTask();
    mockUploadBytesResumable.mockReturnValue(task);
    mockGetDownloadURL.mockResolvedValue('u');
    const pending = service.upload('groups/g1/campaigns/c1/npcs/n1', prepared);
    observer.complete!();
    return pending;
  };

  it('records the upload in its group, named after the file, at the server time', async () => {
    const image = await uploadAndFinish();

    const name = image.path.split('/').pop();
    expect(mockSetDoc).toHaveBeenCalledWith(
      { path: `groups/g1/pendingUploads/${name}` },
      { path: image.path, uid: 'uploader-1', createdAt: SERVER_TIME }
    );
  });

  it('starts recording it before any bytes are written', async () => {
    await uploadAndFinish();

    expect(mockSetDoc.mock.invocationCallOrder[0]).toBeLessThan(
      mockUploadBytesResumable.mock.invocationCallOrder[0]
    );
  });

  it('hands the image back only once the entry is written, so the document cannot be first', async () => {
    let written!: () => void;
    mockSetDoc.mockReturnValue(new Promise<void>((resolve) => { written = resolve; }));
    let done = false;

    const pending = uploadAndFinish().then(() => { done = true; });
    await flush();
    expect(done).toBe(false);

    written();
    await pending;
    expect(done).toBe(true);
  });

  // T084, second half: the rules refuse a document write that points at a
  // file with no live entry, so an upload without one can never be saved.
  // It fails here, where the user can still try again, and takes its bytes
  // with it.

  /** The path the bytes went to, as the upload asked Storage for it. */
  const uploadedPath = () => mockUploadBytesResumable.mock.calls[0][0].fullPath as string;

  it('fails when the entry is refused, and deletes the bytes it wrote', async () => {
    const refused = Object.assign(new Error('denied'), { code: 'permission-denied' });
    mockSetDoc.mockRejectedValue(refused);

    await expect(uploadAndFinish()).rejects.toBe(refused);
    expect(mockDeleteObject).toHaveBeenCalledWith({ fullPath: uploadedPath() });
    expect(mockGetDownloadURL).not.toHaveBeenCalled();
  });

  it('gives up on an entry that never answers rather than hang, and deletes the bytes', async () => {
    jest.useFakeTimers();
    mockSetDoc.mockReturnValue(new Promise(() => undefined));
    try {
      const pending = uploadAndFinish();
      // Caught now, so the rejection the clock triggers is never unhandled.
      const outcome = pending.then(() => null, (error: Error) => error);
      // Let the upload reach its wait for the entry, then run out the clock.
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      jest.advanceTimersByTime(10_000);
      expect((await outcome)?.message).toMatch(/did not answer/);
      expect(mockDeleteObject).toHaveBeenCalledWith({ fullPath: uploadedPath() });
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports the failed bytes, not the entry, when both fail', async () => {
    mockSetDoc.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    const { task, observer } = fakeTask();
    mockUploadBytesResumable.mockReturnValue(task);

    const pending = service.upload('groups/g1/campaigns/c1/npcs/n1', prepared);
    observer.error!(Object.assign(new Error('quota'), { code: 'storage/quota-exceeded' }));

    await expect(pending).rejects.toMatchObject({ code: 'storage/quota-exceeded' });
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });
});

describe('ImageStorageService.clearPendingUpload', () => {
  const service = ImageStorageService.getInstance();
  const PATH = 'groups/g1/crest/7d3e2b1c.webp';

  it('deletes the entry once the document points at the file', async () => {
    service.clearPendingUpload(PATH);
    await flush();
    expect(mockDeleteDoc).toHaveBeenCalledWith({ path: 'groups/g1/pendingUploads/7d3e2b1c.webp' });
  });

  it('never throws: a stale entry only holds a file the sweep will free in time', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockDeleteDoc.mockRejectedValue(new Error('offline'));

    expect(() => service.clearPendingUpload(PATH)).not.toThrow();
    await flush();
    expect(warn).toHaveBeenCalled();
    expect(() => service.clearPendingUpload('not/a/group/path.webp')).not.toThrow();
    warn.mockRestore();
  });
});

describe('ImageStorageService -- the released entry (T084)', () => {
  const service = ImageStorageService.getInstance();
  const PATH = 'groups/g1/campaigns/c1/npcs/n1/7d3e2b1c.webp';

  it('records a file about to be dropped in its group, named after the file, at the server time', async () => {
    service.recordReleasedImage(PATH);
    await flush();
    expect(mockSetDoc).toHaveBeenCalledWith(
      { path: 'groups/g1/releasedImages/7d3e2b1c.webp' },
      { path: PATH, uid: 'uploader-1', createdAt: SERVER_TIME }
    );
  });

  it('deletes the entry once the file is gone', async () => {
    service.clearReleasedImage(PATH);
    await flush();
    expect(mockDeleteDoc).toHaveBeenCalledWith({ path: 'groups/g1/releasedImages/7d3e2b1c.webp' });
  });

  it('never throws: a missing record only leaves the file to the monthly sweep', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockSetDoc.mockRejectedValue(new Error('permission-denied'));
    mockDeleteDoc.mockRejectedValue(new Error('offline'));

    expect(() => service.recordReleasedImage(PATH)).not.toThrow();
    expect(() => service.clearReleasedImage(PATH)).not.toThrow();
    await flush();
    expect(warn).toHaveBeenCalledTimes(2);

    expect(() => service.recordReleasedImage('not/a/group/path.webp')).not.toThrow();
    mockAuth.currentUser = null;
    expect(() => service.recordReleasedImage(PATH)).not.toThrow();
    warn.mockRestore();
  });
});

// ─── uploadScreenshot ────────────────────────────────────────────────────────

describe('ImageStorageService.uploadScreenshot', () => {
  const service = ImageStorageService.getInstance();

  it("uploads under a fresh name in the signed-in user's support folder", async () => {
    const { task, observer } = fakeTask();
    mockUploadBytesResumable.mockReturnValue(task);

    const pending = service.uploadScreenshot(prepared);
    observer.complete!();
    const path = await pending;

    expect(path).toMatch(/^support\/uploader-1\/[0-9a-f-]{36}\.webp$/);
    expect(mockRef).toHaveBeenCalledWith(mockStorage, path);
    expect(mockUploadBytesResumable).toHaveBeenCalledWith({ fullPath: path }, prepared.blob, {
      contentType: 'image/webp',
    });
  });

  it('never asks for a download URL -- nobody may read the folder', async () => {
    const { task, observer } = fakeTask();
    mockUploadBytesResumable.mockReturnValue(task);

    const pending = service.uploadScreenshot(prepared);
    observer.complete!();
    await pending;

    expect(mockGetDownloadURL).not.toHaveBeenCalled();
  });

  it('reports progress as a fraction', async () => {
    const { task, observer } = fakeTask();
    mockUploadBytesResumable.mockReturnValue(task);
    const onProgress = jest.fn();

    const pending = service.uploadScreenshot(prepared, onProgress);
    observer.next!({ bytesTransferred: 150, totalBytes: 200 });
    observer.complete!();
    await pending;

    expect(onProgress).toHaveBeenCalledWith(0.75);
  });

  it('rejects when the upload fails', async () => {
    const { task, observer } = fakeTask();
    mockUploadBytesResumable.mockReturnValue(task);

    const pending = service.uploadScreenshot(prepared);
    observer.error!(Object.assign(new Error('denied'), { code: 'storage/unauthorized' }));

    await expect(pending).rejects.toMatchObject({ code: 'storage/unauthorized' });
  });

  it('refuses to upload when nobody is signed in', async () => {
    mockAuth.currentUser = null;
    await expect(service.uploadScreenshot(prepared)).rejects.toThrow(/Not authenticated/);
    expect(mockUploadBytesResumable).not.toHaveBeenCalled();
  });
});

// ─── remove ──────────────────────────────────────────────────────────────────

describe('ImageStorageService.remove', () => {
  const service = ImageStorageService.getInstance();

  it('deletes the object at the path', async () => {
    mockDeleteObject.mockResolvedValue(undefined);
    await service.remove('groups/g1/crest/a.webp');
    expect(mockRef).toHaveBeenCalledWith(mockStorage, 'groups/g1/crest/a.webp');
    expect(mockDeleteObject).toHaveBeenCalledWith({ fullPath: 'groups/g1/crest/a.webp' });
  });

  it('treats an already-missing object as removed', async () => {
    mockDeleteObject.mockRejectedValue(Object.assign(new Error('gone'), { code: 'storage/object-not-found' }));
    await expect(service.remove('groups/g1/crest/a.webp')).resolves.toBeUndefined();
  });

  it('passes any other failure on', async () => {
    mockDeleteObject.mockRejectedValue(Object.assign(new Error('no'), { code: 'storage/unauthorized' }));
    await expect(service.remove('groups/g1/crest/a.webp')).rejects.toMatchObject({ code: 'storage/unauthorized' });
  });
});

// T163: a private record's picture is copied server-side for its publish,
// and handed back with the copy's own download URL.
describe('ImageStorageService.publishPrivate', () => {
  const service = ImageStorageService.getInstance();
  const PRIVATE = 'groups/g1/users/u1/campaigns/c1/npcs/gollum/a.webp';
  const COPY = 'groups/g1/campaigns/c1/npcs/gollum-2/b.webp';
  const image = { path: PRIVATE, url: 'private-url', width: 4, height: 3, uploadedBy: 'u1', uploadedAt: 'then' };

  it('asks publishImage for a copy under the published id, and keeps the rest of the picture', async () => {
    mockCallable.mockResolvedValue({ data: { path: COPY } });
    mockGetDownloadURL.mockResolvedValue('copy-url');

    const copy = await service.publishPrivate(image, 'gollum-2');

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'publishImage');
    expect(mockCallable).toHaveBeenCalledWith({ groupId: 'g1', path: PRIVATE, recordId: 'gollum-2' });
    expect(mockRef).toHaveBeenCalledWith(expect.anything(), COPY);
    expect(copy).toEqual({ ...image, path: COPY, url: 'copy-url' });
  });

  it('passes a refusal on', async () => {
    mockCallable.mockRejectedValue(Object.assign(new Error('no'), { code: 'functions/permission-denied' }));
    await expect(service.publishPrivate(image, 'gollum')).rejects.toMatchObject({ code: 'functions/permission-denied' });
  });
});

describe('privateEntityImagePrefix', () => {
  it('is under the author’s group profile, by campaign, kind and record', () => {
    expect(privateEntityImagePrefix('g1', 'u1', 'c1', 'locations', 'cave')).toBe(
      'groups/g1/users/u1/campaigns/c1/locations/cave'
    );
  });
});
