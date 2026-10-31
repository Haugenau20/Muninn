// src/core/services/firebase/analytics/analytics.ts
import type { FirebaseApp } from "firebase/app";
import type { Analytics } from "firebase/analytics";
import { firebaseConfig, useEmulators } from "../config/firebaseConfig";
import { ANALYTICS_FACTS } from "core/constants/privacy";
import { readLocalStorage, removeLocalStorage, writeLocalStorage } from "core/utils/local-storage";

/**
 * Google Analytics, only with the player's consent (T138).
 *
 * Nothing of Google Analytics loads until the player has said yes: the SDK is
 * imported on demand, so a player who never agrees never downloads it, gets no
 * `_ga` cookie, and sends nothing. Saying no later stops collection at once
 * and deletes what it left behind.
 *
 * What it reports is reduced to the section of the site: a page view says
 * "/quests" and "Quests", never the address (which can hold a record's name,
 * an invitation code or a sign-in link's code) or the tab title (which names
 * the campaign).
 */

/** The player's answer. No answer yet is `null`. */
export type AnalyticsConsent = "granted" | "denied";

/** Where the answer is kept, in the player's own browser. */
export const ANALYTICS_CONSENT_KEY = "analyticsConsent";

/** The dismiss-only notice's key, which the consent replaced. */
const LEGACY_NOTICE_KEY = "privacyNoticeSeen";

/** Firebase's store for the installation id it gives Google Analytics. */
const INSTALLATIONS_DATABASE = "firebase-installations-database";

/** One page, as Google Analytics is told about it. */
export interface AnalyticsPage {
  /** The section's path, e.g. `/quests`. Never the full address. */
  path: string;
  /** The section's name, e.g. `Quests`. Never the tab title. */
  title: string;
}

type AnalyticsSdk = typeof import("firebase/analytics");

interface LoadedAnalytics {
  sdk: AnalyticsSdk;
  instance: Analytics;
}

/** The answer, when the browser refuses storage: it then lasts the visit. */
let sessionConsent: AnalyticsConsent | null = null;
let firebaseApp: FirebaseApp | null = null;
let loaded: Promise<LoadedAnalytics | null> | null = null;
let currentPage: AnalyticsPage | null = null;
/** The page last reported, so a page is never reported twice in a row. */
let lastReported: AnalyticsPage | null = null;
const listeners = new Set<() => void>();

/**
 * Whether this build may report to Google Analytics at all: only the live
 * site. Never the dev server or the emulators (the browser journeys run a
 * production build against them).
 */
const analyticsAvailable = (): boolean =>
  process.env.NODE_ENV === "production" &&
  !useEmulators &&
  Boolean(firebaseConfig.measurementId);

const isConsent = (value: string | null): value is AnalyticsConsent =>
  value === "granted" || value === "denied";

/**
 * The player's answer, or `null` if they have not given one.
 */
export function getAnalyticsConsent(): AnalyticsConsent | null {
  const stored = readLocalStorage(ANALYTICS_CONSENT_KEY);
  return isConsent(stored) ? stored : sessionConsent;
}

/**
 * Record the player's answer and act on it: start Google Analytics on a yes,
 * stop it and delete its cookies on a no.
 *
 * @param choice The player's answer
 */
export function setAnalyticsConsent(choice: AnalyticsConsent): void {
  sessionConsent = choice;
  writeLocalStorage(ANALYTICS_CONSENT_KEY, choice);
  removeLocalStorage(LEGACY_NOTICE_KEY);
  apply(choice);
  notify();
}

/**
 * Be told when the answer changes, here or in another tab.
 *
 * @param listener Called after every change
 * @returns A function that unsubscribes
 */
export function subscribeAnalyticsConsent(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
    }
  };
}

/**
 * Hand over the Firebase app, once it exists. Starts Google Analytics if the
 * player has already agreed; otherwise clears anything an earlier visit left,
 * which every visit before T138 did.
 *
 * @param app The default Firebase app
 */
export function attachAnalytics(app: FirebaseApp): void {
  firebaseApp = app;
  apply(getAnalyticsConsent());
}

/**
 * Report a page view, reduced to its section. Remembered while analytics is
 * off, so the first report after a yes describes the page the player is on.
 *
 * @param page The section being shown
 */
