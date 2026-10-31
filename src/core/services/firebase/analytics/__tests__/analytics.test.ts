// src/core/services/firebase/analytics/__tests__/analytics.test.ts
import type { FirebaseApp } from "firebase/app";

/**
 * T138: Google Analytics runs only with the player's consent, only on the live
 * site, and reports nothing but the section of the site.
 */

const mockSdk = {
  isSupported: jest.fn(() => Promise.resolve(true)),
  initializeAnalytics: jest.fn(() => ({ kind: "analytics" })),
  setAnalyticsCollectionEnabled: jest.fn(),
  setDefaultEventParameters: jest.fn(),
  logEvent: jest.fn(),
};
jest.mock("firebase/analytics", () => mockSdk);

const mockConfig = { useEmulators: false };
jest.mock("@/core/services/firebase/config/firebaseConfig", () => ({
  firebaseConfig: { measurementId: "G-TEST" },
  get useEmulators() {
    return mockConfig.useEmulators;
  },
}));

const app = { name: "[DEFAULT]" } as FirebaseApp;
const originalNodeEnv = process.env.NODE_ENV;

type AnalyticsModule = typeof import("../analytics");
let analytics: AnalyticsModule;

/** Let every pending import and promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const setNodeEnv = (value: string) => {
  (process.env as Record<string, string>).NODE_ENV = value;
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  setNodeEnv("production");
  mockConfig.useEmulators = false;
  analytics = require("../analytics");
  analytics.resetAnalyticsForTests();
});

afterEach(() => {
  setNodeEnv(originalNodeEnv as string);
});

describe("before the player answers", () => {
  it("has no answer", () => {
    expect(analytics.getAnalyticsConsent()).toBeNull();
  });

  it("loads nothing of Google Analytics", async () => {
    analytics.attachAnalytics(app);
    analytics.trackPageView({ path: "/quests", title: "Quests" });
    await settle();

    expect(mockSdk.initializeAnalytics).not.toHaveBeenCalled();
    expect(mockSdk.logEvent).not.toHaveBeenCalled();
  });

  it("deletes the cookies an earlier visit left", () => {
    document.cookie = "_ga=GA1.1.123; path=/";
    document.cookie = "_ga_TEST=GS1.1.456; path=/";
    document.cookie = "other=kept; path=/";

    analytics.attachAnalytics(app);

    expect(document.cookie).not.toMatch(/_ga/);
    expect(document.cookie).toMatch(/other=kept/);
    document.cookie = "other=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });
});

describe("when the player agrees", () => {
  it("starts Google Analytics with advertising off and no automatic page view", async () => {
    analytics.attachAnalytics(app);
    analytics.setAnalyticsConsent("granted");
    await settle();

    expect(mockSdk.initializeAnalytics).toHaveBeenCalledWith(app, {
      config: expect.objectContaining({
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        cookie_expires: 395 * 24 * 60 * 60,
      }),
    });
  });

  it("remembers the answer", () => {
    analytics.setAnalyticsConsent("granted");
    expect(localStorage.getItem(analytics.ANALYTICS_CONSENT_KEY)).toBe("granted");
    expect(analytics.getAnalyticsConsent()).toBe("granted");
  });

  it("starts on a later visit without asking again", async () => {
    localStorage.setItem(analytics.ANALYTICS_CONSENT_KEY, "granted");
    analytics.attachAnalytics(app);
    await settle();

    expect(mockSdk.initializeAnalytics).toHaveBeenCalledTimes(1);
  });

  it("reports the page the player is on, reduced to its section", async () => {
    analytics.trackPageView({ path: "/quests", title: "Quests" });
    analytics.attachAnalytics(app);
    analytics.setAnalyticsConsent("granted");
    await settle();

    const params = {
      page_location: `${window.location.origin}/quests`,
      page_path: "/quests",
      page_title: "Quests",
    };
    // Set before the SDK starts, so its first request carries no real address.
    expect(mockSdk.setDefaultEventParameters.mock.invocationCallOrder[0]).toBeLessThan(
      mockSdk.initializeAnalytics.mock.invocationCallOrder[0]
    );
    expect(mockSdk.setDefaultEventParameters).toHaveBeenCalledWith(params);
    expect(mockSdk.logEvent).toHaveBeenCalledTimes(1);
    expect(mockSdk.logEvent).toHaveBeenCalledWith(expect.anything(), "page_view", params);
  });

  it("reports each later page once", async () => {
    analytics.attachAnalytics(app);
    analytics.setAnalyticsConsent("granted");
    await settle();

    analytics.trackPageView({ path: "/npcs", title: "NPCs" });
    analytics.trackPageView({ path: "/notes", title: "Notes" });
    await settle();

    expect(mockSdk.logEvent.mock.calls.map(([, , params]) => params.page_path))
      .toEqual(["/npcs", "/notes"]);
  });

  it("reports a page changed while the SDK downloads only once", async () => {
    analytics.trackPageView({ path: "/quests", title: "Quests" });
    analytics.attachAnalytics(app);
    analytics.setAnalyticsConsent("granted");
    analytics.trackPageView({ path: "/npcs", title: "NPCs" });
    await settle();

    expect(mockSdk.logEvent.mock.calls.map(([, , params]) => params.page_path))
      .toEqual(["/npcs"]);
  });

  it("deletes the dismiss-only notice's old key", () => {
    localStorage.setItem("privacyNoticeSeen", "true");
    analytics.setAnalyticsConsent("granted");
    expect(localStorage.getItem("privacyNoticeSeen")).toBeNull();
  });
});

describe("only on the live site", () => {
  it.each([
    ["the dev server", () => setNodeEnv("development")],
    ["the emulators", () => { mockConfig.useEmulators = true; }],
  ])("never starts on %s, even with consent", async (_where, arrange) => {
    arrange();
    analytics.attachAnalytics(app);
    analytics.setAnalyticsConsent("granted");
    await settle();

    expect(mockSdk.initializeAnalytics).not.toHaveBeenCalled();
  });
});

describe("when the player says no", () => {
  it("never loads Google Analytics", async () => {
    analytics.attachAnalytics(app);
    analytics.setAnalyticsConsent("denied");
    analytics.trackPageView({ path: "/quests", title: "Quests" });
    await settle();

    expect(mockSdk.initializeAnalytics).not.toHaveBeenCalled();
    expect(analytics.getAnalyticsConsent()).toBe("denied");
  });

  it("stops collection and deletes the cookies after an earlier yes", async () => {
    analytics.attachAnalytics(app);
    analytics.setAnalyticsConsent("granted");
    await settle();
    document.cookie = "_ga=GA1.1.123; path=/";

    analytics.setAnalyticsConsent("denied");
    await settle();

    expect(mockSdk.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith(expect.anything(), false);
    expect(document.cookie).not.toMatch(/_ga/);

    analytics.trackPageView({ path: "/npcs", title: "NPCs" });
    await settle();
    expect(mockSdk.logEvent).not.toHaveBeenCalledWith(
      expect.anything(), "page_view", expect.objectContaining({ page_path: "/npcs" })
    );
  });

  it("switches collection back on after a second yes, without starting twice", async () => {
    analytics.attachAnalytics(app);
    analytics.setAnalyticsConsent("granted");
    analytics.setAnalyticsConsent("denied");
    analytics.setAnalyticsConsent("granted");
    await settle();

    expect(mockSdk.initializeAnalytics).toHaveBeenCalledTimes(1);
    expect(mockSdk.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith(expect.anything(), true);
  });
});

describe("with storage unavailable (T092)", () => {
  beforeEach(() => {
    const refuse = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(refuse);
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(refuse);
    jest.spyOn(Storage.prototype, "removeItem").mockImplementation(refuse);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps the answer for the visit", () => {
    analytics.setAnalyticsConsent("denied");
    expect(analytics.getAnalyticsConsent()).toBe("denied");
  });
});

describe("subscribing", () => {
  it("tells a subscriber about an answer given here", () => {
    const listener = jest.fn();
    const unsubscribe = analytics.subscribeAnalyticsConsent(listener);

    analytics.setAnalyticsConsent("granted");
    unsubscribe();
    analytics.setAnalyticsConsent("denied");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("acts on an answer given in another tab", async () => {
    const listener = jest.fn();
    analytics.subscribeAnalyticsConsent(listener);
    analytics.attachAnalytics(app);

    localStorage.setItem(analytics.ANALYTICS_CONSENT_KEY, "granted");
    window.dispatchEvent(new StorageEvent("storage", { key: analytics.ANALYTICS_CONSENT_KEY }));
    await settle();

    expect(listener).toHaveBeenCalled();
    expect(mockSdk.initializeAnalytics).toHaveBeenCalledTimes(1);
  });
});
