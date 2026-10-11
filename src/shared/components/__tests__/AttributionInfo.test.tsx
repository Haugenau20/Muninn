// src/shared/components/__tests__/AttributionInfo.test.tsx
//
// Who added a record and who last changed it, and when. T132 (maintainer,
// 2026-10-08): names are the authors' current ones, from the group's members,
// and the server's times win over the client-written strings. Rewritten from
// the version that tested a per-uid username fetch, which the member
// directory replaced; the creator, modifier and same-event rules carry over.
import React from 'react';
import { render, screen } from '@testing-library/react';
import AttributionInfo from '../AttributionInfo';

let mockDirectory: Map<string, { username?: string; characters?: Array<{ id: string; name: string }> }> | undefined;
jest.mock('../../hooks/useMemberDirectory', () => ({
  __esModule: true,
  useMemberDirectory: () => mockDirectory,
  default: () => mockDirectory,
}));

const at = (iso: string) => ({ toDate: () => new Date(iso) });

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    createdBy: 'uid-1',
    createdByUsername: 'Wren',
    dateAdded: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('AttributionInfo', () => {
  beforeEach(() => {
    mockDirectory = new Map([
      ['uid-1', { username: 'Wren', characters: [{ id: 'c-1', name: 'Ilse the Bold' }] }],
      ['uid-2', { username: 'Corvin' }],
    ]);
  });

  test('renders nothing when nothing names an author', () => {
    const { container } = render(<AttributionInfo item={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('says who added it and on which day', () => {
    render(<AttributionInfo item={makeItem()} />);
    expect(screen.getByText('Added by Wren on 15/01/2024')).toBeInTheDocument();
  });

  test('names the character it was written as, by the name it has now', () => {
    render(<AttributionInfo item={makeItem({ createdByCharacterId: 'c-1', createdByCharacterName: 'Ilse Varn' })} />);
    expect(screen.getByText(/Added by Ilse the Bold/)).toBeInTheDocument();
  });

  test('names a member by their username now, not the one stored', () => {
    render(<AttributionInfo item={makeItem({ createdBy: 'uid-2', createdByUsername: 'Old Name' })} />);
    expect(screen.getByText(/Added by Corvin/)).toBeInTheDocument();
  });

  test('credits someone who has left by the name stored with the record', () => {
    render(<AttributionInfo item={makeItem({ createdBy: 'uid-left', createdByUsername: 'Mara' })} />);
    expect(screen.getByText(/Added by Mara/)).toBeInTheDocument();
  });

  test("takes the server's time over the client-written one", () => {
    render(<AttributionInfo item={makeItem({ createdAt: at('2024-03-02T09:00:00.000Z') })} />);
    expect(screen.getByText('Added by Wren on 02/03/2024')).toBeInTheDocument();
  });

  test('says who changed it when someone else did', () => {
    render(
      <AttributionInfo
        item={makeItem({ modifiedBy: 'uid-2', modifiedByUsername: 'Corvin', dateModified: '2024-02-01T10:00:00.000Z' })}
      />
    );
    expect(screen.getByText('Modified by Corvin on 01/02/2024')).toBeInTheDocument();
  });

  test('says nothing of a change when the record has none', () => {
    render(<AttributionInfo item={makeItem()} />);
    expect(screen.queryByText(/Modified by/)).not.toBeInTheDocument();
  });

  test('treats the same author within a second of creating it as one event', () => {
    render(
      <AttributionInfo
        item={makeItem({ modifiedBy: 'uid-1', modifiedByUsername: 'Wren', dateModified: '2024-01-15T10:00:00.500Z' })}
      />
    );
    expect(screen.queryByText(/Modified by/)).not.toBeInTheDocument();
  });

  // Nothing is written beside a server time any more (T132): a write still
  // on its way reads as now, when the server is about to stamp it.
  test('reads a server time still pending as today', () => {
    render(<AttributionInfo item={makeItem({ createdAt: { isEqual: () => false } })} />);
    expect(screen.getByText(`Added by Wren on ${new Date().toLocaleDateString('en-uk')}`)).toBeInTheDocument();
  });
});
