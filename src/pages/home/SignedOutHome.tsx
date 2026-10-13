import React from "react";
import { Link } from "react-router-dom";
import { buttonClasses } from "core/components/Button";
import Typography from "core/components/Typography";
import { SIGNED_OUT_EXAMPLE } from "./signed-out-example";

/** The three things the product does, said plainly. */
const PRODUCT_LINES = [
  "A chapter log the whole group can add to, in play order",
  "Quests with objectives, and rumours you can mark true or false",
  "Your own session notes — AI pulls out the NPCs, locations and quests it finds",
];

/**
 * What a stranger sees at `/`.
 *
 * Home answers "what is this?" with a whole example campaign. The list pages
 * show a stranger example rows under their sign-in panel instead
 * (`ExampleRegion`, T150), drawn by the lists' own cells. Neither example
 * credits anyone, because inventing authors would undermine the attribution
 * the product's credibility rests on.
 *
 * Rendered instead of `PageShell` + `GatedContent`, not inside them: the `h1`
 * here is the product's headline, not a page title, and the two-column layout
 * is not the 560px panel the other twenty routes share.
 */
const SignedOutHome: React.FC = () => {

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
        {/* Left: what it is, in words. This column is the accessible copy of
            everything the example panel shows, which is why the panel itself
            can be hidden from assistive technology. */}
        <div>
          <Typography variant="h1" className="mb-6">
            Everything your table agreed happened, in one place
          </Typography>

          <Typography
            color="secondary"
            className="mb-8"
            data-testid="home-blurb"
          >
            Chapters, quests, NPCs, locations, rumours and your own notes —
            written by whoever is at the table, credited to the character they
            play. To get in, ask whoever set up your campaign for a join link.
          </Typography>

          <div className="flex flex-wrap gap-3 mb-6">
            <Link to="/signin" className={buttonClasses({ variant: "primary" })}>
              Sign in
            </Link>
            <Link to="/join" className={buttonClasses({ variant: "outline" })}>
              I have an invite link
            </Link>
          </div>

          {/* The name, explained once, where strangers arrive. The serif
              italic is the in-world voice; the link is the application's. */}
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-3.5 mb-10 border-t divider">
            <span className="font-heading italic text-[15px] typography">
              Muninn was Odin&apos;s raven of memory.
            </span>
            <Link to="/about" className="text-sm primary underline underline-offset-[3px]">
              About the name
            </Link>
          </p>

          <ul className="space-y-2" data-testid="product-lines">
            {PRODUCT_LINES.map((line) => (
              <li key={line}>
                <Typography color="secondary">· {line}</Typography>
              </li>
            ))}
          </ul>
        </div>

        {/* Right: the example. */}
        <div>
          {/* The chip is the whole caption. It used to be followed by "a
              picture, not a demo — nothing here is clickable", which told the
              reader about the implementation instead of about the product;
              "Example campaign" already sets the expectation, and nothing in
              the panel is focusable, so nobody discovers the difference the
              hard way. */}
          <div className="flex flex-wrap items-baseline gap-3 mb-3">
            <span className="px-2 py-1 rounded text-xs font-semibold uppercase tracking-widest chip">
              Example campaign
            </span>
          </div>

          {/* aria-hidden because every fact inside is already stated in the
              left column, and a screen-reader user should not have to walk a
              table of numbers that are not theirs. Nothing inside is
              focusable, so nothing can be reached by keyboard either. */}
          <div
            data-testid="example-panel"
            aria-hidden="true"
            className="rounded-lg p-6 card"
          >
            <Typography variant="h3" className="mb-1 typography-heading">
              {SIGNED_OUT_EXAMPLE.campaignTitle}
            </Typography>
            <Typography variant="body-sm" color="secondary" className="mb-6">
              {SIGNED_OUT_EXAMPLE.subtitle}
            </Typography>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px mb-6 rounded overflow-hidden bg-secondary">
              {SIGNED_OUT_EXAMPLE.stats.map((stat) => (
                <div key={stat.label} className="p-3 card">
                  <div className="text-2xl font-bold typography">
                    {stat.value}
                  </div>
                  <div className="text-xs uppercase tracking-wide typography-muted">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>

            <div className="text-xs uppercase tracking-widest typography-muted mb-2">
              Since you last played
            </div>
            <ul>
              {SIGNED_OUT_EXAMPLE.updates.map((update) => (
                <li
                  key={update.title}
                  className="flex items-baseline gap-3 py-2 border-b card-divider last:border-b-0"
                >
                  <span className="text-sm typography-muted shrink-0">
                    {update.date}
                  </span>
                  <span className="font-semibold typography flex-1">
                    {update.title}
                  </span>
                  <span className="text-xs typography-muted shrink-0">
                    {update.kind}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

    </div>
  );
};

export default SignedOutHome;
