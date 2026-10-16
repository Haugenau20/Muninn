// functions/test/operator/allowances.test.ts
//
// T137: the operator sets one person's extraction allowance, within bounds,
// only on a profile that exists, and moves them off the old fields as it does.
import {Timestamp} from "firebase-admin/firestore";
import {call, clearProject, useEmulatorProject} from "../emulator";
import {getUsageStatus} from "../../src/entityExtraction";
import {
  ALLOWANCE_BOUNDS,
  AllowanceRequest,
  clearAllowance,
  setAllowance,
  validateAllowance,
} from "../../src/operator/allowances";
import {Refusal} from "../../src/shared/refusal";

const PROJECT = "demo-operator-allowances";
const db = useEmulatorProject(PROJECT);
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-08T12:00:00Z");
const RAISED = {daily: 10, weekly: 40, monthly: 80};

const profile = () => db.doc("users/frodo");

/** Asserts `action` is refused for `reason`, and returns the message. */
async function expectRefusal(action: () => unknown, reason: string): Promise<string> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Refusal);
  expect((caught as Refusal).reason).toBe(reason);
  return (caught as Refusal).message;
}

beforeEach(async () => {
  await clearProject(PROJECT);
  await profile().set({
    id: "frodo",
    groups: ["fellowship"],
    entityExtractionUsage: {
      daily: {count: 2, lastReset: new Date().toISOString(), limit: 3},
      weekly: {count: 2, lastReset: new Date().toISOString(), limit: 5},
      monthly: {count: 2, lastReset: new Date().toISOString(), limit: 10},
    },
  });
});

describe("the bounds", () => {
  it("are 50 a day, 150 a week and 500 a month", () => {
    expect(ALLOWANCE_BOUNDS).toEqual({daily: 50, weekly: 150, monthly: 500});
    expect(validateAllowance({unlimited: false, limits: {...ALLOWANCE_BOUNDS}}, NOW).limits)
      .toEqual(ALLOWANCE_BOUNDS);
  });

  it.each([
    ["daily", 51],
    ["weekly", 151],
    ["monthly", 501],
    ["daily", -1],
    ["weekly", 2.5],
    ["monthly", Number.NaN],
  ])("refuse a %s limit of %s, and name the period", async (period, value) => {
    const request = {unlimited: false, limits: {...RAISED, [period]: value}};
    const message = await expectRefusal(() => validateAllowance(request, NOW), "invalid_input");
    expect(message).toContain(period);
  });

  it("refuse limits as strings", async () => {
    const request = {unlimited: false, limits: {daily: "10", weekly: 40, monthly: 80}} as unknown as AllowanceRequest;
    await expectRefusal(() => validateAllowance(request, NOW), "invalid_input");
  });

  it("allow 0, which stops someone using it at all", () => {
    expect(validateAllowance({unlimited: false, limits: {daily: 0, weekly: 0, monthly: 0}}, NOW).limits)
      .toEqual({daily: 0, weekly: 0, monthly: 0});
  });

  it("need limits unless unlimited", async () => {
    await expectRefusal(() => validateAllowance({unlimited: false}, NOW), "invalid_input");
    await expectRefusal(
      () => validateAllowance({unlimited: "yes"} as unknown as AllowanceRequest, NOW),
      "invalid_input"
    );
  });

  it("store no limits when unlimited", () => {
    expect(validateAllowance({unlimited: true, limits: RAISED}, NOW))
      .toEqual({unlimited: true, limits: null, expiresAt: null});
  });

  it("take an end date in the future, a year away at most", async () => {
    const inAYear = new Date("2027-10-08T12:00:00Z");
    expect(validateAllowance({unlimited: true, expiresAt: inAYear}, NOW).expiresAt?.toDate())
      .toEqual(inAYear);

    await expectRefusal(
      () => validateAllowance({unlimited: true, expiresAt: new Date(inAYear.getTime() + 1)}, NOW),
      "invalid_input"
    );
    await expectRefusal(() => validateAllowance({unlimited: true, expiresAt: NOW}, NOW), "invalid_input");
    await expectRefusal(
      () => validateAllowance({unlimited: true, expiresAt: new Date("not a date")}, NOW),
      "invalid_input"
    );
  });
});

describe("setting an allowance", () => {
  it("stores it, and leaves the rest of the profile alone", async () => {
    const until = new Date(Date.now() + 7 * DAY);
    const stored = await setAllowance(db, "frodo", {unlimited: false, limits: RAISED, expiresAt: until});

    const data = (await profile().get()).data();
    expect(data?.extractionAllowance).toEqual(stored);
    expect(data?.extractionAllowance.limits).toEqual(RAISED);
    expect(data?.extractionAllowance.expiresAt.toDate()).toEqual(until);
    expect(data?.extractionAllowance.setAt).toBeInstanceOf(Timestamp);
    expect(data?.entityExtractionUsage.daily.count).toBe(2);
    expect(data?.groups).toEqual(["fellowship"]);
  });

  it("is what extraction then holds the person to", async () => {
    await setAllowance(db, "frodo", {unlimited: false, limits: RAISED});

    const status = await call(getUsageStatus, {}, "frodo") as {
      usage: {usage: {daily: {limit: number}; weekly: {limit: number}; monthly: {limit: number}}};
    };
    const {daily, weekly, monthly} = status.usage.usage;
    expect([daily.limit, weekly.limit, monthly.limit]).toEqual([10, 40, 80]);
  });

  it("refuses an account with no profile, and creates none", async () => {
    const message = await expectRefusal(
      () => setAllowance(db, "gandalf", {unlimited: true}),
      "no_profile"
    );

    expect(message).toMatch(/no group/);
    expect((await db.doc("users/gandalf").get()).exists).toBe(false);
  });

  it("refuses an out-of-bounds request, and writes nothing", async () => {
    const before = (await profile().get()).data();

    await expectRefusal(
      () => setAllowance(db, "frodo", {unlimited: false, limits: {...RAISED, monthly: 5000}}),
      "invalid_input"
    );

    expect((await profile().get()).data()).toEqual(before);
  });

  it("refuses a uid that would name another document", async () => {
    for (const uid of ["", "frodo/secrets/x", "../groups", "a b"]) {
      await expectRefusal(() => setAllowance(db, uid, {unlimited: true}), "invalid_input");
    }
  });
});

describe("clearing an allowance", () => {
  it("puts the person back on the defaults", async () => {
    await setAllowance(db, "frodo", {unlimited: true});

    await clearAllowance(db, "frodo");

    const data = (await profile().get()).data();
    expect(data).not.toHaveProperty("extractionAllowance");
    expect(data?.entityExtractionUsage.daily.count).toBe(2);
  });

  it("refuses an account with no profile, and creates none", async () => {
    await expectRefusal(() => clearAllowance(db, "gandalf"), "no_profile");
    expect((await db.doc("users/gandalf").get()).exists).toBe(false);
  });
});
