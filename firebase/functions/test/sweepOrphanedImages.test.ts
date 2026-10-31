// functions/test/sweepOrphanedImages.test.ts
//
// T058: the daily sweep deletes image files no document references -- and only
// those, and only once they are old enough not to be an upload still saving.
import {clearProject, useEmulatorProject} from "./emulator";
import {sweepOrphanedImages} from "../src/imageMaintenance/sweepOrphanedImages";
import {imageBucket} from "../src/shared/imageBucket";
import {File} from "@google-cloud/storage";

const PROJECT = "demo-sweep-orphaned-images";
const db = useEmulatorProject(PROJECT);

const DAY = 24 * 60 * 60 * 1000;
/** A sweep run two days from now, when every file in the test is old enough. */
const later = () => new Date(Date.now() + 2 * DAY);

/** One file per case, keyed by what it stands for. */
const FILES = {
  npcImage: "groups/g1/campaigns/c1/npcs/n1/current.webp",
  npcReplaced: "groups/g1/campaigns/c1/npcs/n1/replaced.webp",
  npcDeleted: "groups/g1/campaigns/c1/npcs/gone/a.webp",
  npcRemoved: "groups/g1/campaigns/c1/npcs/n2/removed.webp",
  locationImage: "groups/g1/campaigns/c1/locations/l1/current.jpg",
  locationOrphan: "groups/g1/campaigns/c1/locations/l1/failed-write.jpg",
  banner: "groups/g1/campaigns/c1/banner/current.webp",
  bannerOrphan: "groups/g1/campaigns/c1/banner/replaced.webp",
  crest: "groups/g1/crest/current.webp",
  crestOrphan: "groups/g1/crest/replaced.webp",
  otherGroupImage: "groups/g2/campaigns/c9/npcs/n9/current.webp",
  // T020: a bug-report screenshot nothing references, ever.
  screenshot: "support/frodo/0f8fad5b-d9cb-469f-a165-70867728950e.webp",
  // Not the shape of a file this app writes: never the sweep's to judge.
  unknownUnderSupport: "support/frodo/drafts/notes.txt",
  unknownUnderGroup: "groups/g1/exports/backup.json",
};

/**
 * The image value the app stores on a document, pointing at `path`.
 *
 * @param {string} path The object path
 * @return {object} A StoredImage-shaped value
 */
const stored = (path: string) => ({
  path,
  url: `https://example.test/${encodeURIComponent(path)}`,
  width: 800,
  height: 600,
  uploadedBy: "frodo",
  uploadedAt: "2026-09-24T00:00:00.000Z",
});

const exists = async (path: string) => (await imageBucket().file(path).exists())[0];

beforeEach(async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  await clearProject(PROJECT);
  await imageBucket().deleteFiles();

  await db.doc("groups/g1").set({name: "Fellowship", crest: stored(FILES.crest)});
  await db.doc("groups/g2").set({name: "Rangers"});
  await db.doc("groups/g1/campaigns/c1").set({name: "There and Back", banner: stored(FILES.banner)});
  await db.doc("groups/g1/campaigns/c1/npcs/n1").set({name: "Bilbo", image: stored(FILES.npcImage)});
  await db.doc("groups/g1/campaigns/c1/npcs/n2").set({name: "Sam", image: null});
  await db.doc("groups/g1/campaigns/c1/npcs/n3").set({name: "Pippin"});
  await db.doc("groups/g1/campaigns/c1/locations/l1").set({
    name: "Bag End",
    image: stored(FILES.locationImage),
  });
  await db.doc("groups/g2/campaigns/c9/npcs/n9").set({
    name: "Aragorn",
    image: stored(FILES.otherGroupImage),
  });

  await Promise.all(
    Object.values(FILES).map((path) =>
      imageBucket().file(path).save(Buffer.from("x"), {contentType: "image/webp"})
    )
  );
});

afterEach(() => jest.restoreAllMocks());

