// functions/test/operator/http.test.ts
//
// T137, step 3: the operator service, in-process, with a throwaway signing
// key in place of Google's. The suite the security architecture lists under
// "How each control is known to work": every route refused without a valid
// identity (the test walks the route table, so a route added later is
// covered), forged and stale identities, CSRF, the security headers on every
// response, and hostile strings rendered harmless on every page.
import {AddressInfo} from "node:net";
import {Server} from "node:http";
import {getAuth} from "firebase-admin/auth";
import {clearProject, useEmulatorProject} from "../emulator";
import {createDevSigner, DevClaims} from "../../src/operator/devSigner";
import {IAP_HEADER, iapKeyStore} from "../../src/operator/http/identity";
import {ROUTES, createOperatorServer} from "../../src/operator/http/server";
import {csrfToken} from "../../src/operator/http/csrf";
import {readConfig} from "../../src/operator/config";
import {FOUNDER_INVITATIONS} from "../../src/signUp/founderInvitations";
import {hashInvitationToken} from "../../src/shared/invitationToken";

const PROJECT = "demo-operator-http";
const db = useEmulatorProject(PROJECT);

const AUDIENCE = "/projects/123/locations/europe-west1/services/operator";
const OPERATOR = {sub: "accounts.google.com:111", email: "operator@muninn.quest"};
const CSRF_KEY = Buffer.alloc(32, 7);
const SITE = "https://muninn.quest";
const HOUR = 60 * 60 * 1000;

const signer = createDevSigner("key-1");
const stranger = createDevSigner("key-1");

let server: Server;
let base: string;
let auditLines: Record<string, unknown>[] = [];
let errorLines: string[] = [];

