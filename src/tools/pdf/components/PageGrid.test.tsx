import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CardButton, PageGrid, arrayMove, moveAnnouncement, type GridItem } from './PageGrid';

// Blank-page items (doc: null) render without pdf.js.
const make = (n: number): GridItem[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, doc: null, pageIndex: i, label: `Page ${i + 1}` }));

function Harness({ count = 4 }: { count?: number }) {
  const [items, setItems] = useState(() => make(count));
  return (
    <PageGrid
      items={items}
      ariaLabel="Pages"
      onMove={(from, to) => setItems((list) => arrayMove(list, from, to))}
      renderActions={(item) => (
        <CardButton label={`Delete ${item.label}`} onClick={() => setItems((list) => list.filter((it) => it.id !== item.id))}>
          x
        </CardButton>
      )}
      onCardKey={(event, item) => {
        if (event.key !== 'Delete') return false;
        setItems((list) => list.filter((it) => it.id !== item.id));
        return true;
      }}
    />
  );
}

const labels = () => screen.getAllByRole('button', { name: /^Page \d$/ }).map((b) => b.getAttribute('aria-label'));
const liveText = () => document.querySelector('[aria-live="polite"]')?.textContent ?? '';

describe('PageGrid reordering is announced', () => {
  it('announces keyboard moves (Alt+Arrow)', () => {
    render(<Harness />);
    const first = screen.getByRole('button', { name: 'Page 1' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight', altKey: true });
    expect(labels()).toEqual(['Page 2', 'Page 1', 'Page 3', 'Page 4']);
    expect(liveText()).toBe('Page 1 moved to position 2 of 4.');
  });

  it('announces moves made with the move buttons', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Page 4 earlier' }));
    expect(labels()).toEqual(['Page 1', 'Page 2', 'Page 4', 'Page 3']);
    expect(liveText()).toBe(moveAnnouncement('Page 4', 2, 4));
  });
});

describe('PageGrid keeps keyboard focus when the focused card is deleted', () => {
  it('moves focus to the nearest remaining card after Delete', async () => {
    render(<Harness />);
    const third = screen.getByRole('button', { name: 'Page 3' });
    third.focus();
    act(() => {
      fireEvent.keyDown(third, { key: 'Delete' });
    });
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Page 4'));
  });

  it('moves focus to the previous card when the last card is deleted with its button', async () => {
    render(<Harness count={2} />);
    const del = screen.getByRole('button', { name: 'Delete Page 2' });
    del.focus();
    fireEvent.click(del);
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Page 1'));
  });
});