export function trackPageView(page: AnalyticsPage): void {
  currentPage = page;
  void loaded?.then((analytics) => {
    if (analytics && getAnalyticsConsent() === "granted") {
      report(analytics, page);
    }
  });
}

/** Start or stop, for an answer (or none). */
function apply(choice: AnalyticsConsent | null): void {
  if (choice === "granted") {
    start();
  } else {
    stop();
  }
}

/** Load Google Analytics, or switch collection back on if it is loaded. */
function start(): void {
  if (!firebaseApp || !analyticsAvailable()) {
    return;
  }
  if (loaded) {
    void loaded.then((analytics) => {
      if (analytics) {
        analytics.sdk.setAnalyticsCollectionEnabled(analytics.instance, true);
        if (currentPage) report(analytics, currentPage);
      }
    });
    return;
  }
  loaded = load(firebaseApp);
}

/** Switch collection off, if it ever started, and delete what it left. */
function stop(): void {
  lastReported = null;
  void loaded?.then((analytics) => {
    if (analytics) {
      analytics.sdk.setAnalyticsCollectionEnabled(analytics.instance, false);
    }
  });
  clearAnalyticsTraces();
}

/**
 * Import the SDK and start it with every advertising feature off and no
 * automatic page view: the first page view is sent here, reduced to its
 * section, and the parameters it sets stay in force for whatever Google
 * Analytics collects on its own (scrolling, outbound links).
 */
async function load(app: FirebaseApp): Promise<LoadedAnalytics | null> {
  try {
    const sdk = await import("firebase/analytics");
    if (!(await sdk.isSupported())) {
      return null;
    }
    if (currentPage) {
      // Before the SDK starts, so not even its first request carries the
      // real address or title.
      sdk.setDefaultEventParameters(pageParams(currentPage));
    }
    const instance = sdk.initializeAnalytics(app, {
      config: {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        cookie_expires: ANALYTICS_FACTS.cookieLifetimeDays * 24 * 60 * 60,
      },
    });
    const analytics = { sdk, instance };
    if (getAnalyticsConsent() !== "granted") {
      // Withdrawn while the SDK was downloading.
      sdk.setAnalyticsCollectionEnabled(instance, false);
    } else if (currentPage) {
      report(analytics, currentPage);
    }
    return analytics;
  } catch (error) {
    console.warn("Google Analytics did not start:", error);
    return null;
  }
}

/** Send one page view, and make its section the default for later events. */
function report({ sdk, instance }: LoadedAnalytics, page: AnalyticsPage): void {
  if (page === lastReported) {
    return;
  }
  lastReported = page;
  const params = pageParams(page);
  sdk.setDefaultEventParameters(params);
  sdk.logEvent(instance, "page_view", params);
}

function pageParams(page: AnalyticsPage) {
  return {
    page_location: `${window.location.origin}${page.path}`,
    page_path: page.path,
    page_title: page.title,
  };
}

/**
 * Delete Google Analytics' cookies, wherever on this site's domain they were
 * set (`auto` puts them on the widest domain that accepts them), and the
 * Firebase installation id it reported with. The database is only deleted
 * once no page holds it open, which a page that ran analytics does until it
 * closes; the next visit then finishes the job.
 */
export function clearAnalyticsTraces(): void {
  const names = document.cookie
    .split(";")
    .map((cookie) => cookie.split("=")[0].trim())
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));
  if (names.length > 0) {
    const labels = window.location.hostname.split(".");
    const domains = [""];
    for (let i = 0; i < labels.length - 1; i++) {
      domains.push(`; domain=.${labels.slice(i).join(".")}`);
    }
    for (const name of names) {
      for (const domain of domains) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
      }
    }
  }
  try {
    window.indexedDB?.deleteDatabase(INSTALLATIONS_DATABASE);
  } catch {
    // A browser that refuses storage holds no database to delete.
  }
}

function onStorage(event: StorageEvent): void {
  if (event.key === ANALYTICS_CONSENT_KEY) {
    apply(getAnalyticsConsent());
    notify();
  }
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** Forget every answer and loaded SDK. For tests only. */
export function resetAnalyticsForTests(): void {
  sessionConsent = null;
  firebaseApp = null;
  loaded = null;
  currentPage = null;
  lastReported = null;
  listeners.clear();
}
