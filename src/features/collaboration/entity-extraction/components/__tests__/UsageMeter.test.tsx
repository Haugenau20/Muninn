// src/features/collaboration/entity-extraction/components/__tests__/UsageMeter.test.tsx

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import UsageMeter from '../UsageMeter';

jest.mock('../../context/UsageContext', () => ({ useUsageContext: jest.fn() }));

const { useUsageContext } = require('../../context/UsageContext');

type Period = { count: number; limit: number };

/** The meter asks for usage on mount (T032, PERF-03). */
const mockRequestUsageStatus = jest.fn();

function setupUsage(
  periods: { daily?: Period; weekly?: Period; monthly?: Period } | null,
  extra: any = {},
  status: any = {},
  isLoadingUsage = false
) {
  (useUsageContext as jest.Mock).mockReturnValue({
    isLoadingUsage,
    requestUsageStatus: mockRequestUsageStatus,
    usageStatus: periods
      ? {
          usage: {
            daily: periods.daily ?? { count: 1, limit: 10 },
            weekly: periods.weekly ?? { count: 3, limit: 50 },
            monthly: periods.monthly ?? { count: 7, limit: 200 },
            isUnlimited: false,
            ...extra,
          },
          limitExceeded: false,
          nextReset: {
            daily: '2026-08-31T00:00:00.000Z',
            weekly: '2026-09-06T00:00:00.000Z',
            monthly: '2026-09-01T00:00:00.000Z',
          },
          ...status,
        }
      : null,
  });
}

/** The row element for a given period label. */
function row(label: string): HTMLElement {
  return screen.getByTestId(`usage-row-${label}`);
}

