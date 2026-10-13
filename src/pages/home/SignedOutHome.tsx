import React from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { buttonClasses } from "core/components/Button";
import EntitySigil from "core/components/EntitySigil";
import Typography from "core/components/Typography";
import { SIGNED_OUT_EXAMPLE, describeUpdate, formatUpdateDate } from "./signed-out-example";

/** The three things the product does, said plainly, each with the example that shows it. */
const PRODUCT_LINES = [
  { text: "A chapter log the whole group can add to, in play order", link: "See the story", href: "/story/chapters" },
  { text: "Quests with objectives, and rumours you can mark true or false", link: "See the rumours", href: "/rumors" },
  {
    text: "Your own session notes — AI pulls out the NPCs, locations and quests it finds",
    link: "See a note",
    href: "/notes",
  },
];

/** An accent arrow after a link's words: this goes somewhere. */
const Arrow: React.FC = () => (
  <span aria-hidden="true" className="accent">
    {" →"}
  </span>
);

/**
 * What a stranger sees at `/`.
 *
 * Home answers "what is this?" with a whole example campaign, and is the way
 * into it: each number opens the list page that shows it, each recent row
 * opens its own row there, and every list page draws the same campaign under
 * its sign-in band (T150). Neither credits anyone, because inventing authors
 * would undermine the attribution the product's credibility rests on.
 *
 * Rendered instead of `PageShell` + `GatedContent`, not inside them: the `h1`
 * here is the product's headline, not a page title, and the two-column layout
 * is not the band the list pages share.
 */
const SignedOutHome: React.FC = () => (
  <div className="max-w-7xl mx-auto px-4 py-12">
    <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
      {/* Left: what it is, in words. Both columns take `min-w-0`: a grid
          item is otherwise as wide as its longest unbreakable line, and the
          recent rows' one-line details would push a phone's page sideways. */}
      <div className="min-w-0">
        <Typography variant="h1" className="mb-6">
          Everything your table agreed happened, in one place
        </Typography>

        <Typography color="secondary" className="mb-6" data-testid="home-blurb">
          Chapters, quests, NPCs, locations, rumours and your own notes — written by whoever is at the
          table, credited to the character they play.
        </Typography>

        {/* The one thing a stranger cannot work out: an account alone gets
            you nowhere. Its own line, not the end of the paragraph above. */}
        <p data-testid="home-invite" className="flex items-center gap-2 mb-4 text-sm typography">
          <Lock size={16} aria-hidden="true" className="shrink-0 typography-muted" />
          Invite only for now. Ask whoever set up your campaign for a join link.
        </p>

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
          <span className="font-heading italic text-[15px] typography">Muninn was Odin&apos;s raven of memory.</span>
          <Link to="/about" className="text-sm primary underline underline-offset-[3px]">
            About the name
          </Link>
        </p>

        <ul data-testid="product-lines">
          {PRODUCT_LINES.map((line) => (
            <li
              key={line.text}
              className="flex items-baseline justify-between gap-4 py-2.5 border-b divider last:border-b-0"
            >
              <Typography color="secondary">{line.text}</Typography>
              <Link to={line.href} className="shrink-0 text-sm font-semibold accent">
                {line.link}
                <Arrow />
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Right: the example, and the way into it. */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-3 mb-3">
          <span className="px-2 py-1 rounded text-xs font-semibold uppercase tracking-widest chip">
            Example campaign
          </span>
          <span className="text-sm typography-muted">Click around, nothing is saved</span>
        </div>

        <div data-testid="example-panel" className="rounded-lg p-6 card">
          <Typography variant="h3" className="mb-1 typography-heading">
            {SIGNED_OUT_EXAMPLE.campaignTitle}
          </Typography>
          <Typography variant="body-sm" color="secondary" className="mb-6">
            {SIGNED_OUT_EXAMPLE.subtitle}
          </Typography>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px mb-6 rounded overflow-hidden card-border-fill">
            {SIGNED_OUT_EXAMPLE.stats.map((stat) => (
              <Link key={stat.label} to={stat.href} className="block p-3 card selectable-item">
                <div className="text-2xl font-bold typography">{stat.value}</div>
                <div className="flex items-baseline justify-between gap-1 text-xs uppercase tracking-wide typography-muted">
                  {stat.label}
                  <Arrow />
                </div>
              </Link>
            ))}
          </div>

          <div className="text-xs uppercase tracking-widest typography-muted mb-2">Since you last played</div>
          <ul>
            {SIGNED_OUT_EXAMPLE.updates.map((update) => {
              const row = describeUpdate(update);
              return (
                <li key={update.ref} className="border-b card-divider last:border-b-0">
                  <Link to={row.href} className="flex items-center gap-3 py-3 px-1 selectable-item">
                    <span className="hidden sm:block w-[72px] shrink-0 text-sm typography-muted">
                      {formatUpdateDate(update.date)}
                    </span>
                    {row.mark === null ? (
                      <EntitySigil entityId={update.ref} name={update.title} size={28} />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md border card-border bg-secondary text-xs typography-muted"
                      >
                        {row.mark}
                      </span>
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block font-heading font-semibold typography truncate">{update.title}</span>
                      <span className="block text-[13px] typography-secondary truncate">{row.detail}</span>
                      {/* On a phone the date and the status share a line under
                          the name, which would otherwise have no room left. */}
                      <span className="block sm:hidden text-[13px] typography-muted">
                        {formatUpdateDate(update.date)} ·{" "}
                        <span className={`font-semibold ${row.tone ?? "typography-secondary"}`}>{row.status}</span>
                      </span>
                    </span>
                    <span className={`hidden sm:block shrink-0 text-sm font-semibold ${row.tone ?? "typography-secondary"}`}>
                      {row.status}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-baseline justify-between gap-3 mt-4 pt-4 border-t card-divider">
            <Typography variant="body-sm" color="secondary">
              {SIGNED_OUT_EXAMPLE.rumourLine}
            </Typography>
            <Link to="/rumors" className="text-sm font-semibold accent">
              Open the example
              <Arrow />
            </Link>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default SignedOutHome;
