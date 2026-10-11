// functions/test/createCampaign.test.ts
//
// T128: campaigns are created through `createCampaign`, which counts them, so
// a group holds at most five.
import {call, clearProject, expectHttpsError, useEmulatorProject} from "./emulator";
import {campaignSlug, createCampaign} from "../src/campaignManagement/createCampaign";
import {MAX_GROUP_CAMPAIGNS} from "../src/groupManagement/groupLimits";

const PROJECT = "demo-create-campaign";
const db = useEmulatorProject(PROJECT);

const GROUP = "g1";

const create = (data: object, uid?: string) => call(createCampaign, data, uid) as Promise<{campaignId: string}>;

/** A group with an admin and a member, and an outsider in another group. */
async function seed() {
  await db.doc(`groups/${GROUP}`).set({name: "Fellowship"});
  for (const [uid, role] of [["gandalf", "admin"], ["frodo", "member"]]) {
    await db.doc(`users/${uid}`).set({id: uid, groups: [GROUP], activeGroupId: GROUP});
    await db.doc(`groups/${GROUP}/users/${uid}`).set({userId: uid, username: uid, role});
  }
  await db.doc("users/sauron").set({id: "sauron", groups: ["mordor"]});
}

const campaignCount = async () => (await db.collection(`groups/${GROUP}/campaigns`).count().get()).data().count;

async function fillTo(total: number) {
  for (let i = 0; i < total; i++) {
    await db.doc(`groups/${GROUP}/campaigns/c${i}`).set({name: `Campaign ${i}`});
  }
}

beforeEach(async () => {
  await clearProject(PROJECT);
  await seed();
});

describe("createCampaign", () => {
  it("lets any member create one, named by its slug, and makes it their active campaign", async () => {
    const {campaignId} = await create({groupId: GROUP, name: "The Salt Road", description: "Smugglers"}, "frodo");

    expect(campaignId).toBe("the-salt-road");
    const campaign = (await db.doc(`groups/${GROUP}/campaigns/the-salt-road`).get()).data();
    expect(campaign).toMatchObject({name: "The Salt Road", description: "Smugglers", createdBy: "frodo", isActive: true});
    expect((await db.doc(`groups/${GROUP}/users/frodo`).get()).get("activeCampaignId")).toBe("the-salt-road");
  });

  it("lets a member the array does not list create one: the profile is the membership (T136)", async () => {
    await db.doc("users/frodo").update({groups: []});
    const {campaignId} = await create({groupId: GROUP, name: "The Salt Road"}, "frodo");

    expect(campaignId).toBe("the-salt-road");
  });

  it("gives a second campaign of the same name an id of its own, leaving the first alone", async () => {
    await create({groupId: GROUP, name: "The Salt Road"}, "frodo");
    const {campaignId} = await create({groupId: GROUP, name: "The Salt Road"}, "gandalf");

    expect(campaignId).toMatch(/^the-salt-road-[0-9a-f]{6}$/);
    expect((await db.doc(`groups/${GROUP}/campaigns/the-salt-road`).get()).get("createdBy")).toBe("frodo");
  });

  describe("a group's campaign limit", () => {
    it("refuses one more once the group has five, and creates nothing", async () => {
      await fillTo(MAX_GROUP_CAMPAIGNS);
      const error = await expectHttpsError(create({groupId: GROUP, name: "One too many"}, "frodo"), "resource-exhausted");
      expect(error.message).toMatch(/most a group may have/);
      expect(await campaignCount()).toBe(MAX_GROUP_CAMPAIGNS);
    });

    it("takes the last place", async () => {
      await fillTo(MAX_GROUP_CAMPAIGNS - 1);
      await create({groupId: GROUP, name: "The last one"}, "frodo");
      expect(await campaignCount()).toBe(MAX_GROUP_CAMPAIGNS);
    });

    it("gives a deleted campaign's place back", async () => {
      await fillTo(MAX_GROUP_CAMPAIGNS);
      await db.doc(`groups/${GROUP}/campaigns/c0`).delete();
      await create({groupId: GROUP, name: "In its place"}, "frodo");
      expect(await campaignCount()).toBe(MAX_GROUP_CAMPAIGNS);
    });

    it("lets only one of two members racing for the last place create one", async () => {
      await fillTo(MAX_GROUP_CAMPAIGNS - 1);
      const results = await Promise.allSettled([
        create({groupId: GROUP, name: "Frodo's"}, "frodo"),
        create({groupId: GROUP, name: "Gandalf's"}, "gandalf"),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await campaignCount()).toBe(MAX_GROUP_CAMPAIGNS);
    });
  });

  describe("refuses", () => {
    it("an anonymous caller", async () => {
      await expectHttpsError(create({groupId: GROUP, name: "X"}), "unauthenticated");
    });

    it("someone who is not a member, and creates nothing", async () => {
      await expectHttpsError(create({groupId: GROUP, name: "Mordor"}, "sauron"), "permission-denied");
      expect(await campaignCount()).toBe(0);
    });

    // A member is someone with a group profile there (T136): the array
    // listing the group is not enough.
    it("someone the array lists with no profile there, and creates nothing", async () => {
      await db.doc("users/sauron").update({groups: ["mordor", GROUP]});
      await expectHttpsError(create({groupId: GROUP, name: "Mordor"}, "sauron"), "permission-denied");
      expect(await campaignCount()).toBe(0);
    });

    it("a group that does not exist", async () => {
      await db.doc("users/frodo").update({groups: [GROUP, "ghost"]});
      await expectHttpsError(create({groupId: "ghost", name: "X"}, "frodo"), "permission-denied");
    });

    it("a group being deleted (T037)", async () => {
      await db.doc(`groups/${GROUP}`).update({deleting: true});
      await expectHttpsError(create({groupId: GROUP, name: "X"}, "frodo"), "failed-precondition");
    });

    it.each([
      ["no group", {name: "X"}],
      ["no name", {groupId: GROUP}],
      ["a blank name", {groupId: GROUP, name: "   "}],
      ["a name over 200 characters", {groupId: GROUP, name: "x".repeat(201)}],
      ["a description over 10,000 characters", {groupId: GROUP, name: "X", description: "x".repeat(10_001)}],
      ["a description that is not text", {groupId: GROUP, name: "X", description: 7}],
    ])("%s", async (_what, data) => {
      await expectHttpsError(create(data, "frodo"), "invalid-argument");
      expect(await campaignCount()).toBe(0);
    });
  });
});

describe("campaignSlug", () => {
  it("lower-cases and joins words with single hyphens", () => {
    expect(campaignSlug("  The Dark Rising! ")).toBe("the-dark-rising");
  });

  it("names a campaign with no letters or digits `campaign`", () => {
    expect(campaignSlug("!!!")).toBe("campaign");
  });
});
