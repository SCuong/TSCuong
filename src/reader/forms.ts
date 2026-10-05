export type FormValue = string | string[] | boolean;
export interface PdfFormWidget {
  id: string; page: number; fieldName: string; fieldType: string;
  fieldValue?: FormValue; alternativeText?: string; readOnly?: boolean; password?: boolean;
  checkBox?: boolean; radioButton?: boolean; buttonValue?: string; exportValue?: string;
  multiLine?: boolean; multiSelect?: boolean; maxLen?: number;
  options?: { exportValue: string; displayValue: string }[];
}
export function supportedWidget(widget: PdfFormWidget) {
  return widget.fieldType === 'Tx' || widget.fieldType === 'Ch' && !!widget.options?.length || widget.fieldType === 'Btn' && !!(widget.checkBox || widget.radioButton);
}
export function widgetValue(widget: PdfFormWidget, value: FormValue | undefined): FormValue {
  const selected = value ?? widget.fieldValue ?? '';
  if (widget.checkBox) return typeof selected === 'boolean' ? selected : selected === widget.exportValue;
  if (widget.radioButton) return selected === widget.buttonValue;
  return selected;
}
