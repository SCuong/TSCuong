import { createTypeGenerator, type GenerateOptions, type GenerateResult } from './generate';

export interface TypegenRequest {
  text: string;
  options: GenerateOptions;
}

const generate = createTypeGenerator();

self.onmessage = (event: MessageEvent<TypegenRequest & { id: number }>) => {
  const { id, text, options } = event.data;
  let result: GenerateResult;
  try {
    result = generate(text, options);
  } catch {
    result = { ok: false, error: { message: 'The types could not be generated from this input.', line: 1, column: 1 } };
  }
  self.postMessage({ id, result });
};