describe('UsageMeter', () => {
  beforeEach(() => jest.clearAllMocks());

  test('should label the meter', () => {
    setupUsage({});
    render(<UsageMeter />);
    expect(screen.getByText('Smart detection')).toBeInTheDocument();
  });

  test('asks for usage when it mounts, since nothing loads it until something shows it', () => {
    setupUsage(null);
    render(<UsageMeter />);
    expect(mockRequestUsageStatus).toHaveBeenCalledTimes(1);
  });

  describe('all three periods', () => {
    test('should show a row for today, this week and this month', () => {
      setupUsage({});
      render(<UsageMeter />);

      expect(row('daily')).toBeInTheDocument();
      expect(row('weekly')).toBeInTheDocument();
      expect(row('monthly')).toBeInTheDocument();

      expect(within(row('daily')).getByText('Today')).toBeInTheDocument();
      expect(within(row('weekly')).getByText('This week')).toBeInTheDocument();
      expect(within(row('monthly')).getByText('This month')).toBeInTheDocument();
    });

    test('should state each period count against its own limit', () => {
      setupUsage({
        daily: { count: 2, limit: 10 },
        weekly: { count: 9, limit: 50 },
        monthly: { count: 31, limit: 200 },
      });
      render(<UsageMeter />);

      expect(within(row('daily')).getByText('2 of 10')).toBeInTheDocument();
      expect(within(row('weekly')).getByText('9 of 50')).toBeInTheDocument();
      expect(within(row('monthly')).getByText('31 of 200')).toBeInTheDocument();
    });

    test('should expose each period as its own progressbar', () => {
      setupUsage({
        daily: { count: 2, limit: 10 },
        weekly: { count: 9, limit: 50 },
        monthly: { count: 31, limit: 200 },
      });
      render(<UsageMeter />);

      const bars = screen.getAllByRole('progressbar');
      expect(bars).toHaveLength(3);

      const daily = within(row('daily')).getByRole('progressbar');
      expect(daily).toHaveAttribute('aria-valuenow', '2');
      expect(daily).toHaveAttribute('aria-valuemax', '10');
    });

    test('should not exceed 100% fill when a count passes its limit', () => {
      setupUsage({ daily: { count: 25, limit: 10 } });
      render(<UsageMeter />);

      expect(within(row('daily')).getByTestId('usage-meter-fill')).toHaveStyle({
        width: '100%',
      });
    });
  });

  describe('the binding period', () => {
    test('should flag the period that is closest to its limit', () => {
      setupUsage({
        daily: { count: 9, limit: 10 }, // 90% -- the binding one
        weekly: { count: 9, limit: 50 }, // 18%
        monthly: { count: 31, limit: 200 }, // 15.5%
      });
      render(<UsageMeter />);

      expect(row('daily')).toHaveClass('feedback-warning');
      expect(row('weekly')).not.toHaveClass('feedback-warning');
      expect(row('monthly')).not.toHaveClass('feedback-warning');
    });

    test('should flag an exceeded period in the error tone instead', () => {
      setupUsage(
        { daily: { count: 10, limit: 10 } },
        {},
        { limitExceeded: true, exceededPeriod: 'daily' }
      );
      render(<UsageMeter />);

      expect(row('daily')).toHaveClass('feedback-error');
    });

    test('should name when the binding allowance resets', () => {
      setupUsage({ daily: { count: 9, limit: 10 } });
      render(<UsageMeter />);

      // "Today resets tomorrow" reads as a contradiction -- the footnote names
      // the ALLOWANCE, not the period whose row is highlighted.
      expect(screen.getByText(/^Daily allowance resets /)).toBeInTheDocument();
      expect(screen.queryByText(/^Today resets/)).not.toBeInTheDocument();
    });

    test('should name the weekly allowance when the week is binding', () => {
      setupUsage({
        daily: { count: 1, limit: 25 }, // 4%
        weekly: { count: 290, limit: 300 }, // 96% -- binding
        monthly: { count: 290, limit: 1000 }, // 29%
      });
      render(<UsageMeter />);

      expect(screen.getByText(/^Weekly allowance resets /)).toBeInTheDocument();
    });
  });

  describe('per-period reset on hover', () => {
    test('should give every row its own reset tooltip', () => {
      setupUsage({});
      render(<UsageMeter />);

      expect(row('daily')).toHaveAttribute(
        'title',
        expect.stringMatching(/^Daily allowance resets /) as unknown as string
      );
      expect(row('weekly').getAttribute('title')).toMatch(/^Weekly allowance resets /);
      expect(row('monthly').getAttribute('title')).toMatch(/^Monthly allowance resets /);
    });

    test('should not carry a tooltip when a reset time is unknown', () => {
      setupUsage({}, {}, { nextReset: { daily: '', weekly: '', monthly: '' } });
      render(<UsageMeter />);

      expect(row('daily')).not.toHaveAttribute('title');
    });
  });

  describe('a raised or lifted allowance', () => {
    test('shows the limit the server sends, a raised one included', () => {
      setupUsage({ daily: { count: 2, limit: 99 } });
      render(<UsageMeter />);
      expect(within(row('daily')).getByText('2 of 99')).toBeInTheDocument();
    });

    test('shows a limit of zero as zero, the limit the server enforces (AI-003)', () => {
      setupUsage({ daily: { count: 0, limit: 0 } });
      render(<UsageMeter />);
      expect(within(row('daily')).getByText('0 of 0')).toBeInTheDocument();
    });

    test('ignores a customLimit, which no longer means anything', () => {
      setupUsage({ daily: { count: 2, limit: 10 } }, { customLimit: 99 });
      render(<UsageMeter />);
      expect(within(row('daily')).getByText('2 of 10')).toBeInTheDocument();
    });

    test('says until when it applies, on the day the server ends it (UTC)', () => {
      // 23:59 UTC on 31 October is already 1 November in Copenhagen.
      setupUsage({}, { raisedUntil: '2099-10-31T23:59:59.999Z' });
      render(<UsageMeter />);
      expect(screen.getByText(/^Your allowance applies until 31 October 2099\.$/)).toBeInTheDocument();
    });

    test('says nothing of an end when the allowance has none', () => {
      setupUsage({});
      render(<UsageMeter />);
      expect(screen.queryByText(/applies until/)).not.toBeInTheDocument();
    });

    test('should say so when usage is unlimited, and show no rows', () => {
      setupUsage({}, { isUnlimited: true });
      render(<UsageMeter />);

      expect(screen.getByText('Unlimited scans')).toBeInTheDocument();
      expect(screen.queryByTestId('usage-row-daily')).not.toBeInTheDocument();
    });

    test('says until when an unlimited allowance applies', () => {
      setupUsage({}, { isUnlimited: true, raisedUntil: '2099-10-31T23:59:59.999Z' });
      render(<UsageMeter />);
      expect(screen.getByText('Unlimited scans until 31 October 2099')).toBeInTheDocument();
    });
  });

  describe('always present', () => {
    // The meter used to render nothing at all until usage data arrived, which
    // in practice meant it was invisible until the user's FIRST scan -- the
    // moment it is least useful to hide, since that is when someone is trying
    // to find out what their allowance is.

    test('should still name itself while usage is loading', () => {
      setupUsage(null, {}, {}, true);
      render(<UsageMeter />);

      expect(screen.getByText('Smart detection')).toBeInTheDocument();
      expect(screen.getByText(/checking your allowance/i)).toBeInTheDocument();
    });

    test('should still name itself when usage could not be fetched', () => {
      setupUsage(null);
      render(<UsageMeter />);

      expect(screen.getByText('Smart detection')).toBeInTheDocument();
      expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
    });

    test('should never invent limits it does not have', () => {
      setupUsage(null);
      render(<UsageMeter />);

      // No fabricated "0 of 10" -- an unknown allowance is stated as unknown.
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.queryByText(/ of /)).not.toBeInTheDocument();
    });

    test('should show every period at zero rather than hiding', () => {
      setupUsage({
        daily: { count: 0, limit: 10 },
        weekly: { count: 0, limit: 50 },
        monthly: { count: 0, limit: 200 },
      });
      render(<UsageMeter />);

      expect(within(row('daily')).getByText('0 of 10')).toBeInTheDocument();
      expect(within(row('weekly')).getByText('0 of 50')).toBeInTheDocument();
      expect(within(row('monthly')).getByText('0 of 200')).toBeInTheDocument();
    });
  });
});
