// src/core/components/Roster.tsx
import React from 'react';
import Typography from './Typography';
import Input from './Input';
import Button from './Button';
import { AlertCircle, ChevronDown, ChevronRight, Search } from 'lucide-react';
import clsx from 'clsx';
import EntitySigil from './EntitySigil';
import { RuneMark } from './RuneMark';

/**
 * Shared roster primitives for the entity directories.
 *
 * NPCs, Quests, Rumors and Locations all present the same shape — a searchable,
 * filterable list grouped by something, where each entry expands in place — so the
 * layout is built once here. Each directory previously repeated a card grid whose
 * `lg:grid-cols-3` sat *inside* each group, meaning a group with one entry burned a
 * full three-column row and the page was mostly whitespace.
 *
 * These live in `core/` rather than under a feature because not one of them knows
 * anything about a campaign entity — they take strings, counts and callbacks. Two
 * consumers outside campaign-entities already need them (the dashboard's
 * ActivityFeed filter row, and QuestsPage before its directory was extracted), and
 * reaching into `features/campaign-entities/shared/` for a generic pill row was
 * both an internals import and the wrong dependency direction.
 */

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

export interface RosterSegment {
  /** Filter value this band selects. */
  key: string;
  label: string;
  count: number;
  /** Tailwind background utility backed by a theme token, e.g. bg-valence-0. */
  colorClass: string;
}

export interface RosterStatusBarProps {
  total: number;
  /** Reads after the total, e.g. "met so far". */
  totalLabel: string;
  segments: RosterSegment[];
  /** The currently selected segment key, or 'all'. */
  activeKey: string;
  onSelect: (key: string) => void;
}

/**
 * One proportional bar plus a legend that filters.
 *
 * This replaces four equal stat cards whose numbers were a breakdown of each other
 * — that is one bar, not four cards. The cards also used the same icon four times
 * in four colours and were not clickable, while the control they described sat in a
 * dropdown immediately below. Every band here is labelled with a word as well as a
 * colour, so it survives colour blindness.
 */