describe("sweeping orphaned images", () => {
  it("control: every file exists before the sweep", async () => {
    for (const path of Object.values(FILES)) expect(await exists(path)).toBe(true);
  });

  it("keeps every image a document references", async () => {
    await sweepOrphanedImages(later());

    expect(await exists(FILES.npcImage)).toBe(true);
    expect(await exists(FILES.locationImage)).toBe(true);
    expect(await exists(FILES.banner)).toBe(true);
    expect(await exists(FILES.crest)).toBe(true);
    expect(await exists(FILES.otherGroupImage)).toBe(true);
  });

  it("deletes an NPC's file that a replace left behind", async () => {
    await sweepOrphanedImages(later());

    expect(await exists(FILES.npcReplaced)).toBe(false);
  });

  it("deletes the file of an NPC whose document is gone", async () => {
    await sweepOrphanedImages(later());

    expect(await exists(FILES.npcDeleted)).toBe(false);
  });

  it("deletes a file whose NPC had its image removed", async () => {
    await sweepOrphanedImages(later());

    expect(await exists(FILES.npcRemoved)).toBe(false);
  });

  it("deletes a location's file whose document write never landed", async () => {
    await sweepOrphanedImages(later());

    expect(await exists(FILES.locationOrphan)).toBe(false);
  });

  it("deletes a banner file that is no longer the campaign's banner", async () => {
    await sweepOrphanedImages(later());

    expect(await exists(FILES.bannerOrphan)).toBe(false);
  });

  it("deletes a crest file that is no longer the group's crest", async () => {
    await sweepOrphanedImages(later());

    expect(await exists(FILES.crestOrphan)).toBe(false);
  });

  it("leaves an unreferenced file alone while it is under a day old", async () => {
    await sweepOrphanedImages(new Date(Date.now() + DAY / 2));

    expect(await exists(FILES.npcReplaced)).toBe(true);
    expect(await exists(FILES.crestOrphan)).toBe(true);
  });

  it("deletes a bug-report screenshot left behind for a day", async () => {
    await sweepOrphanedImages(later());

    expect(await exists(FILES.screenshot)).toBe(false);
  });

  it("leaves a screenshot alone while it is under a day old -- its report may be on its way", async () => {
    await sweepOrphanedImages(new Date(Date.now() + DAY / 2));

    expect(await exists(FILES.screenshot)).toBe(true);
  });

  it("leaves files that are not in the image or screenshot layout alone", async () => {
    await sweepOrphanedImages(later());

    expect(await exists(FILES.unknownUnderSupport)).toBe(true);
    expect(await exists(FILES.unknownUnderGroup)).toBe(true);
  });

  it("reports what it deleted", async () => {
    const result = await sweepOrphanedImages(later());

    expect(result.deleted.sort()).toEqual(
      [
        FILES.npcReplaced,
        FILES.npcDeleted,
        FILES.npcRemoved,
        FILES.locationOrphan,
        FILES.bannerOrphan,
        FILES.crestOrphan,
        FILES.screenshot,
      ].sort()
    );
    expect(result.failed).toEqual([]);
  });

  // T163: a private record's picture lives under its author's profile; the
  // collection-group read finds the private record that names it.
  describe("private records' pictures", () => {
    const KEPT = "groups/g1/users/frodo/campaigns/c1/npcs/gollum/current.webp";
    const ORPHAN = "groups/g1/users/frodo/campaigns/c1/npcs/gollum/replaced.webp";

    beforeEach(async () => {
      await db.doc("groups/g1/users/frodo/private/c1/npcs/gollum").set({name: "Gollum", image: stored(KEPT)});
      await Promise.all(
        [KEPT, ORPHAN].map((path) => imageBucket().file(path).save(Buffer.from("x"), {contentType: "image/webp"}))
      );
    });

    it("keeps the one a private record names, and deletes the one nothing names", async () => {
      await sweepOrphanedImages(later());

      expect(await exists(KEPT)).toBe(true);
      expect(await exists(ORPHAN)).toBe(false);
    });
  });

  // T084 (IMG-003): an upload whose document write is still on its way --
  // queued in a tab that went offline -- is not an orphan, however old the
  // file. The client records it in `pendingUploads` before uploading and
  // removes the entry once the document is written; the entry holds the file
  // for a lease, and an abandoned one expires.
  describe("uploads still waiting for their document", () => {
    const PENDING = "groups/g1/campaigns/c1/npcs/n1/7d3e2b1c.webp";
    const ENTRY = "groups/g1/pendingUploads/7d3e2b1c.webp";

    beforeEach(async () => {
      await imageBucket().file(PENDING).save(Buffer.from("x"), {contentType: "image/webp"});
      await db.doc(ENTRY).set({path: PENDING, uid: "frodo", createdAt: new Date()});
    });

    it("keeps an unreferenced file whose upload is still pending, past the day", async () => {
      const result = await sweepOrphanedImages(later());

      expect(await exists(PENDING)).toBe(true);
      expect(result.deleted).not.toContain(PENDING);
      expect((await db.doc(ENTRY).get()).exists).toBe(true);
    });

    it("lets an abandoned upload go once its lease is over, entry and file", async () => {
      const result = await sweepOrphanedImages(new Date(Date.now() + 31 * DAY));

      expect(await exists(PENDING)).toBe(false);
      expect(result.deleted).toContain(PENDING);
      expect((await db.doc(ENTRY).get()).exists).toBe(false);
    });

    it("clears an expired entry whose document did land, and keeps the file", async () => {
      // The client's own delete of the entry failed after its write landed.
      await db.doc("groups/g1/campaigns/c1/npcs/n3").set({name: "Pippin", image: stored(PENDING)});

      await sweepOrphanedImages(new Date(Date.now() + 31 * DAY));

      expect(await exists(PENDING)).toBe(true);
      expect((await db.doc(ENTRY).get()).exists).toBe(false);
    });

    it("lets an entry hold only the file it names", async () => {
      await sweepOrphanedImages(later());

      expect(await exists(FILES.npcReplaced)).toBe(false);
    });
  });

  // T084 (PERF2-004): the sweep's work is bounded, however large the bucket.
  describe("bounded work", () => {
    const ORPHANS = [
      FILES.npcReplaced,
      FILES.npcDeleted,
      FILES.npcRemoved,
      FILES.locationOrphan,
      FILES.bannerOrphan,
      FILES.crestOrphan,
      FILES.screenshot,
    ];

    it("lists the bucket a page at a time and still finds every orphan", async () => {
      const result = await sweepOrphanedImages(later(), {pageSize: 2});

      expect(result.deleted.sort()).toEqual([...ORPHANS].sort());
      expect(result.more).toBe(false);
      expect(await exists(FILES.npcImage)).toBe(true);
      expect(await exists(FILES.crest)).toBe(true);
    });

    it("deletes no more than its budget in one run, and says there is more", async () => {
      const result = await sweepOrphanedImages(later(), {maxDeletes: 3, pageSize: 2});

      expect(result.deleted).toHaveLength(3);
      expect(result.more).toBe(true);
      const left = [];
      for (const path of ORPHANS) if (await exists(path)) left.push(path);
      expect(left).toHaveLength(ORPHANS.length - 3);
    });

    it("finishes the backlog over the following runs", async () => {
      const runs = [];
      for (let i = 0; i < 4; i += 1) {
        runs.push(await sweepOrphanedImages(later(), {maxDeletes: 3, pageSize: 2}));
      }

      expect(runs.flatMap((run) => run.deleted).sort()).toEqual([...ORPHANS].sort());
      expect(runs[runs.length - 1].more).toBe(false);
      for (const path of ORPHANS) expect(await exists(path)).toBe(false);
      expect(await exists(FILES.npcImage)).toBe(true);
    });

    it("never has more deletes in flight than its concurrency", async () => {
      const original = File.prototype.delete;
      let inFlight = 0;
      let peak = 0;
      jest.spyOn(File.prototype, "delete").mockImplementation(function(
        this: File,
        ...args: unknown[]
      ) {
        const run = original as (...a: unknown[]) => unknown;
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        // Hold each delete open for a moment, so overlapping ones overlap.
        // `this` is the file being deleted: `delete` is a method.
        return new Promise((resolve) => setTimeout(resolve, 20))
          // eslint-disable-next-line no-invalid-this
          .then(() => run.apply(this, args))
          .finally(() => {
            inFlight -= 1;
          });
      } as typeof original);

      const result = await sweepOrphanedImages(later(), {concurrency: 2});

      expect(result.deleted).toHaveLength(ORPHANS.length);
      expect(peak).toBe(2);
    });
  });
});
