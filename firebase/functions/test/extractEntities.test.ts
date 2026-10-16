// functions/test/extractEntities.test.ts
//
// T019: smart detection must not suggest the party -- a member's username or
// any of their characters -- as NPCs.
// OpenAI is replaced with a stub that records the prompt and returns what the
// test tells it to; everything else -- the roster read, the membership check,
// usage counting -- runs against the emulator.
import {Timestamp} from "firebase-admin/firestore";
import {call, clearProject, expectHttpsError, useEmulatorProject} from "./emulator";

const mockCreate = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({chat: {completions: {create: mockCreate}}})),
}));

// eslint-disable-next-line import/first
import {extractEntities, getUsageStatus} from "../src/entityExtraction";

const PROJECT = "demo-extract-entities";
const db = useEmulatorProject(PROJECT);
const GROUP = "g1";
const CONTENT = "Aragorn and Legolas met Barliman Butterbur at the Prancing Pony.";

const npc = (name: string) => ({
  type: "npc", text: name, confidence: 0.9, name, title: null, race: null,
  occupation: null, location: null, relationship: null, description: null, context: "",
});

/** The model's answer: a tool call carrying `entities`. */
function modelReturns(entities: object[]) {
  mockCreate.mockResolvedValueOnce({
    choices: [{message: {
      refusal: null,
      tool_calls: [{type: "function", function: {
        name: "extract_entities",
        arguments: JSON.stringify({entities}),
      }}],
    }}],
  });
}

const systemPrompt = (): string => mockCreate.mock.calls[0][0].messages[0].content;
const extract = (data: object, uid?: string) =>
  call(extractEntities, data, uid) as Promise<{entities: {name?: string}[]}>;

async function seedGroup() {
  await db.doc(`groups/${GROUP}`).set({name: "Fellowship"});
  await db.doc(`groups/${GROUP}/users/frodo`).set({
    userId: "frodo", username: "frodo", role: "member",
    characters: [{id: "c1", name: "Aragorn"}, {id: "c2", name: " Legolas "}],
  });
  await db.doc(`groups/${GROUP}/users/sam`).set({
    userId: "sam", username: "sam", role: "member",
    characters: [{id: "c3", name: "Aragorn"}, {id: "c4", name: ""}],
  });
  await db.doc(`groups/${GROUP}/users/pippin`).set({userId: "pippin", username: "pippin", role: "member"});
}

beforeAll(() => {
  process.env.OPENAI_API_KEY = "test-key";
});

beforeEach(async () => {
  await clearProject(PROJECT);
  mockCreate.mockReset();
  await seedGroup();
});