beforeAll(async () => {
  server = createOperatorServer({
    db,
    auth: getAuth(),
    identity: {audience: AUDIENCE, subjects: new Set([OPERATOR.sub]), keys: async () => signer.keys},
    csrfKey: CSRF_KEY,
    siteOrigin: SITE,
    auditWrite: (line) => auditLines.push(JSON.parse(line)),
    logError: (line) => errorLines.push(line),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  await clearProject(PROJECT);
  auditLines = [];
  errorLines = [];
});

/** A valid identity header for `claims` over the operator's own. */
const identity = (claims: Partial<DevClaims> = {}) =>
  signer.assertion({...OPERATOR, aud: AUDIENCE, ...claims});

/** The form token the page would carry now. */
const token = (at = Date.now()) => csrfToken(CSRF_KEY, OPERATOR.sub, at);

/** A request to the service. */
async function request(
  method: string,
  path: string,
  {header = identity(), form, headers = {}}:
    {header?: string | null; form?: Record<string, string>; headers?: Record<string, string>} = {}
): Promise<Response> {
  const sent: Record<string, string> = {...headers};
  if (header !== null) sent[IAP_HEADER] = header;
  let body: string | undefined;
  if (form) {
    body = new URLSearchParams(form).toString();
    sent["content-type"] = "application/x-www-form-urlencoded";
    if (!("sec-fetch-site" in sent) && !("origin" in sent)) sent["sec-fetch-site"] = "same-origin";
  }
  return fetch(`${base}${path}`, {method, headers: sent, body, redirect: "manual"});
}

/** A POST with a valid token, from the page itself. */
const post = (path: string, form: Record<string, string>, extra: Parameters<typeof request>[2] = {}) =>
  request("POST", path, {form: {csrf: token(), ...form}, ...extra});

/** Every route, and a path no route has. */
const EVERY_PATH = [...ROUTES.map((route) => [route.method, route.path] as const), ["GET", "/nowhere"] as const];

describe("the identity check", () => {
  it("covers a route table that is not empty, so the walks below test something", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(8);
  });

  it.each(EVERY_PATH)("refuses %s %s without an identity", async (method, path) => {
    const response = await request(method, path, {header: null, form: method === "POST" ? {csrf: token()} : undefined});
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Not allowed.");
  });

  it.each(EVERY_PATH)("refuses %s %s with an identity signed by another key", async (method, path) => {
    const forged = stranger.assertion({...OPERATOR, aud: AUDIENCE});
    expect((await request(method, path, {header: forged})).status).toBe(401);
  });

  const now = () => Math.floor(Date.now() / 1000);
  it.each<[string, () => string]>([
    ["expired", () => identity({iat: now() - 700, exp: now() - 60})],
    ["issued in the future", () => identity({iat: now() + 120, exp: now() + 700})],
    ["for another audience", () => identity({aud: "/projects/123/locations/europe-west1/services/other"})],
    ["from another issuer", () => identity({iss: "https://accounts.google.com"})],
    ["under another algorithm", () => identity({alg: "RS256"})],
    ["with no algorithm", () => identity({alg: "none"})],
    ["under an unknown key id", () => identity({kid: "key-2"})],
    ["that is not a JWT", () => "not.a-jwt"],
    ["with no subject", () => identity({sub: ""})],
  ])("refuses an identity %s", async (_what, make) => {
    expect((await request("GET", "/", {header: make()})).status).toBe(401);
  });

  it("refuses a valid identity that is not an operator, with 403, and records it", async () => {
    const response = await request("GET", "/", {header: identity({sub: "accounts.google.com:999", email: "eve@x.dev"})});
    expect(response.status).toBe(403);
    expect(auditLines).toEqual([expect.objectContaining({
      action: "identity.refused",
      outcome: "refused",
      reason: "not an operator",
      operator: {sub: "accounts.google.com:999", email: "eve@x.dev"},
    })]);
  });

  it("records a refusal without the token", async () => {
    const forged = stranger.assertion({...OPERATOR, aud: AUDIENCE});
    await request("GET", "/", {header: forged});
    expect(JSON.stringify(auditLines)).not.toContain(forged.split(".")[2]);
    expect(auditLines[0]).toMatchObject({action: "identity.refused", operator: null});
  });

  it("admits the operator", async () => {
    const response = await request("GET", "/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Signed in as operator@muninn.quest");
  });

  it("answers an unknown path, once signed in, with 404, and a known one by the wrong method with 405", async () => {
    expect((await request("GET", "/nowhere")).status).toBe(404);
    const wrong = await request("DELETE", "/founder-links");
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET, POST");
  });
});

describe("CSRF", () => {
  const issue = (extra: Parameters<typeof request>[2]) => request("POST", "/founder-links", extra);
  const links = async () => (await db.collection(FOUNDER_INVITATIONS).get()).size;

  it("refuses a form with no token, and changes nothing", async () => {
    const response = await issue({form: {note: "x"}});
    expect(response.status).toBe(403);
    expect(await links()).toBe(0);
    expect(auditLines).toEqual([expect.objectContaining({action: "csrf.refused", outcome: "refused"})]);
  });

  it("refuses a token from two hours ago", async () => {
    expect((await issue({form: {csrf: token(Date.now() - 2 * HOUR)}})).status).toBe(403);
    expect(await links()).toBe(0);
  });

  it("accepts a token from the hour before, for a form left open over the hour", async () => {
    expect((await issue({form: {csrf: token(Date.now() - HOUR)}})).status).toBe(200);
  });

  it("refuses another operator's token", async () => {
    const theirs = csrfToken(CSRF_KEY, "accounts.google.com:222", Date.now());
    expect((await issue({form: {csrf: theirs}})).status).toBe(403);
  });

  it("refuses a cross-site request, even with a valid token", async () => {
    expect((await issue({form: {csrf: token()}, headers: {"sec-fetch-site": "cross-site"}})).status).toBe(403);
    expect((await issue({form: {csrf: token()}, headers: {"sec-fetch-site": "same-site"}})).status).toBe(403);
    expect(await links()).toBe(0);
  });

  it("refuses a request from a browser without Sec-Fetch-Site unless its Origin is this service", async () => {
    expect((await issue({form: {csrf: token()}, headers: {origin: "https://evil.example"}})).status).toBe(403);
    expect((await issue({form: {csrf: token()}, headers: {origin: base}})).status).toBe(200);
  });

  it("refuses a request that says nothing of where it came from", async () => {
    const response = await fetch(`${base}/founder-links`, {
      method: "POST",
      headers: {[IAP_HEADER]: identity(), "content-type": "application/x-www-form-urlencoded"},
      body: `csrf=${token()}`,
    });
    expect(response.status).toBe(403);
  });

  it("refuses a body over 16 KiB", async () => {
    expect((await post("/founder-links", {note: "x".repeat(20_000)})).status).toBe(413);
  });
});

describe("the security headers", () => {
  // Written out here, from the security architecture (section 4), not read
  // from the module that sets them: a header dropped there must fail here.
  const EXPECTED: Record<string, string> = {
    "content-security-policy":
      "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; " +
      "form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "x-frame-options": "DENY",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "strict-transport-security": "max-age=63072000",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "",
  };
  const check = (response: Response) => {
    for (const [name, value] of Object.entries(EXPECTED)) {
      expect([name, response.headers.get(name)]).toEqual([name, value]);
    }
  };

  it.each(EVERY_PATH)("are on %s %s, signed in", async (method, path) => {
    check(await request(method, path, method === "POST" ? {form: {csrf: token()}} : {}));
  });

  it("are on every refusal", async () => {
    check(await request("GET", "/", {header: null}));
    check(await request("POST", "/founder-links", {form: {}}));
    check(await request("GET", "/nowhere"));
  });
});

describe("founder links", () => {
  it("issues one, shows it once in full, records who issued it, and logs only its first characters", async () => {
    const response = await post("/founder-links", {note: "Bree table"});
    const page = await response.text();

    expect(response.status).toBe(200);
    const [doc] = (await db.collection(FOUNDER_INVITATIONS).get()).docs;
    const shown = page.split(`${SITE}/join?founder=`)[1]?.match(/^[A-Za-z0-9_-]+/)?.[0] ?? "";
    // The link carries the token; the invitation is stored under its hash (T145).
    expect(hashInvitationToken(shown)).toBe(doc.id);
    expect(doc.data()).toMatchObject({issuedBy: OPERATOR.email, note: "Bree table", used: false});
    expect(auditLines).toEqual([expect.objectContaining({
      action: "founder_link.issue",
      outcome: "ok",
      target: {link: doc.id.slice(0, 6)},
    })]);
    expect(JSON.stringify(auditLines)).not.toContain(doc.id);
    expect(JSON.stringify(auditLines)).not.toContain(shown);
  });

  it("lists links by their first characters, never their tokens", async () => {
    await post("/founder-links", {note: "Bree table"});
    const [doc] = (await db.collection(FOUNDER_INVITATIONS).get()).docs;
    const page = await (await request("GET", "/founder-links")).text();
    expect(page).toContain(doc.id.slice(0, 6));
    expect(page).not.toContain(doc.id);
    expect(page).toContain("Bree table");
  });

  it("revokes one, then redirects to the list", async () => {
    await post("/founder-links", {});
    const [doc] = (await db.collection(FOUNDER_INVITATIONS).get()).docs;
    const ref = doc.id.slice(0, 6);

    const response = await post("/founder-links/revoke", {id: ref});
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/founder-links?revoked=${ref}`);
    expect((await doc.ref.get()).data()).toMatchObject({revokedBy: OPERATOR.email});
    expect(auditLines.at(-1)).toMatchObject({action: "founder_link.revoke", outcome: "ok", target: {link: ref}});
  });

  it("refuses to revoke a link that does not exist, and says so", async () => {
    const response = await post("/founder-links/revoke", {id: "abcdef"});
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("There is no such founder link.");
    expect(auditLines.at(-1)).toMatchObject({outcome: "refused", reason: "link_not_found"});
  });

  it("refuses a note too long, with the form filled in again", async () => {
    const response = await post("/founder-links", {note: "n".repeat(201)});
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("A note can be at most 200 characters.");
  });

  it("refuses past the daily budget with 429", async () => {
    for (let i = 0; i < 10; i++) {
      await db.collection(FOUNDER_INVITATIONS).doc(`link${i}`).set({used: false, createdAt: new Date()});
    }
    expect((await post("/founder-links", {})).status).toBe(429);
  });
});

describe("accounts and allowances", () => {
  beforeEach(async () => {
    await getAuth().createUser({uid: "frodo", email: "frodo@shire.dev"});
    await db.doc("users/frodo").set({id: "frodo", groups: ["fellowship"]});
  });

  it("looks an account up by its email, and records the look-up by uid only", async () => {
    const page = await (await request("GET", "/accounts?email=Frodo@Shire.dev")).text();
    expect(page).toContain("frodo@shire.dev");
    expect(page).toContain("3 / 5 / 10 a day, week and month");
    expect(auditLines).toEqual([expect.objectContaining({action: "account.lookup", target: {uid: "frodo"}})]);
    expect(JSON.stringify(auditLines)).not.toContain("shire.dev");
  });

  it("says when no account has the email", async () => {
    expect(await (await request("GET", "/accounts?email=nobody@shire.dev")).text()).toContain("No account has this email.");
  });

  it("sets an allowance until the end of a day, then redirects back to the account", async () => {
    const response = await post("/accounts/allowance", {
      uid: "frodo", email: "frodo@shire.dev", mode: "set",
      daily: "20", weekly: "60", monthly: "200", expires: new Date(Date.now() + 10 * 24 * HOUR).toISOString().slice(0, 10),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/accounts?email=frodo%40shire.dev&saved=set");
    const allowance = (await db.doc("users/frodo").get()).get("extractionAllowance");
    expect(allowance).toMatchObject({unlimited: false, limits: {daily: 20, weekly: 60, monthly: 200}});
    expect(allowance.expiresAt.toDate().toISOString()).toMatch(/T23:59:59\.999Z$/);
    expect(auditLines.at(-1)).toMatchObject({action: "allowance.set", outcome: "ok", target: {uid: "frodo"}});
  });

  it("refuses a limit over its bound, and shows the account again with why", async () => {
    const response = await post("/accounts/allowance", {
      uid: "frodo", email: "frodo@shire.dev", mode: "set", daily: "5000", weekly: "60", monthly: "200", expires: "",
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("The daily limit has to be a whole number from 0 to 50.");
    expect((await db.doc("users/frodo").get()).get("extractionAllowance")).toBeUndefined();
  });

  it.each([["a date that does not exist", "2026-02-31"], ["no date at all", "soon"]])(
    "refuses %s as an end date", async (_what, expires) => {
      const response = await post("/accounts/allowance", {
        uid: "frodo", email: "frodo@shire.dev", mode: "set", daily: "5", weekly: "5", monthly: "5", expires,
      });
      expect(response.status).toBe(400);
    }
  );

  it("puts the account back on the defaults", async () => {
    await db.doc("users/frodo").update({extractionAllowance: {unlimited: true, limits: null, expiresAt: null}});
    const response = await post("/accounts/allowance", {uid: "frodo", email: "frodo@shire.dev", mode: "clear"});
    expect(response.headers.get("location")).toBe("/accounts?email=frodo%40shire.dev&saved=clear");
    expect((await db.doc("users/frodo").get()).get("extractionAllowance")).toBeUndefined();
    expect(auditLines.at(-1)).toMatchObject({action: "allowance.clear", outcome: "ok"});
  });

  it("refuses an allowance for an account with no profile", async () => {
    await getAuth().createUser({uid: "sam", email: "sam@shire.dev"});
    const response = await post("/accounts/allowance", {uid: "sam", email: "sam@shire.dev", mode: "clear"});
    expect(response.status).toBe(409);
  });
});

describe("hostile strings", () => {
  const HOSTILE = `<script>alert("x")</script><img src=x onerror=alert(1)>"'&`;

  it("render as text in the list: a note, and who issued a link", async () => {
    await db.collection(FOUNDER_INVITATIONS).doc("hostile-token-0000").set({
      used: false, createdAt: new Date(), expiresAt: new Date(Date.now() + HOUR),
      note: HOSTILE, issuedBy: HOSTILE,
    });
    const page = await (await request("GET", "/founder-links")).text();
    expect(page).not.toContain("<script>alert");
    expect(page).not.toContain("<img src=x");
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("render as text when echoed back into a form", async () => {
    const issued = await post("/founder-links", {note: HOSTILE + "x".repeat(200)});
    expect(await issued.text()).not.toContain("<script>alert");

    const lookUp = await (await request("GET", `/accounts?email=${encodeURIComponent(HOSTILE)}`)).text();
    expect(lookUp).not.toContain("<script>alert");
    expect(lookUp).toContain("That is not an email address.");
  });

  it("render as text in the operator's own name", async () => {
    const page = await (await request("GET", "/", {header: identity({email: HOSTILE})})).text();
    expect(page).not.toContain("<script>alert");
  });

  it("render as text in an account's address", async () => {
    await getAuth().createUser({uid: "odd", email: "a+<b>@shire.dev"}).catch(() => undefined);
    const page = await (await request("GET", `/accounts?email=${encodeURIComponent("a+<b>@shire.dev")}`)).text();
    expect(page).not.toContain("a+<b>");
  });
});

describe("a failure", () => {
  it("answers 500 with a trace id and no detail, logs the detail, and records the action as failed", async () => {
    const failing = createOperatorServer({
      db,
      auth: getAuth(),
      identity: {audience: AUDIENCE, subjects: new Set([OPERATOR.sub]), keys: async () => signer.keys},
      csrfKey: CSRF_KEY,
      siteOrigin: SITE,
      auditWrite: (line) => auditLines.push(JSON.parse(line)),
      logError: (line) => errorLines.push(line),
      now: () => {
        throw new Error("secret detail");
      },
    });
    await new Promise<void>((resolve) => failing.listen(0, "127.0.0.1", resolve));
    const at = `http://127.0.0.1:${(failing.address() as AddressInfo).port}`;
    try {
      const response = await fetch(`${at}/`, {headers: {[IAP_HEADER]: identity()}});
      const page = await response.text();
      expect(response.status).toBe(500);
      expect(page).not.toContain("secret detail");
      expect(page).toMatch(/trace <code>[0-9a-f]{32}<\/code>/);
      expect(errorLines.join("\n")).toContain("secret detail");
    } finally {
      await new Promise<void>((resolve) => failing.close(() => resolve()));
    }
  });
});

describe("IAP's keys", () => {
  it("are fetched once, and again for an unknown key id only after a minute", async () => {
    let clock = 0;
    const fetchKeys = jest.fn().mockResolvedValue({a: "pem"});
    const keys = iapKeyStore(fetchKeys, () => clock);
    await keys("a");
    await keys("b");
    expect(fetchKeys).toHaveBeenCalledTimes(1);
    clock = 61_000;
    await keys("b");
    expect(fetchKeys).toHaveBeenCalledTimes(2);
  });

  it("are fetched again when an hour old", async () => {
    let clock = 0;
    const fetchKeys = jest.fn().mockResolvedValue({a: "pem"});
    const keys = iapKeyStore(fetchKeys, () => clock);
    await keys("a");
    clock = HOUR + 1;
    await keys("a");
    expect(fetchKeys).toHaveBeenCalledTimes(2);
  });
});

describe("the production configuration", () => {
  const VALID = {
    OPERATOR_SUBJECTS: "accounts.google.com:1, accounts.google.com:2",
    IAP_AUDIENCE: AUDIENCE,
    SITE_ORIGIN: SITE,
    OPERATOR_CSRF_KEY: Buffer.alloc(32, 1).toString("base64"),
  };

  it("reads a complete one", () => {
    const config = readConfig(VALID);
    expect([...config.subjects]).toEqual(["accounts.google.com:1", "accounts.google.com:2"]);
    expect(config.port).toBe(8080);
  });

  it.each([
    ["no operators", {OPERATOR_SUBJECTS: " , "}, /OPERATOR_SUBJECTS/],
    ["no audience", {IAP_AUDIENCE: ""}, /IAP_AUDIENCE/],
    ["a site that is not https", {SITE_ORIGIN: "http://muninn.quest"}, /SITE_ORIGIN/],
    ["a site with a path", {SITE_ORIGIN: "https://muninn.quest/join"}, /SITE_ORIGIN/],
    ["a short CSRF key", {OPERATOR_CSRF_KEY: Buffer.alloc(8).toString("base64")}, /OPERATOR_CSRF_KEY/],
  ])("refuses one with %s", (_what, change, message) => {
    expect(() => readConfig({...VALID, ...change})).toThrow(message);
  });
});