export const RosterStatusBar: React.FC<RosterStatusBarProps> = ({
  total,
  totalLabel,
  segments,
  activeKey,
  onSelect,
}) => {
  const present = segments.filter(segment => segment.count > 0);

  return (
    <div className={clsx('flex flex-col sm:flex-row sm:items-center gap-4 px-5 py-4 rounded-lg card')}>
      <div className="flex items-baseline gap-2 shrink-0">
        <Typography variant="h4" className="text-2xl typography-heading">
          {total}
        </Typography>
        <Typography variant="body-sm" color="secondary">
          {totalLabel}
        </Typography>
      </div>

      <div className="flex-1 flex flex-col gap-2 min-w-0">
        <div
          className={clsx('flex h-[7px] rounded-full roster-bands', `progress-container`)}
        >
          {present.map(segment => (
            <span
              key={segment.key}
              className={clsx('roster-band', segment.colorClass)}
              style={{ width: `${(segment.count / Math.max(total, 1)) * 100}%` }}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {segments.map(segment => {
            const isEmpty = segment.count === 0;
            const isActive = activeKey === segment.key;

            return (
              <button
                key={segment.key}
                type="button"
                onClick={() => onSelect(isActive ? 'all' : segment.key)}
                aria-pressed={isActive}
                className={clsx(
                  'flex items-center gap-2 text-sm rounded px-1 -mx-1',
                  isEmpty && 'opacity-50'
                )}
              >
                <span
                  aria-hidden="true"
                  className={clsx(
                    'w-2 h-2 rounded-sm shrink-0',
                    isEmpty ? 'bg-secondary' : segment.colorClass
                  )}
                />
                <Typography
                  variant="body-sm"
                  className={clsx('text-sm', isActive && 'font-semibold underline')}
                >
                  {segment.count} {segment.label}
                </Typography>
              </button>
            );
          })}
          <Typography variant="body-sm" color="muted" className="text-sm">
            — click a band to filter
          </Typography>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Filter pills
// ---------------------------------------------------------------------------

export interface RosterFilterOption {
  value: string;
  label: string;
}

/**
 * `md` is the entity directories' filter row; `sm` is the more compact chip used
 * where the row shares a line with a heading, as on the dashboard. The two differ
 * only in geometry and weight, so they stay one component rather than two
 * near-identical pill rows drifting apart.
 */
export type RosterFilterSize = 'sm' | 'md';

/*
  Both states carry a border of the same width, so selecting a filter never
  reflows the row.
*/
const PILL_BASE: Record<RosterFilterSize, string> = {
  sm: 'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors roster-filter',
  md: 'px-3 py-1.5 rounded-md text-sm transition-colors roster-filter',
};

/**
 * The one accent inside a collection, and it is an outline rather than a fill.
 *
 * It used to be `bg-status-general` filled -- which named the *status* hue for
 * something that is not a status, and happened to look right only because in
 * finish 3a that token and the accent are the same value. A filled chip is also
 * the heaviest treatment available, spent on the most repeated control on the
 * page.
 */
const PILL_ACTIVE: Record<RosterFilterSize, string> = {
  sm: 'roster-filter-active',
  md: 'roster-filter-active font-semibold',
};

const PILL_IDLE: Record<RosterFilterSize, string> = {
  sm: 'roster-filter-idle selectable-item',
  md: 'roster-filter-idle selectable-item',
};

export interface RosterFilterPillsProps {
  options: RosterFilterOption[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for the group, e.g. "Filter by relationship". */
  label: string;
  /**
   * The option meaning "no filter", usually `all`. Selecting it is the absence
   * of a filter rather than a filter, so it stays idle -- otherwise every
   * directory would show an accent on load, and the accent would say nothing.
   */
  allValue?: string;
  size?: RosterFilterSize;
}

/**
 * Filter options as visible pills. A <select> hides every option but one behind a
 * click, which is the wrong trade when there are only four. When the option set is
 * open-ended — anything derived from the data, such as a location list — use
 * RosterFilterSelect instead; that is the case pills genuinely cannot serve.
 */
export const RosterFilterPills: React.FC<RosterFilterPillsProps> = ({
  options,
  value,
  onChange,
  label,
  allValue = 'all',
  size = 'md',
}) => (
  <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
    {options.map(option => {
      const isSelected = value === option.value;
      // Selected and accented are two different questions. "All" is the
      // selected option when nothing is filtered, and a screen reader must be
      // told so -- but it is the *absence* of a filter, so it earns no accent.
      // Conflating the two would silently drop `aria-pressed` from the option
      // every directory loads on.
      const isAccented = isSelected && option.value !== allValue;
      return (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={isSelected}
          className={clsx(
            PILL_BASE[size],
            isAccented ? PILL_ACTIVE[size] : PILL_IDLE[size]
          )}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

export interface RosterFilterSelectProps {
  /** The "no filter" option is supplied by the caller, like the pills' "All". */
  options: RosterFilterOption[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name, e.g. "Filter by location". */
  label: string;
  /** Value meaning "no filter"; the control styles itself as idle while on it. */
  allValue?: string;
  size?: RosterFilterSize;
}

/**
 * The unbounded counterpart to RosterFilterPills.
 *
 * Pills are right for a fixed enum of four to nine, and wrong for an option set
 * derived from the data — a campaign can have forty locations, and forty pills is
 * not a filter row. So this stays a native <select>, but wears the pills' geometry
 * and its active/idle treatment so a filter row mixing the two reads as one
 * control set. It previously wore `rounded border p-1 input` with a MapPin and a
 * visible "Location:" label, and so sat at a different height from everything
 * beside it; the label is now the accessible name, matching the pills.
 */
export const RosterFilterSelect: React.FC<RosterFilterSelectProps> = ({
  options,
  value,
  onChange,
  label,
  allValue = 'all',
  size = 'md',
}) => {
  const isActive = value !== allValue;

  return (
    <select
      aria-label={label}
      value={value}
      onChange={event => onChange(event.target.value)}
      className={clsx(
        PILL_BASE[size],
        isActive ? PILL_ACTIVE[size] : PILL_IDLE[size]
      )}
    >
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

export interface RosterFilterBarProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** Filter controls rendered beside the search field — pills, a select, a button. */
  children?: React.ReactNode;
}

/**
 * The search field plus whatever filters a directory needs, on one row.
 *
 * Four copies of this row existed and had already drifted three ways — `gap-3` vs
 * `gap-4`, an `lg:` vs an `md:` breakpoint (so they reflowed at different widths),
 * and Quests alone wrapped in a `<Card>`, giving it a raised panel its siblings
 * did not have. One component means one answer to all three.
 */
export const RosterFilterBar: React.FC<RosterFilterBarProps> = ({
  placeholder,
  value,
  onChange,
  children,
}) => (
  <div className="flex flex-col lg:flex-row lg:items-center gap-3">
    <div className="flex-1 min-w-0">
      <Input
        placeholder={placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
        startIcon={<Search className="typography-secondary" />}
        fullWidth
      />
    </div>
    {children}
  </div>
);

// ---------------------------------------------------------------------------
// Batch bar
// ---------------------------------------------------------------------------

export interface RosterBatchBarProps {
  /** What is selected, already worded: "3 rumors selected". */
  label: React.ReactNode;
  /** The actions, one small button each. Which actions exist is the directory's business. */
  children: React.ReactNode;
  /** Why the last action failed, shown under the bar; nothing when it did not. */
  error?: string | null;
}

/**
 * The bar a directory shows in selection mode, with the actions that apply to
 * every ticked row (T017). Only the shell is shared: the rumour directory's
 * actions include combine and convert-to-quest, which no other entity has, so
 * each directory passes its own buttons. Selection state is
 * `shared/hooks/useSelection`; the rows' checkboxes are `RosterRow`'s
 * `leadingControl` and `selected`.
 */
export const RosterBatchBar: React.FC<RosterBatchBarProps> = ({ label, children, error }) => (
  <>
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-secondary">
      <Typography variant="body-sm" className="font-medium">
        {label}
      </Typography>
      <div className="flex flex-wrap gap-2 ml-auto">{children}</div>
    </div>
    {error && (
      <div className="mt-2 p-2 rounded flex items-center gap-2 feedback-banner feedback-banner-error">
        <AlertCircle size={18} className="feedback-error" />
        <Typography color="error">{error}</Typography>
      </div>
    )}
  </>
);

// ---------------------------------------------------------------------------
// Show more
// ---------------------------------------------------------------------------

export interface RosterShowMoreProps {
  /** Rows on the page. */
  shown: number;
  /** Rows the roster holds. */
  total: number;
  /** How many one press adds, at most. */
  step: number;
  /** What the rows are, plural: "NPCs". */
  noun: string;
  onShowMore: () => void;
}

/**
 * The foot of a roster cut to its first rows: how many are on the page, and a
 * button for the next batch. A plain button rather than infinite scroll, so
 * the footer and everything below the roster stay reachable, and the
 * browser's find-in-page searches exactly what the reader asked to see (T101).
 */
export const RosterShowMore: React.FC<RosterShowMoreProps> = ({
  shown,
  total,
  step,
  noun,
  onShowMore,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    {/* A status, so the new count is announced after each press. */}
    <Typography variant="body-sm" color="secondary" role="status">
      Showing {shown} of {total} {noun}
    </Typography>
    <Button variant="outline" size="sm" onClick={onShowMore}>
      Show {Math.min(step, total - shown)} more
    </Button>
  </div>
);

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export interface RosterGroupProps {
  title: string;
  count: number;
  /** Rendered as a link beside the heading when the group maps to a real record. */
  onOpen?: () => void;
  openLabel?: string;
  /** Marks a placeholder group such as "Location unknown". */
  muted?: boolean;
  /**
   * Renders the group as a recessed part of the row above it rather than a card
   * of its own. A location's sub-locations and a quest's objectives are parts of
   * one object; boxing them restates a containment the indentation already says.
   */
  nested?: boolean;
  /**
   * Makes the heading a disclosure for its own rows.
   *
   * Opt-in, because most groups should not collapse: a location group in the
   * NPC list is how the list is *organised*, and hiding it hides the list. It
   * exists for a group a reader is done with -- the quest directory's Completed
   * and Failed (T015), which are history rather than work.
   *
   * T017 wants this same primitive grown for batch selection. Coordinate with
   * it rather than forking the component.
   */
  collapsible?: boolean;
  /** Start collapsed. Only meaningful with `collapsible`. */
  defaultCollapsed?: boolean;
  /**
   * Whether the group is collapsed, when its list decides that rather than
   * the group: to open it for a deep link to a row inside, or to know whether
   * its rows are on the page at all (T101). Pair with `onCollapsedChange`.
   */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  children: React.ReactNode;
}

/**
 * A group heading plus its rows.
 *
 * The heading is a real heading. It used to be `<Button variant="ghost">` wrapping
 * `<Typography variant="h3">`, which handed screen readers a control where a
 * landmark belongs and gave no visible hint that the place name was a link. The
 * link is now a separate, labelled affordance.
 */
export const RosterGroup: React.FC<RosterGroupProps> = ({
  title,
  count,
  onOpen,
  openLabel = 'Open location',
  muted = false,
  nested = false,
  collapsible = false,
  defaultCollapsed = false,
  collapsed,
  onCollapsedChange,
  children,
}) => {
  const [ownCollapsed, setOwnCollapsed] = React.useState(collapsible && defaultCollapsed);
  const isCollapsed = collapsible && (collapsed ?? ownCollapsed);
  const toggle = () => {
    if (collapsed === undefined) setOwnCollapsed(!isCollapsed);
    onCollapsedChange?.(!isCollapsed);
  };
  const bodyId = React.useId();

  const heading = (
    <Typography
      variant="h3"
      className={clsx('text-lg', muted && 'typography-secondary')}
    >
      {title}
    </Typography>
  );

  return (
  <section className="flex flex-col gap-2">
    <div className="flex items-center gap-3 flex-wrap">
      {collapsible ? (
        // The whole heading is the control, because a heading that toggles
        // something needs a target bigger than a glyph. The heading itself
        // stays a heading inside it, so the page's outline is unchanged.
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!isCollapsed}
          aria-controls={bodyId}
          className="flex items-center gap-2 text-left"
        >
          <ChevronRight
            size={16}
            aria-hidden="true"
            className={clsx('transition-transform shrink-0', !isCollapsed && 'rotate-90')}
          />
          {heading}
        </button>
      ) : (
        heading
      )}
      {/*
        The count was a filled pill, which gave a number the same weight as a
        control. It is metadata about the heading beside it, so it reads as
        muted ink on the same line.
      */}
      <Typography variant="body-sm" color="muted" className="text-sm tabular-nums">
        {count}
      </Typography>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="text-sm underline underline-offset-2 typography-secondary roster-group-open"
        >
          {openLabel}
        </button>
      )}
    </div>

    <div
      id={bodyId}
      hidden={isCollapsed}
      className={clsx(
        'rounded-lg overflow-hidden',
        nested ? 'bg-secondary card-border' : 'card'
      )}
    >
      {children}
    </div>
  </section>
  );
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * The tones a roster row's state can take, named after the scale it belongs to.
 *
 * This replaces a five-word vocabulary -- `active`, `completed`, `failed`,
 * `unknown`, `general` -- that described *hues* rather than meanings, and was
 * therefore something any entity could reach into. That is not a tidiness
 * complaint: `completed` was green and available, so a visited location took
 * it and the application began claiming that exploring a place was a win
 * condition. A vocabulary that cannot say "green" cannot make that mistake.
 *
 * Three scales, and the choice between them is a claim about the domain:
 *
 *   - `outcome` is for a thing that **concluded**, and is the only valenced
 *     scale here. Quests, and nothing else.
 *   - `knowledge` is a **ladder**, not a verdict: how much the party knows.
 *     Locations and rumours both ride it, which is why its steps are numbered
 *     rather than named -- `visited` would tie a shared ladder to one domain.
 *   - `disposition` is an NPC's stance toward the party. Valenced, and that
 *     does not contradict presence being unvalenced: a slain villain is not a
 *     bad outcome, but a hostile NPC is genuinely a threat to the reader.
 *
 * `present` and `absent` carry no hue at all, which is the point rather than
 * an omission. The default state of a thing needs no encoding, and a fact
 * (this NPC died) is not an error.
 */
export type RosterStatusTone =
  // Valence -- the shared ramp, good to bad. Every directory that ranks its
  // states draws from this, which is what makes the four pages read as one
  // system. NPC presence takes all four; a three-state scale takes three of
  // the same four, so no directory carries a spacing of its own.
  | 'valence-0'
  | 'valence-1'
  | 'valence-2'
  | 'valence-3'
  // Disposition -- an NPC's stance toward the party. Unranked, so it keeps its
  // own scale: friendly and hostile borrow the ramp's ends because a stance
  // genuinely is good or bad, but neutral and unknown are not points between
  // them and must not be painted as though they were.
  | 'friendly'
  | 'neutral'
  | 'hostile'
  | 'unsure';

const STATUS_TONE: Record<RosterStatusTone, string> = {
  'valence-0': 'valence-0',
  'valence-1': 'valence-1',
  'valence-2': 'valence-2',
  'valence-3': 'valence-3',
  friendly: 'disposition-friendly',
  neutral: 'disposition-neutral',
  hostile: 'disposition-hostile',
  unsure: 'disposition-unknown',
};

export interface RosterStatusProps {
  /** Which state this is, in the vocabulary of the scale it belongs to. */
  tone: RosterStatusTone;
  /** The state, as a word. Always rendered -- the hue never carries it alone. */
  children: React.ReactNode;
  /**
   * A fact that is fully known and **negated**: a deceased NPC, a false
   * rumour. Draws `cue.negation` -- a hairline rule through the label, in the
   * label's own ink.
   *
   * Deliberately not a tone. Negation is orthogonal to which scale a state
   * belongs to: a false rumour is still at the top of the knowledge ladder,
   * and saying so in red would claim it went wrong when it simply turned out
   * not to be true. The strike is what carries that distinction without
   * spending a hue on it -- and without it, a false rumour and a confirmed
   * one are indistinguishable, since both are fully known.
   */
  negated?: boolean;
  className?: string;
}

/**
 * A status, stated as a word in the status hue.
 *
 * One component so that a quest's "Completed" and a rumour's "Confirmed" are
 * the same kind of fact and look like it -- same weight, same placement, same
 * vocabulary. Four directories previously reached for four parallel class
 * families (`quest-status-*`, `rumor-status-*`, `npc-status-*`,
 * `location-status-*`) that all resolved to the same five tokens, which is how
 * they drifted apart once already: `location-status-explored` and
 * `-visited` were swapped against their own legend for as long as a dot was
 * there to cover it. Those families are gone; a row now names a meaning and
 * the meaning owns the hue.
 *
 * The word is not optional. The hue is a scanning aid on top of it, never a
 * substitute, so the directories stay fully readable with hue removed.
 */
export const RosterStatus: React.FC<RosterStatusProps> = ({
  tone,
  children,
  negated,
  className,
}) => (
  <Typography
    variant="body-sm"
    className={clsx(
      'hidden md:block text-sm font-semibold',
      STATUS_TONE[tone],
      negated && 'cue-negated',
      className
    )}
  >
    {children}
  </Typography>
);

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

export interface RosterRowProps {
  /**
   * The entity's own document id — not the prefixed DOM `id` below. It is what
   * makes the mark stable: the same NPC shows the same hue in this list, in the
   * activity feed and on any surface that adopts the sigil later.
   *
   * Required, and required to be non-empty. Deriving the mark from the name
   * instead would move it whenever anyone corrects a spelling, and falling back
   * to `''` would paint every id-less row the same hue — wrong in a way that
   * looks right.
   */
  entityId: string;
  /** The entity's display name or title. Determines the letter, and only that. */
  entityName: string;
  /** Grid template for the row's cells, so each directory can size its own columns. */
  gridClassName: string;
  /** The collapsed row's cells, laid out on the grid. */
  children: React.ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  /** Rendered below the row when expanded. */
  expandedContent?: React.ReactNode;
  /** Accessible name for the expand control, e.g. the entry's name. */
  toggleLabel: string;
  /**
   * A control rendered beside the row, OUTSIDE the expand button — a selection
   * checkbox, for instance. It cannot go in `children`, because those render inside
   * the button and nesting interactive elements in a button is invalid HTML and
   * swallows the inner control's clicks.
   */
  leadingControl?: React.ReactNode;
  isFirst?: boolean;
  highlighted?: boolean;
  /**
   * Batch selection. Painted from the row's own surface rather than the accent
   * or a status hue -- selection is feedback about what you are about to act on,
   * not a property of the record.
   */
  selected?: boolean;
  id?: string;
  /**
   * How deep in a tree the row sits; a location's rows nest. The row indents
   * {@link ROSTER_INDENT_PX} a level behind a hairline rail, and the indent
   * stops at {@link ROSTER_MAX_VISUAL_DEPTH} so a place nine levels down
   * still has a name column to read (§6.1).
   *
   * The indent comes out of the name column alone: a directory with nested
   * rows sizes every other column in fixed widths, so its statuses and counts
   * stay lined up at every depth.
   */
  depth?: number;
  /** The rows inside this one, rendered after its expansion. */
  nested?: React.ReactNode;
}

/** How far each level of a tree indents, in px. */
export const ROSTER_INDENT_PX = 30;
/** The deepest level that still indents further. */
export const ROSTER_MAX_VISUAL_DEPTH = 4;

/**
 * One dense row, expanding in place.
 *
 * The collapsed card spent five lines and a button to convey what a single row
 * carries: name, title, status, standing and occupation. With nineteen entries you
 * scrolled past a lot of card to find anybody.
 */
export const RosterRow: React.FC<RosterRowProps> = ({
  entityId,
  entityName,
  gridClassName,
  children,
  expanded = false,
  onToggle,
  expandedContent,
  toggleLabel,
  leadingControl,
  isFirst = false,
  highlighted = false,
  selected = false,
  id,
  depth = 0,
  nested,
}) => {
  // Loud on purpose. A row reaching this component without an id is a data bug,
  // and the quiet alternatives are both worse than a crash: no mark leaves one
  // row visibly different from its neighbours for no stated reason, and a mark
  // derived from `''` paints every such row the same hue, which reads as a
  // deliberate grouping that does not exist.
  if (!entityId) {
    throw new Error(
      `RosterRow: entityId is required and must be non-empty (row "${entityName}").`
    );
  }

  const indent = Math.min(depth, ROSTER_MAX_VISUAL_DEPTH) * ROSTER_INDENT_PX;
  const isExpanded = expanded;

  /*
    The mark sits outside the grid rather than as another column, so the
    four directories keep their own column templates unchanged — a leading
    `auto` in each of them would be the same slot expressed four times, and
    would drift the moment one of them was edited.
  */
  const line = (
    <>
      <EntitySigil entityId={entityId} name={entityName} size={28} />

      <div className={clsx('flex-1 min-w-0 items-center gap-4 grid', gridClassName)}>
        {children}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={clsx(
            'justify-self-end transition-transform typography-secondary',
            isExpanded && 'rotate-180'
          )}
        />
      </div>
    </>
  );

  return (
  <div
    id={id}
    className={clsx(
      'transition-colors',
      !isFirst && 'border-t border-card',
      highlighted && `highlighted-item`,
      isExpanded && 'bg-secondary'
    )}
  >
    {/*
      The selection tint covers the row and its expansion, not the rows nested
      under it: those are selected, or not, on their own.
    */}
    <div data-testid="roster-row-line" className={clsx(selected && 'roster-row-selected')}>
      <div className="flex items-stretch">
        {indent > 0 && (
          // The rail. A hairline at the indent, not a box.
          <div
            data-testid="roster-indent"
            aria-hidden="true"
            className="shrink-0 border-r card-border"
            style={{ width: indent }}
          />
        )}

        {leadingControl && (
          <div className="flex items-center pl-5 shrink-0">{leadingControl}</div>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${toggleLabel}`}
          className="flex-1 min-w-0 text-left flex items-center gap-4 roster-row selectable-item"
        >
          {line}
        </button>
      </div>

      {isExpanded && expandedContent && (
        <div
          className="px-5 pb-5 pt-1 border-t border-card"
          style={indent > 0 ? { paddingLeft: indent + 20 } : undefined}
        >
          {expandedContent}
        </div>
      )}
    </div>

    {nested}
  </div>
  );
};

// ---------------------------------------------------------------------------
// Name
// ---------------------------------------------------------------------------

export interface RosterNameProps {
  /** The entity's name or title. */
  name: React.ReactNode;
  /**
   * The line under it: an NPC's title, a place's type, a quest's location, a
   * rumour's source. Kept even when empty.
   */
  detail?: React.ReactNode;
  /** Draws the name muted, as for a rumour nobody has named yet. */
  muted?: boolean;
  /** Beside the name, such as a rumour's "Unsaved". */
  badge?: React.ReactNode;
}

/**
 * The first cell of every directory row: the name, and a second line under it.
 *
 * One cell for all four directories so their rows are one shape. The second
 * line is always there, a blank one when there is nothing to say: a row's
 * height is part of what makes a list read as one list, and an NPC without a
 * title used to sit a line shorter than the one above it.
 */
export const RosterName: React.FC<RosterNameProps> = ({ name, detail, muted, badge }) => (
  <div className="flex flex-col gap-0.5 min-w-0">
    <div className="flex items-center gap-2 min-w-0">
      <Typography
        variant="body"
        color={muted ? 'muted' : undefined}
        className="font-semibold truncate font-heading"
      >
        {name}
      </Typography>
      {badge}
    </div>
    <Typography variant="body-sm" color="secondary" className="text-sm truncate">
      {detail || ' '}
    </Typography>
  </div>
);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface RosterSkeletonProps {
  /** How many placeholder rows to draw. Defaults to a comfortable page. */
  rows?: number;
  /** Announced while the rows are standing in for real content. */
  label?: string;
}

/**
 * The shape of the list that is coming, rather than a spinner.
 *
 * A spinner says "something is happening"; a skeleton says "a list of rows is
 * happening, and it will be about this tall", so the page does not jump when it
 * arrives. Four directories had drifted to three different answers here -- two
 * spinners with different icons and two bare lines of text.
 *
 * The mark, the name and the metadata line are each drawn at their real size, so
 * this is the row rhythm and not a decorative bar chart.
 */
export const RosterSkeleton: React.FC<RosterSkeletonProps> = ({
  rows = 5,
  label = 'Loading',
}) => (
  <div
    className={clsx('rounded-lg overflow-hidden card')}
    role="status"
    aria-label={label}
  >
    {Array.from({ length: rows }, (_, index) => (
      <div
        key={index}
        className={clsx(
          'flex items-center gap-4 roster-row',
          index > 0 && 'border-t border-card'
        )}
        aria-hidden="true"
      >
        <div className="w-7 h-7 rounded-md section-loading shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="h-3.5 rounded section-loading w-[38%]" />
          <div className="h-3 rounded section-loading w-[22%]" />
        </div>
        <div className="hidden md:block h-3 rounded section-loading w-[14%]" />
      </div>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

export interface RosterEmptyProps {
  /** What this collection is, stated plainly. */
  title: string;
  /** Why it is empty, and what would fill it. */
  message: string;
  /** The one action that fills it. Omitted when a filter is what emptied it. */
  action?: React.ReactNode;
  /**
   * Shows the rune ᛗ above the title. Only for a campaign with none of these
   * at all, where the title is Muninn's line; never for a filtered list.
   */
  mark?: boolean;
}

/**
 * An empty collection, designed rather than blank.
 *
 * This is where a returning user is most likely to read the product as
 * unfinished, so it says what the collection is for and offers the one action
 * that fills it. No generic icon: a large grey glyph is decoration on a surface
 * whose whole problem is that it has nothing to say yet. The one mark it takes
 * is the site's own rune, small and faint, where the title is in Muninn's
 * voice (`mark`; maintainer, 2026-10-10).
 *
 * A collection emptied by a *filter* passes no action -- the fix there is to
 * change the filter, and offering "Add an NPC" would answer a question nobody
 * asked.
 */
export const RosterEmpty: React.FC<RosterEmptyProps> = ({ title, message, action, mark }) => (
  <div className={clsx('rounded-lg card px-6 py-12 text-center')}>
    {mark && <RuneMark size={26} className="block mb-2 typography-secondary opacity-50" />}
    <Typography variant="h3" className="text-lg mb-1.5">
      {title}
    </Typography>
    <Typography color="secondary" className="text-sm max-w-md mx-auto">
      {message}
    </Typography>
    {action && <div className="mt-5 flex justify-center">{action}</div>}
  </div>
);

// ---------------------------------------------------------------------------
// Field — used inside expanded content
// ---------------------------------------------------------------------------

export interface RosterFieldProps {
  label: string;
  /** Shown in italics when there is no value, rather than hiding the field. */
  emptyText?: string;
  children?: React.ReactNode;
}

/**
 * A labelled field in an expanded row. Empty fields say so instead of vanishing,
 * so the shape of a record is legible even when it is mostly blank.
 */
export const RosterField: React.FC<RosterFieldProps> = ({
  label,
  emptyText = 'Not recorded',
  children,
}) => (
  <div className="flex flex-col gap-1.5">
    <Typography
      variant="body-sm"
      color="muted"
      className="text-[11px] font-semibold uppercase tracking-wider"
    >
      {label}
    </Typography>
    {children ?? (
      <Typography variant="body-sm" color="muted" className="italic">
        {emptyText}
      </Typography>
    )}
  </div>
);
