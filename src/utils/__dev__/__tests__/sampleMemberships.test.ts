// src/utils/__dev__/__tests__/sampleMemberships.test.ts
// The seed carries the two membership states a browser check keeps needing
// and the dataset used to lack: an account in no group (where a first-time
// invitee, or someone who left their only group, lands), and a second admin
// in group 1 (for role changes and the last-admin guard).

jest.mock("firebase/firestore", () => ({
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join("/")),
  setDoc: jest.fn(() => Promise.resolve()),
}));

jest.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: jest.fn((_auth: unknown, email: string) =>
    Promise.resolve({ user: { uid: `uid-${email}` } })
  ),
  signInWithEmailAndPassword: jest.fn(),
}));

import { setDoc } from "firebase/firestore";
import { createSampleUsers, createUserProfiles, UserData } from "../generators/userGenerator";
import { addUsersToGroups } from "../generators/groupGenerator";

const mockSetDoc = setDoc as jest.Mock;

/** Every document written, keyed by its path. */
const writes = (): Record<string, any> =>
  Object.fromEntries(mockSetDoc.mock.calls.map(([path, data]) => [path, data]));

let users: UserData[];

beforeEach(async () => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  mockSetDoc.mockClear();
  ({ users } = await createSampleUsers({}));
});

afterEach(() => jest.restoreAllMocks());

const uidOf = (username: string) => users.find((u) => u.username === username)!.id;

describe("sample memberships", () => {
  it("seeds an account that belongs to no group", async () => {
    await createUserProfiles({}, users);

    const profile = writes()[`users/${uidOf("Faramir")}`];
    // The shape `removeUserFromGroup` leaves behind for someone whose last
    // group is gone -- not a missing field.
    expect(profile.groups).toEqual([]);
    expect(profile.activeGroupId).toBeNull();
  });

  it("gives that account no membership document anywhere", async () => {
    await addUsersToGroups({}, users, { group1Id: "group1", group2Id: "group2" }, "2026-09-24");

    const faramir = uidOf("Faramir");
    expect(Object.keys(writes()).filter((path) => path.includes(faramir))).toEqual([]);
  });

  it("seeds a second admin in group 1", async () => {
    await addUsersToGroups({}, users, { group1Id: "group1", group2Id: "group2" }, "2026-09-24");

    const admins = Object.entries(writes())
      .filter(([path, data]) => path.startsWith("groups/group1/users/") && data.role === "admin")
      .map(([, data]) => data.username);
    expect(admins.sort()).toEqual(["DungeonMaster", "Eowyn"]);
  });

  it("keeps the profile's group list and the membership documents in agreement", async () => {
    await createUserProfiles({}, users);
    await addUsersToGroups({}, users, { group1Id: "group1", group2Id: "group2" }, "2026-09-24");

    const all = writes();
    for (const user of users) {
      const listed = all[`users/${user.id}`].groups;
      const joined = ["group1", "group2"].filter((g) => all[`groups/${g}/users/${user.id}`]);
      expect({ user: user.username, groups: joined }).toEqual({ user: user.username, groups: listed });
    }
  });

  // The app lists a user's groups by the group profiles naming them in
  // `userId` (T136); the seed wrote none, so every seeded user had no group.
  it("names each group profile's holder, as the app's group list reads it", async () => {
    await addUsersToGroups({}, users, { group1Id: "group1", group2Id: "group2" }, "2026-09-24");

    const profiles = Object.entries(writes()).filter(([path]) => /^groups\/[^/]+\/users\/[^/]+$/.test(path));
    expect(profiles.length).toBeGreaterThan(0);
    for (const [path, data] of profiles) {
      expect({ path, userId: data.userId }).toEqual({ path, userId: path.split("/")[3] });
    }
  });

  // The app reads characters as `{id, name}` entries (`CharacterNameEntry`).
  // The seed wrote bare strings, and the profile page crashed on the first
  // one: its character row hashes the missing id.
  it("seeds characters in the shape the app reads", async () => {
    await addUsersToGroups({}, users, { group1Id: "group1", group2Id: "group2" }, "2026-09-24");

    const profiles = Object.entries(writes()).filter(([path]) => /^groups\/[^/]+\/users\/[^/]+$/.test(path));
    const characters = profiles.flatMap(([, data]) => data.characters);
    expect(characters.length).toBeGreaterThan(0);
    for (const character of characters) {
      expect(character).toEqual({ id: expect.any(String), name: expect.any(String) });
    }
  });
});