describe("extractEntities and the party's own characters", () => {
  it("names every character in the group to the model, once each", async () => {
    modelReturns([]);
    await extract({content: CONTENT, groupId: GROUP}, "frodo");

    const prompt = systemPrompt();
    expect(prompt).toContain("\"Aragorn\"");
    expect(prompt).toContain("\"Legolas\"");
    expect(prompt.match(/"Aragorn"/g)).toHaveLength(1);
    expect(prompt).not.toContain("\"\"");
  });

  it("names the members by the username they signed up with, too", async () => {
    modelReturns([]);
    await extract({content: CONTENT, groupId: GROUP}, "frodo");

    const prompt = systemPrompt();
    for (const username of ["frodo", "sam", "pippin"]) {
      expect(prompt).toContain(JSON.stringify(username));
    }
  });

  it("drops a member's username the model returned as an NPC", async () => {
    modelReturns([npc("Pippin"), npc("Barliman Butterbur")]);
    const result = await extract({content: CONTENT, groupId: GROUP}, "frodo");

    expect(result.entities.map((e) => e.name)).toEqual(["Barliman Butterbur"]);
  });

  it("drops a party character the model returned anyway, and keeps the real NPC", async () => {
    modelReturns([npc("Aragorn"), npc("legolas"), npc("Barliman Butterbur")]);
    const result = await extract({content: CONTENT, groupId: GROUP}, "frodo");

    expect(result.entities.map((e) => e.name)).toEqual(["Barliman Butterbur"]);
  });

  it("drops only NPCs -- a location that shares a name is not a character", async () => {
    modelReturns([{type: "location", name: "Aragorn", text: "", confidence: 1, context: ""}]);
    const result = await extract({content: CONTENT, groupId: GROUP}, "frodo");

    expect(result.entities).toHaveLength(1);
  });

  it("excludes nobody when the caller sends no group, as an older client does", async () => {
    modelReturns([npc("Aragorn")]);
    const result = await extract({content: CONTENT}, "frodo");

    expect(result.entities.map((e) => e.name)).toEqual(["Aragorn"]);
    expect(systemPrompt()).not.toContain("They are the party");
  });

  it("refuses a caller outside the group, before calling the model or counting usage", async () => {
    await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "sauron"), "permission-denied");

    expect(mockCreate).not.toHaveBeenCalled();
    expect((await db.doc("users/sauron").get()).exists).toBe(false);
  });

  it("refuses a group id that is not a string", async () => {
    await expectHttpsError(extract({content: CONTENT, groupId: 42}, "frodo"), "invalid-argument");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// T087: the allowance is reserved atomically, and a status read writes nothing.
// T129: the allowance is 3 a day, 5 a week and 10 a month (maintainer, 2026-10-08).
describe("the usage allowance", () => {
  /**
   * A usage record with the given counts spent, reset today. Its stored limits
   * are the old, larger ones every record written before T129 carries: the
   * server's limits must win over what a record says.
   */
  const usage = (
    used: {daily?: number; weekly?: number; monthly?: number},
    lastReset = new Date().toISOString(),
    limits = {daily: 10, weekly: 30, monthly: 100}
  ) => ({
    daily: {count: used.daily ?? 0, lastReset, limit: limits.daily},
    weekly: {count: used.weekly ?? 0, lastReset, limit: limits.weekly},
    monthly: {count: used.monthly ?? 0, lastReset, limit: limits.monthly},
  });
  const storedUsage = async () =>
    (await db.doc("users/frodo").get()).get("entityExtractionUsage");
  const answerEveryCall = () => mockCreate.mockResolvedValue({
    choices: [{message: {refusal: null, tool_calls: [{type: "function", function: {
      name: "extract_entities", arguments: JSON.stringify({entities: []}),
    }}]}}],
  });

  it("admits a third call in a day, and refuses a fourth", async () => {
    await db.doc("users/frodo").set({entityExtractionUsage: usage({daily: 2, weekly: 2, monthly: 2})});
    modelReturns([]);

    await extract({content: CONTENT, groupId: GROUP}, "frodo");
    await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "resource-exhausted");

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses a sixth call in a week, however the days fell", async () => {
    await db.doc("users/frodo").set({entityExtractionUsage: usage({daily: 0, weekly: 5, monthly: 5})});

    await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "resource-exhausted");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses an eleventh call in a month", async () => {
    await db.doc("users/frodo").set({entityExtractionUsage: usage({daily: 0, weekly: 0, monthly: 10})});

    await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "resource-exhausted");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("holds a record written under the old limits to the new ones", async () => {
    await db.doc("users/frodo").set({entityExtractionUsage: usage({daily: 3, weekly: 3, monthly: 3})});

    await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "resource-exhausted");
    expect(mockCreate).not.toHaveBeenCalled();

    const result = await call(getUsageStatus, {}, "frodo") as {
      usage: {usage: {daily: {limit: number}; weekly: {limit: number}; monthly: {limit: number}}};
    };
    expect(result.usage.usage.daily.limit).toBe(3);
    expect(result.usage.usage.weekly.limit).toBe(5);
    expect(result.usage.usage.monthly.limit).toBe(10);
  });

  it("gives a new user the new limits", async () => {
    modelReturns([]);
    await extract({content: CONTENT, groupId: GROUP}, "frodo");

    const stored = await storedUsage();
    expect([stored.daily.limit, stored.weekly.limit, stored.monthly.limit]).toEqual([3, 5, 10]);
  });

  it("admits exactly one of several calls racing for the last slot (SEC-003)", async () => {
    await db.doc("users/frodo").set({entityExtractionUsage: usage({daily: 2, weekly: 2, monthly: 2})});
    answerEveryCall();

    const outcomes = await Promise.allSettled(
      Array.from({length: 4}, () => extract({content: CONTENT, groupId: GROUP}, "frodo"))
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    for (const o of outcomes.filter((o) => o.status === "rejected")) {
      expect((o as PromiseRejectedResult).reason.code).toBe("resource-exhausted");
    }
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const stored = await storedUsage();
    expect(stored.daily.count).toBe(3);
    expect(stored.weekly.count).toBe(3);
    expect(stored.monthly.count).toBe(3);
  });

  it("counts every admitted call when several race with room to spare", async () => {
    answerEveryCall();

    await Promise.all(
      Array.from({length: 3}, () => extract({content: CONTENT, groupId: GROUP}, "frodo"))
    );

    expect((await storedUsage()).daily.count).toBe(3);
  });

  it("reports a period that has rolled over as reset, without writing it back", async () => {
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const before = usage({daily: 3}, yesterday);
    await db.doc("users/frodo").set({entityExtractionUsage: before});

    const result = await call(getUsageStatus, {}, "frodo") as {
      usage: {limitExceeded: boolean; usage: {daily: {count: number}}};
    };

    expect(result.usage.limitExceeded).toBe(false);
    expect(result.usage.usage.daily.count).toBe(0);
    // A status read that wrote its copy back could overwrite a reservation
    // made in between; the next reservation does the reset instead.
    expect(await storedUsage()).toEqual(before);
  });

  it("resets a rolled-over period when it reserves", async () => {
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await db.doc("users/frodo").set({entityExtractionUsage: usage({daily: 3}, yesterday)});
    modelReturns([]);

    await extract({content: CONTENT, groupId: GROUP}, "frodo");

    expect((await storedUsage()).daily.count).toBe(1);
  });
});

// T137: one person's limits can be raised, lowered or lifted, optionally until
// a date, by `users/{uid}.extractionAllowance`. The fields that came before it,
// `isUnlimited` and `customLimit`, grant nothing any more (step 7).
describe("a person's extraction allowance", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const today = () => new Date().toISOString();
  const counts = (daily: number, weekly: number, monthly: number) => ({
    daily: {count: daily, lastReset: today(), limit: 3},
    weekly: {count: weekly, lastReset: today(), limit: 5},
    monthly: {count: monthly, lastReset: today(), limit: 10},
  });
  const allowance = (
    limits: {daily: number; weekly: number; monthly: number} | null,
    expiresAt: Date | null = null
  ) => ({
    unlimited: limits === null,
    limits,
    expiresAt: expiresAt && Timestamp.fromDate(expiresAt),
    setAt: Timestamp.now(),
  });

  type Usage = {
    isUnlimited: boolean;
    raisedUntil?: string;
    daily: {limit: number};
    weekly: {limit: number};
    monthly: {limit: number};
  };
  const status = async () =>
    (await call(getUsageStatus, {}, "frodo") as {usage: {limitExceeded: boolean; usage: Usage}}).usage;
  const limitsOf = (usage: Usage) => [usage.daily.limit, usage.weekly.limit, usage.monthly.limit];
  const storedUsage = async () =>
    (await db.doc("users/frodo").get()).get("entityExtractionUsage");
  const answerEveryCall = () => mockCreate.mockResolvedValue({
    choices: [{message: {refusal: null, tool_calls: [{type: "function", function: {
      name: "extract_entities", arguments: JSON.stringify({entities: []}),
    }}]}}],
  });

  beforeEach(answerEveryCall);

  it("raises every period, not only the day", async () => {
    await db.doc("users/frodo").set({
      entityExtractionUsage: counts(9, 20, 30),
      extractionAllowance: allowance({daily: 10, weekly: 40, monthly: 80}),
    });

    await extract({content: CONTENT, groupId: GROUP}, "frodo");
    await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "resource-exhausted");

    const usage = (await status()).usage;
    expect(limitsOf(usage)).toEqual([10, 40, 80]);
    expect(usage.isUnlimited).toBe(false);
    expect(usage.raisedUntil).toBeUndefined();
  });

  it("holds the raised week and month too", async () => {
    await db.doc("users/frodo").set({
      entityExtractionUsage: counts(0, 39, 39),
      extractionAllowance: allowance({daily: 10, weekly: 40, monthly: 80}),
    });

    await extract({content: CONTENT, groupId: GROUP}, "frodo");
    const refused = await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "resource-exhausted");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect((refused.details as {usage: {exceededPeriod: string}}).usage.exceededPeriod).toBe("weekly");
  });

  it("can lower a limit below the default, down to none", async () => {
    await db.doc("users/frodo").set({extractionAllowance: allowance({daily: 0, weekly: 5, monthly: 10})});

    await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "resource-exhausted");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("lifts the limits altogether when unlimited, and counts nothing", async () => {
    await db.doc("users/frodo").set({
      entityExtractionUsage: counts(3, 5, 10),
      extractionAllowance: allowance(null),
    });

    await extract({content: CONTENT, groupId: GROUP}, "frodo");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect((await status()).usage.isUnlimited).toBe(true);
    expect((await storedUsage()).daily.count).toBe(3);
  });

  it("applies until its date, and says until when", async () => {
    const until = new Date(Date.now() + 7 * DAY);
    await db.doc("users/frodo").set({
      entityExtractionUsage: counts(5, 5, 5),
      extractionAllowance: allowance({daily: 10, weekly: 40, monthly: 80}, until),
    });

    await extract({content: CONTENT, groupId: GROUP}, "frodo");

    const usage = (await status()).usage;
    expect(limitsOf(usage)).toEqual([10, 40, 80]);
    expect(usage.raisedUntil).toBe(until.toISOString());
  });

  it("stops applying once its date has passed, and the defaults are back", async () => {
    await db.doc("users/frodo").set({
      entityExtractionUsage: counts(3, 3, 3),
      extractionAllowance: allowance(null, new Date(Date.now() - DAY)),
    });

    await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "resource-exhausted");

    const usage = (await status()).usage;
    expect(usage.isUnlimited).toBe(false);
    expect(limitsOf(usage)).toEqual([3, 5, 10]);
    expect(usage.raisedUntil).toBeUndefined();
  });


  it("is ignored when malformed, and grants nothing", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await db.doc("users/frodo").set({
      entityExtractionUsage: counts(3, 3, 3),
      extractionAllowance: {unlimited: "yes", limits: {daily: 50, weekly: "lots", monthly: 500}},
    });

    await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "resource-exhausted");

    const usage = (await status()).usage;
    expect(usage.isUnlimited).toBe(false);
    expect(limitsOf(usage)).toEqual([3, 5, 10]);
  });

  it("is the only thing that raises a limit: the old isUnlimited lifts nothing", async () => {
    await db.doc("users/frodo").set({entityExtractionUsage: {...counts(3, 3, 3), isUnlimited: true}});

    await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "resource-exhausted");

    expect(mockCreate).not.toHaveBeenCalled();
    const usage = (await status()).usage;
    expect(usage.isUnlimited).toBe(false);
    expect(limitsOf(usage)).toEqual([3, 5, 10]);
  });

  it("is the only thing that raises a limit: the old customLimit raises nothing", async () => {
    await db.doc("users/frodo").set({entityExtractionUsage: {...counts(3, 3, 3), customLimit: 50}});

    await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "resource-exhausted");

    expect(mockCreate).not.toHaveBeenCalled();
    expect(limitsOf((await status()).usage)).toEqual([3, 5, 10]);
  });

  it("is never written by counting a call", async () => {
    const stored = {
      unlimited: false,
      limits: {daily: 10, weekly: 40, monthly: 80},
      expiresAt: null,
      setAt: Timestamp.fromMillis(1_000_000),
    };
    await db.doc("users/frodo").set({
      entityExtractionUsage: counts(1, 1, 1),
      extractionAllowance: stored,
    });

    await extract({content: CONTENT, groupId: GROUP}, "frodo");

    const profile = (await db.doc("users/frodo").get()).data();
    expect(profile?.extractionAllowance).toEqual(stored);
    expect(profile?.entityExtractionUsage).not.toHaveProperty("isUnlimited");
    expect(profile?.entityExtractionUsage).not.toHaveProperty("raisedUntil");
    expect(profile?.entityExtractionUsage.daily.count).toBe(2);
  });
});

