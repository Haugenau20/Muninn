// functions/test/publishImage.test.ts
//
// T163: publishing a private record copies its picture to the campaign's
// folder, with a new name, a new download token and a lease in the caller's
// name -- for its author alone, while a member, into a campaign that takes
// writes.
import {call, clearProject, expectHttpsError, useEmulatorProject} from "./emulator";
import {publishImage} from "../src/imageMaintenance/publishImage";
import {imageBucket} from "../src/shared/imageBucket";

const PROJECT = "demo-publish-image";
const db = useEmulatorProject(PROJECT);
const GROUP = "g1";
const SOURCE = `groups/${GROUP}/users/frodo/campaigns/c1/npcs/gollum/0a1b2c3d-0000-4000-8000-000000000001.webp`;

const exists = async (path: string) => (await imageBucket().file(path).exists())[0];
const publish = (uid: string, data: Record<string, unknown> = {}) =>
  call(publishImage, {groupId: GROUP, path: SOURCE, recordId: "gollum", ...data}, uid);

beforeEach(async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  await clearProject(PROJECT);
  await imageBucket().deleteFiles({prefix: "groups/"});

  await db.doc(`groups/${GROUP}/users/frodo`).set({userId: "frodo", role: "member"});
  await db.doc(`groups/${GROUP}/users/gandalf`).set({userId: "gandalf", role: "admin"});
  await db.doc(`groups/${GROUP}/campaigns/c1`).set({name: "There and back"});
  await imageBucket().file(SOURCE).save(Buffer.from("picture"), {
    contentType: "image/webp",
    metadata: {metadata: {firebaseStorageDownloadTokens: "private-token"}},
  });
});

afterEach(() => jest.restoreAllMocks());

describe("publishing a private picture", () => {
  it("copies it into the campaign's folder for the record, under a new name", async () => {
    const {path} = await publish("frodo", {recordId: "gollum-2"}) as {path: string};

    expect(path).toMatch(new RegExp(`^groups/${GROUP}/campaigns/c1/npcs/gollum-2/[0-9a-f-]{36}\.webp$`));
    expect(await exists(path)).toBe(true);
    const [contents] = await imageBucket().file(path).download();
    expect(contents.toString()).toBe("picture");
    // The private file is the caller's to release.
    expect(await exists(SOURCE)).toBe(true);
  });

  it("gives the copy a token of its own, and the immutable cache header", async () => {
    const {path} = await publish("frodo") as {path: string};
    const [metadata] = await imageBucket().file(path).getMetadata();

    expect(metadata.cacheControl).toBe("public, max-age=31536000, immutable");
    const token = (metadata.metadata as Record<string, string>)?.firebaseStorageDownloadTokens;
    expect(token).toBeTruthy();
    expect(token).not.toBe("private-token");
  });

  it("leases the copy in the caller's name, so the publish may point at it", async () => {
    const {path} = await publish("frodo") as {path: string};
    const entry = await db.doc(`groups/${GROUP}/pendingUploads/${path.split("/").pop()}`).get();

    expect(entry.data()).toMatchObject({path, uid: "frodo"});
    expect(entry.get("createdAt")).toBeTruthy();
  });

  it("refuses anyone but its author, the group's admin included", async () => {
    await expectHttpsError(publish("gandalf"), "permission-denied");
  });

  it("refuses its author once they have left the group", async () => {
    await db.doc(`groups/${GROUP}/users/frodo`).delete();
    await expectHttpsError(publish("frodo"), "permission-denied");
  });

  it("refuses a campaign being deleted", async () => {
    await db.doc(`groups/${GROUP}/campaigns/c1`).update({deleting: true});
    await expectHttpsError(publish("frodo"), "failed-precondition");
  });

  it("refuses a picture that is gone", async () => {
    await imageBucket().file(SOURCE).delete();
    await expectHttpsError(publish("frodo"), "not-found");
  });

  it("refuses what is not a private picture, or a record id the app would not make", async () => {
    await expectHttpsError(
      publish("frodo", {path: `groups/${GROUP}/campaigns/c1/npcs/bilbo/0a1b2c3d-0000-4000-8000-000000000002.webp`}),
      "invalid-argument"
    );
    await expectHttpsError(publish("frodo", {groupId: "g2"}), "invalid-argument");
    await expectHttpsError(publish("frodo", {recordId: "../escape"}), "invalid-argument");
  });

  it("refuses a signed-out caller", async () => {
    await expectHttpsError(call(publishImage, {groupId: GROUP, path: SOURCE, recordId: "gollum"}), "unauthenticated");
  });
});
