// src/__tests__/hosting-sites.test.ts
// The two Hosting sites in firebase/firebase.json (T118, T149). `muninn-quest`
// serves the app; the default `dnd-campaign-companion` only redirects there,
// and used to upload the whole build on every merge as well -- a full copy of
// each release that nobody was ever served. It uploads one placeholder page.

import * as fs from "fs";
import * as path from "path";

const FIREBASE = path.join(__dirname, "..", "..", "firebase");

interface HostingSite {
  site: string;
  public: string;
  rewrites?: { source: string; destination: string }[];
  redirects?: { source?: string; regex?: string; destination: string; type: number }[];
}

const config = JSON.parse(fs.readFileSync(path.join(FIREBASE, "firebase.json"), "utf8"));
const site = (id: string): HostingSite => {
  const found = (config.hosting as HostingSite[]).find((entry) => entry.site === id);
  if (!found) throw new Error(`firebase.json has no hosting site ${id}`);
  return found;
};

describe("the Hosting sites", () => {
  it("serves the app from muninn-quest, every path through index.html", () => {
    const app = site("muninn-quest");
    expect(app.public).toBe("build");
    expect(app.rewrites).toEqual([{ source: "**", destination: "/index.html" }]);
  });

  it("uploads one placeholder page to the redirect-only site, not the build", () => {
    const redirect = site("dnd-campaign-companion");
    expect(redirect.public).not.toBe("build");
    expect(fs.readdirSync(path.join(FIREBASE, redirect.public))).toEqual(["index.html"]);
  });

  it("still sends every address on the redirect-only site to muninn.quest", () => {
    const redirect = site("dnd-campaign-companion");
    expect(redirect.redirects?.length).toBeGreaterThan(0);
    for (const rule of redirect.redirects ?? []) {
      expect(rule.destination).toMatch(/^https:\/\/muninn\.quest\//);
      expect(rule.type).toBe(301);
    }
  });
});
