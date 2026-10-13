// src/core/components/__tests__/Roster.test.tsx
import React from 'react';
import { render, screen, fireEvent, within, getDefaultNormalizer } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RosterStatusBar,
  RosterFilterBar,
  RosterFilterPills,
  RosterFilterSelect,
  RosterGroup,
  RosterRow,
  RosterName,
  RosterStatus,
  RosterField,
  type RosterSegment,
  type RosterStatusTone,
} from '../Roster';

jest.mock('../Typography', () => ({
  __esModule: true,
  default: ({ children, variant, className }: any) => {
    const Tag = variant === 'h3' ? 'h3' : variant === 'h4' ? 'h4' : 'span';
    return <Tag className={className}>{children}</Tag>;
  },
}));

const segments: RosterSegment[] = [
  { key: 'alive', label: 'alive', count: 15, colorClass: 'bg-status-completed' },
  { key: 'deceased', label: 'deceased', count: 4, colorClass: 'bg-status-failed' },
  { key: 'missing', label: 'missing', count: 0, colorClass: 'bg-status-unknown' },
];

describe('RosterStatusBar', () => {
  test('states the total and its label', () => {
    render(
      <RosterStatusBar
        total={19}
        totalLabel="met so far"
        segments={segments}
        activeKey="all"
        onSelect={jest.fn()}
      />
    );
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(screen.getByText('met so far')).toBeInTheDocument();
  });

  test('pairs every band with a word, so colour is never the only cue', () => {
    render(
      <RosterStatusBar
        total={19}
        totalLabel="met so far"
        segments={segments}
        activeKey="all"
        onSelect={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: '15 alive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4 deceased' })).toBeInTheDocument();
  });

  test('keeps empty bands listed but dimmed', () => {
    render(
      <RosterStatusBar
        total={19}
        totalLabel="met so far"
        segments={segments}
        activeKey="all"
        onSelect={jest.fn()}
      />
    );
    const empty = screen.getByRole('button', { name: '0 missing' });
    expect(empty).toBeInTheDocument();
    expect(empty.className).toContain('opacity-50');
  });

  test('marks each band so neighbours can be separated', () => {
    // The bands sit flush against one another, so a band's only ground is the
    // band beside it -- and the scales do not clear 3:1 against themselves.
    // `.roster-band` is what the hairline in components.css hangs off; see
    // themes/__tests__/roster-band-separation.test.ts for the measurement.
    const { container } = render(
      <RosterStatusBar
        total={19}
        totalLabel="met so far"
        segments={segments}
        activeKey="all"
        onSelect={jest.fn()}
      />
    );
    const bands = container.querySelectorAll('.roster-band');
    // Two, not three: the empty band is listed in the legend but drawn nowhere,
    // so it must not contribute a separator to a bar it has no width in.
    expect(bands).toHaveLength(2);
    expect([...bands].map(band => band.className)).toEqual([
      'roster-band bg-status-completed',
      'roster-band bg-status-failed',
    ]);
  });

  test('selects a band', () => {
    const onSelect = jest.fn();
    render(
      <RosterStatusBar
        total={19}
        totalLabel="met so far"
        segments={segments}
        activeKey="all"
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '4 deceased' }));
    expect(onSelect).toHaveBeenCalledWith('deceased');
  });

  test('clicking the active band clears back to all', () => {
    const onSelect = jest.fn();
    render(
      <RosterStatusBar
        total={19}
        totalLabel="met so far"
        segments={segments}
        activeKey="alive"
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '15 alive' }));
    expect(onSelect).toHaveBeenCalledWith('all');
  });

  test('marks the active band as pressed', () => {
    render(
      <RosterStatusBar
        total={19}
        totalLabel="met so far"
        segments={segments}
        activeKey="alive"
        onSelect={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: '15 alive' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: '4 deceased' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  test('does not divide by zero on an empty roster', () => {
    expect(() =>
      render(
        <RosterStatusBar
          total={0}
          totalLabel="met so far"
          segments={[{ key: 'alive', label: 'alive', count: 0, colorClass: 'bg-x' }]}
          activeKey="all"
          onSelect={jest.fn()}
        />
      )
    ).not.toThrow();
  });
});

describe('RosterFilterPills', () => {
  const options = [
    { value: 'all', label: 'All' },
    { value: 'friendly', label: 'Friendly' },
  ];

  test('renders every option visibly rather than behind a select', () => {
    render(
      <RosterFilterPills
        options={options}
        value="all"
        onChange={jest.fn()}
        label="Filter by relationship"
      />
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Friendly' })).toBeInTheDocument();
  });

  test('exposes the group with an accessible name', () => {
    render(
      <RosterFilterPills
        options={options}
        value="all"
        onChange={jest.fn()}
        label="Filter by relationship"
      />
    );
    expect(
      screen.getByRole('group', { name: 'Filter by relationship' })
    ).toBeInTheDocument();
  });

  test('reports the chosen value', () => {
    const onChange = jest.fn();
    render(
      <RosterFilterPills
        options={options}
        value="all"
        onChange={onChange}
        label="Filter by relationship"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Friendly' }));
    expect(onChange).toHaveBeenCalledWith('friendly');
  });

  test('the sm size is the same control, only more compact', () => {
    const onChange = jest.fn();
    render(
      <RosterFilterPills
        options={options}
        value="all"
        onChange={onChange}
        label="Filter activity by type"
        size="sm"
      />
    );

    // Same roles, same accessible names, same pressed semantics as the default
    // size — the dashboard's row differs in geometry, not in behaviour.
    const all = screen.getByRole('button', { name: 'All' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(all.className).toContain('text-xs');

    fireEvent.click(screen.getByRole('button', { name: 'Friendly' }));
    expect(onChange).toHaveBeenCalledWith('friendly');
  });
});

describe('RosterFilterSelect', () => {
  const options = [
    { value: 'all', label: 'All Locations' },
    { value: 'Dungeon', label: 'Dungeon' },
    { value: 'Forest', label: 'Forest' },
  ];

  test('exposes its label as the accessible name, with no visible label text', () => {
    render(
      <RosterFilterSelect
        options={options}
        value="all"
        onChange={jest.fn()}
        label="Filter by location"
      />
    );
    expect(
      screen.getByRole('combobox', { name: 'Filter by location' })
    ).toBeInTheDocument();
    // The old markup carried a visible "Location:" label the pills never had.
    expect(screen.queryByText('Location:')).not.toBeInTheDocument();
  });

  test('offers every option, unlike pills which would need one control each', () => {
    render(
      <RosterFilterSelect
        options={options}
        value="all"
        onChange={jest.fn()}
        label="Filter by location"
      />
    );
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  test('reports the chosen value', () => {
    const onChange = jest.fn();
    render(
      <RosterFilterSelect
        options={options}
        value="all"
        onChange={onChange}
        label="Filter by location"
      />
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Forest' } });
    expect(onChange).toHaveBeenCalledWith('Forest');
  });

  test('wears the pills\' active treatment once it is actually filtering', () => {
    const { rerender } = render(
      <RosterFilterSelect
        options={options}
        value="all"
        onChange={jest.fn()}
        label="Filter by location"
      />
    );
    // Idle on the "all" value, so a filter row reads as unfiltered at a glance.
    expect(screen.getByRole('combobox').className).toContain('roster-filter-idle');
    expect(screen.getByRole('combobox').className).not.toContain('roster-filter-active');

    rerender(
      <RosterFilterSelect
        options={options}
        value="Forest"
        onChange={jest.fn()}
        label="Filter by location"
      />
    );
    expect(screen.getByRole('combobox').className).toContain('roster-filter-active');
    expect(screen.getByRole('combobox').className).not.toContain('roster-filter-idle');
  });
});

describe('RosterFilterBar', () => {
  test('renders the search field with its placeholder and reports typing', () => {
    const onChange = jest.fn();
    render(
      <RosterFilterBar placeholder="Search quests..." value="" onChange={onChange} />
    );

    const search = screen.getByPlaceholderText('Search quests...');
    fireEvent.change(search, { target: { value: 'dragon' } });
    expect(onChange).toHaveBeenCalledWith('dragon');
  });

  test('renders filter controls beside the search field', () => {
    render(
      <RosterFilterBar placeholder="Search quests..." value="" onChange={jest.fn()}>
        <button type="button">Select Rumors</button>
      </RosterFilterBar>
    );
    expect(screen.getByRole('button', { name: 'Select Rumors' })).toBeInTheDocument();
  });

  test('is not wrapped in a card, so every directory\'s row sits flat on the page', () => {
    // Quests alone used to wrap this row in a Card, giving it a raised panel its
    // three siblings did not have. One component, one answer.
    const { container } = render(
      <RosterFilterBar placeholder="Search quests..." value="" onChange={jest.fn()} />
    );
    expect(container.querySelector('.card')).toBeNull();
  });
});

describe('RosterGroup', () => {
  test('renders the title as a heading, not a control', () => {
    render(
      <RosterGroup title="Neverwinter Wood" count={1}>
        <div>row</div>
      </RosterGroup>
    );
    // The group header used to be a heading wrapped in a ghost button.
    expect(
      screen.getByRole('heading', { name: 'Neverwinter Wood' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Neverwinter Wood' })
    ).not.toBeInTheDocument();
  });

  test('shows the entry count', () => {
    render(
      <RosterGroup title="Neverwinter Wood" count={3}>
        <div>row</div>
      </RosterGroup>
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('offers a separate labelled link when the group maps to a record', () => {
    const onOpen = jest.fn();
    render(
      <RosterGroup title="Neverwinter Wood" count={1} onOpen={onOpen}>
        <div>row</div>
      </RosterGroup>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open location' }));
    expect(onOpen).toHaveBeenCalled();
  });

  test('omits the link when there is nothing to open', () => {
    render(
      <RosterGroup title="Location unknown" count={2} muted>
        <div>row</div>
      </RosterGroup>
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('RosterRow', () => {
  const renderRow = (props: Partial<React.ComponentProps<typeof RosterRow>> = {}) =>
    render(
      <RosterRow
        entityId="acar"
        entityName="Acar"
        gridClassName="grid-cols-2"
        toggleLabel="Acar"
        expandedContent={<div>detail</div>}
        {...props}
      >
        <span>Acar</span>
      </RosterRow>
    );

  test('is a real button, so the row is keyboard reachable', () => {
    renderRow();
    expect(
      screen.getByRole('button', { name: /Expand Acar/ }).tagName
    ).toBe('BUTTON');
  });

  test('reports collapsed state via aria-expanded', () => {
    renderRow();
    expect(screen.getByRole('button', { name: /Expand Acar/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  test('shows expanded content only when expanded', () => {
    const { rerender } = renderRow();
    expect(screen.queryByText('detail')).not.toBeInTheDocument();

    rerender(
      <RosterRow
        entityId="acar"
        entityName="Acar"
        gridClassName="grid-cols-2"
        toggleLabel="Acar"
        expanded
        expandedContent={<div>detail</div>}
      >
        <span>Acar</span>
      </RosterRow>
    );
    expect(screen.getByText('detail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Collapse Acar/ })).toBeInTheDocument();
  });

  test('calls onToggle when activated', () => {
    const onToggle = jest.fn();
    renderRow({ onToggle });
    fireEvent.click(screen.getByRole('button', { name: /Expand Acar/ }));
    expect(onToggle).toHaveBeenCalled();
  });

  test("applies the caller’s grid template to the element holding the cells", () => {
    // The template moved off the button when the row gained its identity mark:
    // the button is now a flex row of [mark, grid], so the columns the caller
    // sizes belong to the grid, not the button. Asserted on the element that
    // actually contains the cells, so it cannot pass on an empty grid.
    renderRow();
    const button = screen.getByRole('button', { name: /Expand Acar/ });
    const grid = button.querySelector('.grid');
    expect(grid).not.toBeNull();
    expect(grid!.className).toContain('grid-cols-2');
    expect(grid!).toContainElement(screen.getByText('Acar'));
  });

  test('renders a leadingControl outside the expand button, not nested in it', () => {
    renderRow({
      leadingControl: <input type="checkbox" aria-label="Select Acar" />,
    });

    const checkbox = screen.getByRole('checkbox', { name: 'Select Acar' });
    const toggle = screen.getByRole('button', { name: /Expand Acar/ });

    expect(checkbox).toBeInTheDocument();
    // Interactive elements nested inside a <button> are invalid HTML and the inner
    // control's clicks get swallowed, so the slot must sit beside the button.
    expect(toggle).not.toContainElement(checkbox);
  });

  test('a leadingControl click does not toggle the row', () => {
    const onToggle = jest.fn();
    renderRow({
      onToggle,
      leadingControl: <input type="checkbox" aria-label="Select Acar" />,
    });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Acar' }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  test('renders no leading slot when none is given', () => {
    renderRow();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  test('omits the top border on the first row only', () => {
    const { container, unmount } = renderRow({ isFirst: true });
    expect(container.firstElementChild!.className).not.toContain('border-t');
    unmount();

    const { container: second } = renderRow({ isFirst: false });
    expect(second.firstElementChild!.className).toContain('border-t');
  });
});

describe('RosterField', () => {
  test('renders its value when there is one', () => {
    render(<RosterField label="Description"><span>A brewer</span></RosterField>);
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('A brewer')).toBeInTheDocument();
  });

  test('says an empty field is empty rather than vanishing', () => {
    render(<RosterField label="Description" emptyText="Nothing written yet" />);
    // The shape of a record should stay legible even when mostly blank.
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Nothing written yet')).toBeInTheDocument();
  });

  test('falls back to a default empty message', () => {
    render(<RosterField label="Race" />);
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
  });
});

describe('RosterStatus', () => {
  const ALL_TONES = [
    'valence-0',
    'valence-1',
    'valence-2',
    'valence-3',
    'friendly',
    'neutral',
    'hostile',
    'unsure',
  ] as const;

  /** Every class the rendered status carries. */
  const toneClass = (container: HTMLElement): string =>
    (container.firstChild as HTMLElement).className;

  /** The one class that comes from a scale, with the shape classes dropped. */
  const SCALE_PREFIXES = ['valence-', 'disposition-'];
  const fromScale = (cls: string): string | undefined =>
    cls.split(/\s+/).find(c => SCALE_PREFIXES.some(p => c.startsWith(p)));

  test('states the status as a word, always', () => {
    render(<RosterStatus tone="valence-0">Confirmed</RosterStatus>);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
  });

  test('the best case is the same colour on every page', () => {
    // This assertion is the reverse of the one it replaces, and deliberately so.
    //
    // 12-3a split these apart: a quest concluded and took `outcome`, while a
    // rumour was knowledge and rode an unhued ladder, because the application
    // had been claiming that exploring a place was a win condition. That fixed
    // the semantics and left four directories that looked like four products,
    // three of them in greys nobody could rank at a glance.
    //
    // The valence ramp is the deliberate trade: the directories that *do* rank
    // their states now share one scale, so "the best case" is one green
    // everywhere and "the worst case" one red. What keeps the original bug from
    // returning is that the ramp is not the outcome scale wearing a new name --
    // it is positional, nothing on it is called `completed`, and the scales that
    // genuinely are not ranked (`knowledge`, `disposition`, `presence`) still
    // exist and still read differently.
    const render1 = (tone: RosterStatusTone, label: string) => {
      const { container, unmount } = render(<RosterStatus tone={tone}>{label}</RosterStatus>);
      const cls = fromScale(toneClass(container));
      unmount();
      return cls;
    };
    const best = [
      render1('valence-0', 'Completed'),
      render1('valence-0', 'Confirmed'),
      render1('valence-0', 'Explored'),
      render1('valence-0', 'Alive'),
    ];
    expect(new Set(best).size).toBe(1);
    // ...and the unranked scale that remains still refuses to join them.
    expect(render1('unsure', 'Unknown stance')).not.toBe(best[0]);
  });

  test('a confirmed and a false rumour do not share a rung', () => {
    // A false rumour wears the red of a failed quest (maintainer, 2026-10-03),
    // so the two must render apart, and false must match a failed quest.
    const { container: confirmed } = render(
      <RosterStatus tone="valence-0">Confirmed</RosterStatus>
    );
    const { container: falseRumour } = render(
      <RosterStatus tone="valence-3">False</RosterStatus>
    );
    const { container: failedQuest } = render(
      <RosterStatus tone="valence-3">Failed</RosterStatus>
    );
    expect(toneClass(confirmed)).not.toBe(toneClass(falseRumour));
    expect(toneClass(falseRumour)).toBe(toneClass(failedQuest));
  });

  test('every tone resolves to a class from the scale it names', () => {
    const resolved = ALL_TONES.map(tone => {
      const { container, unmount } = render(
        <RosterStatus tone={tone}>Word</RosterStatus>
      );
      const cls = fromScale(toneClass(container));
      unmount();
      return [tone, cls];
    });

    expect(resolved).toEqual([
      ['valence-0', 'valence-0'],
      ['valence-1', 'valence-1'],
      ['valence-2', 'valence-2'],
      ['valence-3', 'valence-3'],
      ['friendly', 'disposition-friendly'],
      ['neutral', 'disposition-neutral'],
      ['hostile', 'disposition-hostile'],
      ['unsure', 'disposition-unknown'],
    ]);
  });

  test('no tone can name a retired status hue', () => {
    // The vocabulary is the fix, not the CSS. A tone set that cannot say
    // `completed` cannot let a location borrow green in the first place.
    ALL_TONES.forEach(tone => {
      const { container, unmount } = render(
        <RosterStatus tone={tone}>Word</RosterStatus>
      );
      expect(toneClass(container)).not.toMatch(/\bstatus-/);
      unmount();
    });
  });

  test('keeps one weight and placement across every tone', () => {
    const shapes = new Set<string>();
    ALL_TONES.forEach(tone => {
      const { container, unmount } = render(
        <RosterStatus tone={tone}>Word</RosterStatus>
      );
      const cls = toneClass(container)
        .split(/\s+/)
        .filter(c => !SCALE_PREFIXES.some(p => c.startsWith(p)))
        .sort()
        .join(' ');
      shapes.add(cls);
      unmount();
    });
    expect(shapes.size).toBe(1);
  });
});

describe('RosterStatus negation cue', () => {
  // `cue.negation`, from schema section 6. A deceased NPC and a false rumour
  // are both facts that are fully known and *negated*, which is what a strike
  // says and a red label does not -- a red label claims something went wrong,
  // and neither of them did.
  test('a negated state carries the strike', () => {
    const { container } = render(
      <RosterStatus tone="valence-3" negated>
        False
      </RosterStatus>
    );
    expect((container.firstChild as HTMLElement).className).toContain('cue-negated');
  });

  test('an ordinary state does not', () => {
    const { container } = render(<RosterStatus tone="valence-3">Confirmed</RosterStatus>);
    expect((container.firstChild as HTMLElement).className).not.toContain('cue-negated');
  });

  test('negation is orthogonal to tone, not a tone of its own', () => {
    // This is the property that matters. A false rumour sits at the *top* of
    // the knowledge ladder alongside a confirmed one -- both are fully known --
    // so the two are indistinguishable by hue by design, and the strike is the
    // only thing separating them. If negation were a tone it would have to
    // leave the ladder to say so.
    const cls = (negated: boolean) => {
      const { container, unmount } = render(
        <RosterStatus tone="valence-3" negated={negated}>
          Word
        </RosterStatus>
      );
      const value = (container.firstChild as HTMLElement).className;
      unmount();
      return value;
    };
    const plain = cls(false).split(/\s+/).sort();
    const struck = cls(true).split(/\s+/).sort();
    expect(struck.filter(c => !plain.includes(c))).toEqual(['cue-negated']);
  });
});

describe('RosterRow batch selection', () => {
  const renderRow = (props: Partial<React.ComponentProps<typeof RosterRow>> = {}) =>
    render(
      <RosterRow
        entityId="r1"
        entityName="Dragon spotted"
        gridClassName="grid-cols-2"
        toggleLabel="Dragon spotted"
        {...props}
      >
        <span>Dragon spotted</span>
      </RosterRow>
    );

  test('an unselected row carries no selection paint', () => {
    const { container } = renderRow();
    expect(container.querySelector('.roster-row-selected')).toBeNull();
  });

  test('a selected row paints from its own surface, not the accent or a status hue', () => {
    // Selection says "this is what you are about to act on" -- feedback about
    // the moment, not a property of the record. A status hue here would mean a
    // selected rumour and a confirmed one shared a colour.
    const { container } = renderRow({ selected: true });
    const row = container.querySelector('.roster-row-selected');
    expect(row).not.toBeNull();
    expect(row!.className).not.toMatch(/status-/);
  });
});

describe('the collection accent budget', () => {
  const options = [
    { value: 'all', label: 'All' },
    { value: 'friendly', label: 'Friendly' },
    { value: 'hostile', label: 'Hostile' },
  ];

  const accented = (root: HTMLElement) =>
    [...root.querySelectorAll('.roster-filter-active')];

  test('nothing in the toolbar is accented while no filter is active', () => {
    // "All" is selected on load in every directory. If selecting it counted as
    // filtering, every collection in the product would show an accent that
    // means nothing -- and an accent that means nothing is the one thing the
    // budget exists to prevent.
    const { container } = render(
      <RosterFilterPills
        options={options}
        value="all"
        onChange={jest.fn()}
        label="Filter by relationship"
      />
    );
    expect(accented(container)).toHaveLength(0);
  });

  test('exactly one filter is accented once one is active', () => {
    const { container } = render(
      <RosterFilterPills
        options={options}
        value="friendly"
        onChange={jest.fn()}
        label="Filter by relationship"
      />
    );
    const marked = accented(container);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent('Friendly');
  });

  test('"All" still reports itself as selected to a screen reader', () => {
    // Selected and accented are two different questions. Dropping `aria-pressed`
    // from the option every directory loads on would be a real regression worn
    // as a visual improvement.
    render(
      <RosterFilterPills
        options={options}
        value="all"
        onChange={jest.fn()}
        label="Filter by relationship"
      />
    );
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('a group heading links out quietly, not in the accent', () => {
    // It repeats once per group, so the accent version put one accent per group
    // down the page and drowned the filter, which is the accent that means
    // something.
    render(
      <RosterGroup title="Rivendell" count={6} onOpen={jest.fn()}>
        <div>row</div>
      </RosterGroup>
    );
    const link = screen.getByRole('button', { name: 'Open location' });
    expect(link.className).toContain('typography-secondary');
    expect(link.className).toContain('underline');
    expect(link.className).not.toContain('typography-primary');
  });
});

describe('RosterGroup nesting', () => {
  // The panel is the element that actually holds the rows -- selected through a
  // child, because the group's count pill is also `bg-secondary` and matching on
  // the class alone finds that instead.
  const panelOf = (getByText: (t: string) => HTMLElement) =>
    getByText('row').parentElement as HTMLElement;

  test('a top-level group is a card', () => {
    const { getByText } = render(
      <RosterGroup title="Rivendell" count={2}>
        <div>row</div>
      </RosterGroup>
    );
    const panel = panelOf(getByText);
    expect(panel.className).toContain('card');
    expect(panel.className).not.toContain('bg-secondary');
  });

  test('a nested group is recessed, not a card of its own', () => {
    // A location's sub-locations are parts of one object. Boxing them as a
    // second card restates a containment the indentation already states.
    const { getByText } = render(
      <RosterGroup title="Locations in Moria" count={2} nested>
        <div>row</div>
      </RosterGroup>
    );
    const panel = panelOf(getByText);
    expect(panel.className).toContain('bg-secondary');
    expect(panel.className).toContain('card-border');
    expect(panel.className.split(/\s+/)).not.toContain('card');
  });
});

describe('RosterRow identity mark', () => {
  const renderRow = (
    props: Partial<React.ComponentProps<typeof RosterRow>> = {}
  ) =>
    render(
      <RosterRow
        entityId="acar"
        entityName="Acar"
        gridClassName="grid-cols-2"
        toggleLabel="Acar"
        {...props}
      >
        <span>Acar</span>
      </RosterRow>
    );

  test('renders exactly one mark per row', () => {
    renderRow();
    expect(screen.getAllByTestId('entity-sigil')).toHaveLength(1);
  });

  test('takes its letter from the name, not the id', () => {
    // The id is a slug and may carry a disambiguating suffix; the reader should
    // see the name's initial.
    renderRow({ entityId: 'kerowyn-hucrele-2', entityName: 'Kerowyn Hucrele' });
    expect(screen.getByTestId('entity-sigil')).toHaveTextContent('K');
  });

  test('the same entity keeps the same hue in a different roster', () => {
    // This is the whole point of deriving from the id: an NPC looks like itself
    // in the directory, in the activity feed, and anywhere else that adopts the
    // mark later.
    const { unmount } = renderRow({ entityId: 'thorin', entityName: 'Thorin' });
    const first = screen.getByTestId('entity-sigil').getAttribute('data-sigil-index');
    unmount();

    // Same id, different display name and a different surrounding row.
    renderRow({ entityId: 'thorin', entityName: 'Thorin Oakenshield', gridClassName: 'grid-cols-3' });
    expect(screen.getByTestId('entity-sigil')).toHaveAttribute('data-sigil-index', first);
  });

  test('two different entities can land on different hues', () => {
    // Not every pair will differ across an 8-bucket hash, so this asserts the
    // index is a function of the id at all rather than a constant.
    const seen = new Set<string | null>();
    ['acar', 'thorin', 'balin', 'dwalin', 'gloin', 'oin', 'bifur', 'bofur'].forEach(id => {
      const { unmount } = renderRow({ entityId: id, entityName: id });
      seen.add(screen.getByTestId('entity-sigil').getAttribute('data-sigil-index'));
      unmount();
    });
    expect(seen.size).toBeGreaterThan(1);
  });

  test('is hidden from assistive technology, because the name is right beside it', () => {
    renderRow();
    expect(screen.getByTestId('entity-sigil')).toHaveAttribute('aria-hidden', 'true');
  });

  test('a row without an id fails loudly rather than rendering a mark', () => {
    // A silent fallback would paint every id-less row the same hue, which reads
    // as a grouping that does not exist.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderRow({ entityId: '' })).toThrow(/entityId is required/);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// RosterGroup -- the collapse affordance (T015, PR 15.3)
// ---------------------------------------------------------------------------

describe('RosterGroup collapse', () => {
  // T101: a list that pages its groups decides their fold itself -- to open
  // the group a deep link points into.
  it('follows a list that decides the fold, and tells it about clicks', () => {
    const onCollapsedChange = jest.fn();
    const { rerender } = render(
      <RosterGroup title="Completed" count={3} collapsible collapsed onCollapsedChange={onCollapsedChange}>
        <div>a row</div>
      </RosterGroup>
    );
    const trigger = screen.getByRole('button', { name: /Completed/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
    // Not its own decision: it stays folded until the list says otherwise.
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    rerender(
      <RosterGroup title="Completed" count={3} collapsible collapsed={false} onCollapsedChange={onCollapsedChange}>
        <div>a row</div>
      </RosterGroup>
    );
    expect(screen.getByRole('button', { name: /Completed/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('a row')).toBeVisible();
  });

  it('does not collapse unless asked to', () => {
    render(
      <RosterGroup title="Rivendell" count={2}>
        <div>a row</div>
      </RosterGroup>
    );
    // A location group in the NPC list is how the list is organised; hiding it
    // would hide the list.
    expect(screen.queryByRole('button', { name: /Rivendell/ })).toBeNull();
    expect(screen.getByText('a row')).toBeVisible();
  });

  it('makes the whole heading the control, so the target is not a glyph', () => {
    render(
      <RosterGroup title="Completed" count={3} collapsible>
        <div>a row</div>
      </RosterGroup>
    );
    const trigger = screen.getByRole('button', { name: /Completed/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(trigger).getByRole('heading', { name: 'Completed' })).toBeInTheDocument();
  });

  it('starts collapsed when asked, and still says how many it holds', () => {
    render(
      <RosterGroup title="Completed" count={3} collapsible defaultCollapsed>
        <div>a row</div>
      </RosterGroup>
    );
    expect(screen.getByRole('button', { name: /Completed/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('a row')).not.toBeVisible();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('opens and closes on click', async () => {
    render(
      <RosterGroup title="Completed" count={3} collapsible defaultCollapsed>
        <div>a row</div>
      </RosterGroup>
    );
    const trigger = screen.getByRole('button', { name: /Completed/ });

    await userEvent.click(trigger);
    expect(screen.getByText('a row')).toBeVisible();

    await userEvent.click(trigger);
    expect(screen.getByText('a row')).not.toBeVisible();
  });

  it('points the control at the rows it governs', () => {
    render(
      <RosterGroup title="Completed" count={1} collapsible>
        <div>a row</div>
      </RosterGroup>
    );
    const trigger = screen.getByRole('button', { name: /Completed/ });
    const controlled = document.getElementById(trigger.getAttribute('aria-controls')!);
    expect(controlled).toContainElement(screen.getByText('a row'));
  });
});

// The four directories' rows are one shape: the same name cell, two lines
// tall whether or not there is anything for the second line to say.
describe('RosterName', () => {
  /** Matches a blank line exactly, which the default normaliser would trim. */
  const asWritten = { normalizer: getDefaultNormalizer({ trim: false, collapseWhitespace: false }) };

  test('puts the name and the detail on lines of their own', () => {
    render(<RosterName name="Acar Qinmenor" detail="Eliksir brygger" />);
    // Exact matches, so neither shares an element with the other.
    expect(screen.getByText('Acar Qinmenor')).toBeInTheDocument();
    expect(screen.getByText('Eliksir brygger')).toBeInTheDocument();
  });

  test('keeps the second line when there is no detail, so every row is as tall', () => {
    render(<RosterName name="Bare Rock" />);
    expect(screen.getByText(' ', asWritten)).toBeInTheDocument();
  });

  test('draws no blank line when there is a detail', () => {
    render(<RosterName name="Acar Qinmenor" detail="Eliksir brygger" />);
    expect(screen.queryByText(' ', asWritten)).not.toBeInTheDocument();
  });

  test('carries a badge beside the name', () => {
    render(<RosterName name="Dragon spotted" badge={<span>Unsaved</span>} />);
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });
});

// A location's rows nest: indent and a rail say so, and the rows inside it
// belong to the row without being part of its line.
describe('RosterRow depth', () => {
  const renderRow = (props: Partial<React.ComponentProps<typeof RosterRow>> = {}) =>
    render(
      <RosterRow
        entityId="p"
        entityName="Phandalin"
        gridClassName="grid-cols-2"
        toggleLabel="Phandalin"
        {...props}
      >
        <span>Phandalin</span>
      </RosterRow>
    );

  test('a top-level row has no indent', () => {
    renderRow();
    expect(screen.queryByTestId('roster-indent')).not.toBeInTheDocument();
  });

  test('indents a nested row 30px a level', () => {
    renderRow({ depth: 2 });
    expect(screen.getByTestId('roster-indent')).toHaveStyle({ width: '60px' });
  });

  test('stops indenting at four levels', () => {
    renderRow({ depth: 9 });
    expect(screen.getByTestId('roster-indent')).toHaveStyle({ width: '120px' });
  });

  test('renders the rows inside after its own expansion', () => {
    renderRow({
      expanded: true,
      expandedContent: <div>summary</div>,
      nested: <div>Stonehill Inn</div>,
    });
    expect(screen.getAllByText(/^(summary|Stonehill Inn)$/).map((el) => el.textContent)).toEqual([
      'summary',
      'Stonehill Inn',
    ]);
  });

  test('a selected row tints its own line, not the rows inside it', () => {
    renderRow({ selected: true, nested: <div>Stonehill Inn</div> });
    const line = screen.getByTestId('roster-row-line');
    expect(line).toHaveClass('roster-row-selected');
    expect(within(line).getByText('Phandalin')).toBeInTheDocument();
    expect(within(line).queryByText('Stonehill Inn')).not.toBeInTheDocument();
  });
});

