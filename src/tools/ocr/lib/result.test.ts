import { describe, expect, it } from 'vitest';
import { cleanText, confidenceLevel, flattenBlocks, meanConfidence } from './result';

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

describe('flattenBlocks', () => {
  it('flattens blocks → paragraphs → lines → words and drops empty words', () => {
    const lines = flattenBlocks([
      {
        paragraphs: [
          {
            lines: [
              {
                text: 'Hello world\n',
                confidence: 91,
                bbox: box(0, 0, 100, 20),
                words: [
                  { text: 'Hello', confidence: 95, bbox: box(0, 0, 40, 20) },
                  { text: ' ', confidence: 10, bbox: box(40, 0, 45, 20) },
                  { text: 'world', confidence: 87, bbox: box(50, 0, 100, 20) },
                ],
              },
              { text: '', bbox: box(0, 30, 10, 40), words: [] },
            ],
          },
        ],
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('Hello world');
    expect(lines[0].words.map((w) => w.text)).toEqual(['Hello', 'world']);
    expect(lines[0].confidence).toBe(91);
  });

  it('handles missing structures', () => {
    expect(flattenBlocks(null)).toEqual([]);
    expect(flattenBlocks([{}])).toEqual([]);
    expect(flattenBlocks([{ paragraphs: [{}] }])).toEqual([]);
  });

  it('keeps Unicode text', () => {
    const lines = flattenBlocks([
      { paragraphs: [{ lines: [{ bbox: box(0, 0, 1, 1), words: [{ text: 'naïve café 🎉', confidence: 50, bbox: box(0, 0, 1, 1) }] }] }] },
    ]);
    expect(lines[0].text).toBe('naïve café 🎉');
    expect(lines[0].confidence).toBe(50);
  });
});

describe('confidence helpers', () => {
  it('averages and classifies', () => {
    expect(meanConfidence([])).toBe(0);
    expect(meanConfidence([{ confidence: 80 }, { confidence: 90 }])).toBe(85);
    expect(meanConfidence([{ confidence: Number.NaN }, { confidence: 90 }])).toBe(45);
    expect(confidenceLevel(92)).toBe('high');
    expect(confidenceLevel(70)).toBe('medium');
    expect(confidenceLevel(20)).toBe('low');
  });
});

describe('cleanText', () => {
  it('trims trailing spaces and collapses blank lines', () => {
    expect(cleanText('a  \n\n\n\nb\t\n')).toBe('a\n\nb');
    expect(cleanText('')).toBe('');
  });
});
