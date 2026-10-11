// functions/test/resumeGroupDeletions.test.ts
//
// T037: a group deletion that failed after its caller lost the group cannot
// be retried from the app, so the daily sweep finishes it. The scheduled
// wrapper never fires in the emulator; its body is tested directly, with
// `now` injected.
import {Firestore, Timestamp} from "firebase-admin/firestore";
import {clearProject, useEmulatorProject} from "./emulator";
import {resumeGroupDeletions, RESUME_AFTER_MS} from "../src/groupManagement/groupDeletion";
import {imageBucket} from "../src/shared/imageBucket";

const PROJECT = "demo-resume-group-deletions";
const db = useEmulatorProject(PROJECT);
const NOW = new Date("2026-10-05T03:15:00Z");

const ago = (ms: number) => Timestamp.fromMillis(NOW.getTime() - ms);
const isThere = async (path: string) => (await db.doc(path).get()).exists;
const fileExists = async (path: string) => (await imageBucket().file(path).exists())[0];

/**
 * Leaves group `groupId` the way a deletion that failed after the group
 * document went leaves it: a record, a member's profile and an account with
 * the group active, a descendant and a picture.
 */
async function seedStranded(groupId: string, requestedAgoMs: number) {
  await db.doc(`groupDeletions/${groupId}`)
    .set({requestedBy: "gandalf", requestedAt: ago(requestedAgoMs)});
  await db.doc(`groups/${groupId}/users/frodo-${groupId}`).set({userId: `frodo-${groupId}`, role: "member"});
  await db.doc(`users/frodo-${groupId}`).set({activeGroupId: groupId});
  await db.doc(`groups/${groupId}/campaigns/c1/npcs/n1`).set({name: "Bilbo"});
  await imageBucket().file(`groups/${groupId}/crest/a.webp`)
    .save(Buffer.from("x"), {contentType: "image/webp"});
}

beforeEach(async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  await clearProject(PROJECT);
  await imageBucket().deleteFiles({prefix: "groups/"});
});

afterEach(() => jest.restoreAllMocks());

describe("resumeGroupDeletions", () => {
  it("finishes a deletion left behind after the group document went", async () => {
    await seedStranded("g1", 2 * RESUME_AFTER_MS);

    const result = await resumeGroupDeletions(NOW);

    expect(result).toEqual({finished: ["g1"], failed: [], more: false});
    expect(await isThere("groups/g1/users/frodo-g1")).toBe(false);
    expect((await db.doc("users/frodo-g1").get()).get("activeGroupId")).toBeNull();
    expect(await isThere("groups/g1/campaigns/c1/npcs/n1")).toBe(false);
    expect(await fileExists("groups/g1/crest/a.webp")).toBe(false);
    expect(await isThere("groupDeletions/g1")).toBe(false);
  });

  it("leaves a deletion that may still be running to its caller", async () => {
    await seedStranded("g1", RESUME_AFTER_MS / 2);

    const result = await resumeGroupDeletions(NOW);

    expect(result.finished).toEqual([]);
    expect(await isThere("groups/g1/campaigns/c1/npcs/n1")).toBe(true);
    expect(await isThere("groupDeletions/g1")).toBe(true);
  });

  it("keeps the record of a deletion that fails again, and finishes the others", async () => {
    await seedStranded("g1", 2 * RESUME_AFTER_MS);
    await seedStranded("g2", 2 * RESUME_AFTER_MS);
    jest.spyOn(Firestore.prototype, "recursiveDelete")
      .mockRejectedValueOnce(new Error("injected: backend unavailable"));

    const result = await resumeGroupDeletions(NOW);

    expect(result.failed).toEqual(["g1"]);
    expect(result.finished).toEqual(["g2"]);
    expect(await isThere("groupDeletions/g1")).toBe(true);
    expect(await isThere("groupDeletions/g2")).toBe(false);
  });

  it("stops at its budget and says there is more", async () => {
    await seedStranded("g1", 2 * RESUME_AFTER_MS);
    await seedStranded("g2", 2 * RESUME_AFTER_MS);

    const result = await resumeGroupDeletions(NOW, 1);

    expect(result).toEqual({finished: ["g1"], failed: [], more: true});
    expect(await isThere("groupDeletions/g2")).toBe(true);
  });

  it("touches nothing when no deletion is pending", async () => {
    await db.doc("groups/g3/campaigns/c1/npcs/n1").set({name: "Sam"});

    const result = await resumeGroupDeletions(NOW);

    expect(result).toEqual({finished: [], failed: [], more: false});
    expect(await isThere("groups/g3/campaigns/c1/npcs/n1")).toBe(true);
  });
});