// T129: the OpenAI account is prepaid with no top-up; when it runs dry the
// model refuses every call, and players are told extraction is paused.
describe("when the OpenAI balance has run out", () => {
  /** What the OpenAI SDK throws when the account has no credit left. */
  const outOfCredit = () => Object.assign(
    new Error("429 You exceeded your current quota, please check your plan and billing details."),
    {status: 429, code: "insufficient_quota", type: "insufficient_quota"}
  );
  const storedUsage = async () =>
    (await db.doc("users/frodo").get()).get("entityExtractionUsage");

  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("says extraction is paused, not that it failed", async () => {
    mockCreate.mockRejectedValueOnce(outOfCredit());

    const error = await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "unavailable");
    expect(error.message).toBe("AI_EXTRACTION_PAUSED");
  });

  it("gives back the call it had counted", async () => {
    const lastReset = new Date().toISOString();
    await db.doc("users/frodo").set({entityExtractionUsage: {
      daily: {count: 1, lastReset, limit: 3},
      weekly: {count: 2, lastReset, limit: 5},
      monthly: {count: 4, lastReset, limit: 10},
    }});
    mockCreate.mockRejectedValueOnce(outOfCredit());

    await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "unavailable");

    const stored = await storedUsage();
    expect([stored.daily.count, stored.weekly.count, stored.monthly.count]).toEqual([1, 2, 4]);
  });

  it("still reports any other model failure as a failure", async () => {
    mockCreate.mockRejectedValueOnce(Object.assign(new Error("500 server error"), {status: 500}));

    await expectHttpsError(extract({content: CONTENT, groupId: GROUP}, "frodo"), "internal");
  });
});

