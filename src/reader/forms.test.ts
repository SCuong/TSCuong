import { describe, expect, it } from 'vitest';
import { supportedWidget, widgetValue, type PdfFormWidget } from './forms';
const widget: PdfFormWidget = { id: 'field', fieldName: 'Choice', page: 1, fieldType: 'Btn' };
describe('PDF form values', () => {
  it('maps existing and edited checkbox export values without treating Off as true', () => {
    const checkbox = { ...widget, checkBox: true, exportValue: 'Yes', fieldValue: 'Off' };
    expect(widgetValue(checkbox, undefined)).toBe(false);
    expect(widgetValue(checkbox, 'Yes')).toBe(true);
    expect(widgetValue(checkbox, false)).toBe(false);
    expect(widgetValue(checkbox, true)).toBe(true);
  });
  it('updates each radio widget according to its own button value', () => {
    const radio = { ...widget, radioButton: true, buttonValue: 'A' };
    expect(widgetValue(radio, 'A')).toBe(true);
    expect(widgetValue(radio, 'B')).toBe(false);
  });
  it('preserves multi-select values and excludes signature/action widgets', () => {
    expect(widgetValue({ ...widget, fieldType: 'Ch' }, ['A', 'B'])).toEqual(['A', 'B']);
    expect(supportedWidget(widget)).toBe(false);
    expect(supportedWidget({ ...widget, fieldType: 'Sig' })).toBe(false);
    expect(supportedWidget({ ...widget, fieldType: 'Tx' })).toBe(true);
  });
});
