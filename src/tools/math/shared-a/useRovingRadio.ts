import { useRef, type KeyboardEvent } from 'react';

/**
 * Keyboard behaviour for a custom `role="radiogroup"` of buttons (the ARIA radio pattern, like the shared
 * Segmented control): only the checked option is in the tab order, and arrow keys, Home and End move the
 * selection and focus together.
 */
export function useRovingRadio<T>(values: readonly T[], value: T, onChange: (next: T) => void) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = values.indexOf(value);

  function onKeyDown(event: KeyboardEvent) {
    const last = values.length - 1;
    const from = Math.max(index, 0);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = from === last ? 0 : from + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = from === 0 ? last : from - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange(values[next]);
    refs.current[next]?.focus();
  }

  /** Props for the option at position `i`. */
  function optionProps(i: number) {
    return {
      ref: (el: HTMLButtonElement | null) => {
        refs.current[i] = el;
      },
      tabIndex: i === index || (index === -1 && i === 0) ? 0 : -1,
    };
  }

  return { onKeyDown, optionProps };
}