// T087 (AI-002): confidence is a fraction, and the server holds the model to it.
describe("the confidence the model reports", () => {
  it("passes a confidence from 0 to 1 through", async () => {
    modelReturns([{...npc("Butterbur"), confidence: 0}, {...npc("Bill Ferny"), confidence: 1}]);
    const result = await extract({content: CONTENT, groupId: GROUP}, "frodo");

    expect(result.entities.map((e) => e.name)).toEqual(["Butterbur", "Bill Ferny"]);
  });

  it("drops a detection whose confidence is not a fraction, rather than guess what it meant", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    modelReturns([
      {...npc("Butterbur"), confidence: 90},
      {...npc("Bill Ferny"), confidence: -0.4},
      {...npc("Nob"), confidence: 0.7},
    ]);
    const result = await extract({content: CONTENT, groupId: GROUP}, "frodo");

    expect(result.entities.map((e) => e.name)).toEqual(["Nob"]);
  });

  it("tells the model the scale", async () => {
    modelReturns([]);
    await extract({content: CONTENT, groupId: GROUP}, "frodo");

    const tool = mockCreate.mock.calls[0][0].tools[0];
    const variants = tool.function.parameters.properties.entities.items.anyOf;
    for (const variant of variants) {
      expect(variant.properties.confidence.description).toMatch(/0 to 1/);
    }
  });
});
