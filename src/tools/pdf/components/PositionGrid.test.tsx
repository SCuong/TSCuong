import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PositionGrid } from './PositionGrid';

const OPTIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'].map((value) => ({
  value,
  label: value.replace('-', ' '),
}));

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('bottom-center');
  return <PositionGrid label="Position" value={value} onChange={setValue} options={OPTIONS} disabled={disabled} indicator={() => null} />;
}

const checked = () => screen.getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true')?.getAttribute('aria-label');

describe('PositionGrid', () => {
  it('has a single tab stop on the selected position', () => {
    render(<Harness />);
    const tabbable = screen.getAllByRole('radio').filter((r) => r.tabIndex === 0);
    expect(tabbable.map((r) => r.getAttribute('aria-label'))).toEqual(['bottom center']);
  });

  it('moves the selection with arrow keys in two dimensions without wrapping rows', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Position' });
    fireEvent.keyDown(group, { key: 'ArrowUp' });
    expect(checked()).toBe('top center');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(checked()).toBe('top right');
    fireEvent.keyDown(group, { key: 'ArrowRight' }); // end of the row: stays
    expect(checked()).toBe('top right');
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    expect(checked()).toBe('bottom right');
    fireEvent.keyDown(group, { key: 'Home' });
    expect(checked()).toBe('top left');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('top left');
  });

  it('ignores keys while disabled', () => {
    render(<Harness disabled />);
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowUp' });
    expect(checked()).toBe('bottom center');
  });
});
