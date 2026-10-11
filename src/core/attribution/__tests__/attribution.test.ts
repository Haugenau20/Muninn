// src/core/attribution/__tests__/attribution.test.ts

import { buildCreationAttribution, buildModificationAttribution, recordTimes, toTime } from "../attribution";

describe("attribution", () => {
  const uid = "user-123";

  const profileWithCharacter = {
    userId: uid,
    username: "alice",
    characters: [
      { id: "char-1", name: "Gandalf" },
      { id: "char-2", name: "Frodo" },
    ],
    activeCharacterId: "char-1",
  };

  describe("buildCreationAttribution", () => {
    test("maps all fields correctly from a realistic profile object", () => {
      const result = buildCreationAttribution({
        uid,
        activeGroupUserProfile: profileWithCharacter,
      });

      expect(result.createdBy).toBe(uid);
      expect(result.createdByUsername).toBe("alice");
      expect(result.createdByCharacterId).toBe("char-1");
      expect(result.createdByCharacterName).toBe("Gandalf");
      expect(result.modifiedBy).toBe(uid);
      expect(result.modifiedByUsername).toBe("alice");
      expect(result.modifiedByCharacterId).toBe("char-1");
      expect(result.modifiedByCharacterName).toBe("Gandalf");
    });

    test("sets created* and modified* to identical values", () => {
      const result = buildCreationAttribution({
        uid,
        activeGroupUserProfile: profileWithCharacter,
      });

      expect(result.modifiedBy).toBe(result.createdBy);
      expect(result.modifiedByUsername).toBe(result.createdByUsername);
      expect(result.modifiedByCharacterId).toBe(result.createdByCharacterId);
      expect(result.modifiedByCharacterName).toBe(result.createdByCharacterName);
    });

    test("yields null for character id/name fields when activeCharacterId is absent", () => {
      const profileWithoutCharacter = { userId: uid, username: "bob" };

      const result = buildCreationAttribution({
        uid,
        activeGroupUserProfile: profileWithoutCharacter,
      });

      expect(result.createdByCharacterId).toBeNull();
      expect(result.createdByCharacterName).toBeNull();
      expect(result.modifiedByCharacterId).toBeNull();
      expect(result.modifiedByCharacterName).toBeNull();
    });

    test("yields null for character id/name fields when profile is null", () => {
      const result = buildCreationAttribution({
        uid,
        activeGroupUserProfile: null,
      });

      expect(result.createdBy).toBe(uid);
      expect(result.createdByUsername).toBe("");
      expect(result.createdByCharacterId).toBeNull();
      expect(result.createdByCharacterName).toBeNull();
    });

    // T132: the times are the server's (`creationTimes`); no writer's clock.
    test("writes no client-clock time", () => {
      const result = buildCreationAttribution({
        uid,
        activeGroupUserProfile: profileWithCharacter,
      });

      expect(result).not.toHaveProperty("dateAdded");
      expect(result).not.toHaveProperty("dateModified");
    });
  });

  describe("buildModificationAttribution", () => {
    test("returns only the modified* fields (no created* keys, no client-clock time)", () => {
      const result = buildModificationAttribution({
        uid,
        activeGroupUserProfile: profileWithCharacter,
      });

      expect(Object.keys(result).sort()).toEqual(
        [
          "modifiedBy",
          "modifiedByCharacterId",
          "modifiedByCharacterName",
          "modifiedByUsername",
        ].sort()
      );
      expect(result).not.toHaveProperty("createdBy");
      expect(result).not.toHaveProperty("createdByUsername");
      expect(result).not.toHaveProperty("createdByCharacterId");
      expect(result).not.toHaveProperty("createdByCharacterName");
      expect(result).not.toHaveProperty("dateAdded");
    });

    test("maps fields correctly from a realistic profile object", () => {
      const result = buildModificationAttribution({
        uid,
        activeGroupUserProfile: profileWithCharacter,
      });

      expect(result.modifiedBy).toBe(uid);
      expect(result.modifiedByUsername).toBe("alice");
      expect(result.modifiedByCharacterId).toBe("char-1");
      expect(result.modifiedByCharacterName).toBe("Gandalf");
    });

    test("yields null for character id/name fields when activeCharacterId is absent", () => {
      const result = buildModificationAttribution({
        uid,
        activeGroupUserProfile: { userId: uid, username: "bob" },
      });

      expect(result.modifiedByCharacterId).toBeNull();
      expect(result.modifiedByCharacterName).toBeNull();
    });

    test("yields null for character id/name fields when profile is undefined", () => {
      const result = buildModificationAttribution({
        uid,
        activeGroupUserProfile: undefined,
      });

      expect(result.modifiedBy).toBe(uid);
      expect(result.modifiedByUsername).toBe("");
      expect(result.modifiedByCharacterId).toBeNull();
      expect(result.modifiedByCharacterName).toBeNull();
    });

    // T132: the time is the server's (`modificationTimes`).
    test("writes no client-clock time", () => {
      const result = buildModificationAttribution({
        uid,
        activeGroupUserProfile: profileWithCharacter,
      });

      expect(result).not.toHaveProperty("dateModified");
    });
  });
});

// T132: records carry the server's times; a record from before them may
// have only the old client-written strings, which readers fall back to.
describe("recordTimes", () => {
  const at = (iso: string) => ({ toDate: () => new Date(iso) });

  it("takes the server's times over the strings", () => {
    const times = recordTimes({
      createdAt: at("2026-10-01T10:00:00Z"),
      modifiedAt: at("2026-10-02T10:00:00Z"),
      dateAdded: "2020-01-01T00:00:00Z",
      dateModified: "2020-01-02T00:00:00Z",
    });
    expect(times.created?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(times.modified?.toISOString()).toBe("2026-10-02T10:00:00.000Z");
  });

  it("falls back to the strings, and a never-edited record to its creation", () => {
    const times = recordTimes({ dateAdded: "2020-01-01T00:00:00Z" });
    expect(times.created?.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(times.modified).toEqual(times.created);
  });

  it("reads a pending server time, or an unreadable string, as none", () => {
    expect(toTime({ isEqual: () => false })).toBeNull();
    expect(toTime("not a date")).toBeNull();
    expect(recordTimes(null)).toEqual({ created: null, modified: null });
  });

  // Nothing is written beside a server time any more, so a write still on
  // its way has no other time to show: it reads as now, when the server is
  // about to stamp it.
  it("reads a write still pending as now, the null the SDK gives and the sentinel alike", () => {
    const before = Date.now();
    const fromNull = recordTimes({ createdAt: null, modifiedAt: null });
    const fromSentinel = recordTimes({ createdAt: { isEqual: () => false } as never });
    for (const time of [fromNull.created, fromNull.modified, fromSentinel.created]) {
      expect(time?.getTime()).toBeGreaterThanOrEqual(before);
      expect(time?.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  it("an edit pending on an older record reads as now, not as its old string", () => {
    const times = recordTimes({ dateAdded: "2020-01-01T00:00:00Z", dateModified: "2020-01-02T00:00:00Z", modifiedAt: null });
    expect(times.created?.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(times.modified?.getFullYear()).toBe(new Date().getFullYear());
  });
});
