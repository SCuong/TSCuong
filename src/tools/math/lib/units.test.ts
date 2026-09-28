import { describe, expect, it } from 'vitest';
import { UNIT_CATEGORIES, convert, getCategory, getUnit, searchUnits, validateValue, type CategoryKey } from './units';
import { formatNumber } from '../shared-a/format';

function c(category: CategoryKey, value: number, from: string, to: string): number {
  const cat = getCategory(category)!;
  const f = getUnit(cat, from);
  const t = getUnit(cat, to);
  if (!f || !t) throw new Error(`unknown unit ${from} or ${to} in ${category}`);
  return convert(value, f, t);
}
/** Formatted with 12 significant digits, the way the UI shows it (no float noise). */
const fmt = (category: CategoryKey, value: number, from: string, to: string) =>
  formatNumber(c(category, value, from, to), { grouping: false });

describe('unit definitions', () => {
  it('has unique ids, defaults that exist and valid factors', () => {
    const ids = new Set<string>();
    for (const cat of UNIT_CATEGORIES) {
      expect(ids.has(cat.id)).toBe(false);
      ids.add(cat.id);
      const unitIds = new Set(cat.units.map((u) => u.id));
      expect(unitIds.size).toBe(cat.units.length);
      expect(getUnit(cat, cat.defaultFrom)).toBeDefined();
      expect(getUnit(cat, cat.defaultTo)).toBeDefined();
      for (const u of cat.units) {
        if (u.factor !== undefined) expect(u.factor).toBeGreaterThan(0);
        else expect(u.toBase && u.fromBase).toBeTruthy();
      }
    }
    expect(UNIT_CATEGORIES.map((x) => x.id)).toEqual([
      'length',
      'mass',
      'area',
      'volume',
      'speed',
      'time',
      'temperature',
      'pressure',
      'energy',
      'power',
      'angle',
      'fuel',
      'data',
      'rate',
    ]);
  });

  it('round-trips every unit pair in every category', () => {
    for (const cat of UNIT_CATEGORIES) {
      for (const a of cat.units) {
        for (const b of cat.units) {
          const x = cat.id === 'fuel' ? 7.3 : 123.456;
          const back = convert(convert(x, a, b), b, a);
          expect(back).toBeCloseTo(x, 9);
        }
      }
    }
  });
});

describe('known conversions', () => {
  it('length', () => {
    expect(fmt('length', 1, 'yd', 'm')).toBe('0.9144');
    expect(fmt('length', 1, 'ft', 'm')).toBe('0.3048');
    expect(fmt('length', 1, 'in', 'cm')).toBe('2.54');
    expect(fmt('length', 1, 'mi', 'km')).toBe('1.609344');
    expect(fmt('length', 1, 'mi', 'ft')).toBe('5280');
    expect(fmt('length', 1, 'nmi', 'm')).toBe('1852');
    expect(fmt('length', 100, 'cm', 'in')).toBe('39.3700787402');
    expect(fmt('length', 1, 'ly', 'km')).toBe('9460730472580');
    expect(fmt('length', 1, 'm', 'nm')).toBe('1000000000');
  });

  it('mass', () => {
    expect(fmt('mass', 1, 'lb', 'kg')).toBe('0.45359237');
    expect(fmt('mass', 1, 'kg', 'lb')).toBe('2.20462262185');
    expect(fmt('mass', 1, 'lb', 'oz')).toBe('16');
    expect(fmt('mass', 1, 'st', 'lb')).toBe('14');
    expect(fmt('mass', 1, 'ton-us', 'lb')).toBe('2000');
    expect(fmt('mass', 1, 'ton-uk', 'kg')).toBe('1016.0469088');
    expect(fmt('mass', 1, 'ozt', 'g')).toBe('31.1034768');
    expect(fmt('mass', 5, 'ct', 'g')).toBe('1');
    expect(fmt('mass', 1, 't', 'kg')).toBe('1000');
  });

  it('area', () => {
    expect(fmt('area', 1, 'ac', 'm2')).toBe('4046.8564224');
    expect(fmt('area', 1, 'ac', 'ft2')).toBe('43560');
    expect(fmt('area', 1, 'mi2', 'ac')).toBe('640');
    expect(fmt('area', 1, 'ha', 'm2')).toBe('10000');
    expect(fmt('area', 1, 'ft2', 'in2')).toBe('144');
    expect(fmt('area', 1, 'km2', 'ha')).toBe('100');
  });

  it('volume', () => {
    expect(fmt('volume', 1, 'gal-us', 'l')).toBe('3.785411784');
    expect(fmt('volume', 1, 'gal-uk', 'l')).toBe('4.54609');
    expect(fmt('volume', 1, 'gal-us', 'in3')).toBe('231');
    expect(fmt('volume', 1, 'gal-us', 'floz-us')).toBe('128');
    expect(fmt('volume', 1, 'cup-us', 'tbsp')).toBe('16');
    expect(fmt('volume', 1, 'tbsp', 'tsp')).toBe('3');
    expect(fmt('volume', 1, 'gal-uk', 'floz-uk')).toBe('160');
    expect(fmt('volume', 1, 'm3', 'l')).toBe('1000');
    expect(fmt('volume', 1, 'bbl', 'gal-us')).toBe('42');
    expect(fmt('volume', 1, 'ft3', 'l')).toBe('28.316846592');
  });

  it('speed', () => {
    expect(fmt('speed', 100, 'kmh', 'mps')).toBe('27.7777777778');
    expect(fmt('speed', 60, 'mph', 'kmh')).toBe('96.56064');
    expect(fmt('speed', 1, 'kn', 'kmh')).toBe('1.852');
    expect(fmt('speed', 1, 'mps', 'kmh')).toBe('3.6');
    expect(fmt('speed', 1, 'c', 'kmh')).toBe('1079252848.8');
  });

  it('time', () => {
    expect(fmt('time', 1, 'h', 'min')).toBe('60');
    expect(fmt('time', 1, 'd', 's')).toBe('86400');
    expect(fmt('time', 1, 'wk', 'h')).toBe('168');
    expect(fmt('time', 1, 'yr', 'd')).toBe('365.2425');
    expect(fmt('time', 12, 'mo', 'yr')).toBe('1');
    expect(fmt('time', 1500, 'ms', 's')).toBe('1.5');
  });

  it('temperature (offsets)', () => {
    expect(fmt('temperature', -40, 'c', 'f')).toBe('-40');
    expect(fmt('temperature', -40, 'f', 'c')).toBe('-40');
    expect(fmt('temperature', 0, 'c', 'f')).toBe('32');
    expect(fmt('temperature', 100, 'c', 'f')).toBe('212');
    expect(fmt('temperature', 212, 'f', 'c')).toBe('100');
    expect(fmt('temperature', 0, 'k', 'c')).toBe('-273.15');
    expect(fmt('temperature', 0, 'k', 'f')).toBe('-459.67');
    expect(fmt('temperature', 0, 'k', 'r')).toBe('0');
    expect(fmt('temperature', 0, 'r', 'k')).toBe('0');
    expect(fmt('temperature', 0, 'c', 'k')).toBe('273.15');
    expect(fmt('temperature', 0, 'c', 'r')).toBe('491.67');
    expect(fmt('temperature', 98.6, 'f', 'c')).toBe('37');
    expect(fmt('temperature', 37, 'c', 'f')).toBe('98.6');
    expect(fmt('temperature', 300, 'k', 'r')).toBe('540');
    expect(fmt('temperature', 32, 'f', 'r')).toBe('491.67');
  });

  it('pressure', () => {
    expect(fmt('pressure', 1, 'atm', 'pa')).toBe('101325');
    expect(fmt('pressure', 1, 'atm', 'torr')).toBe('760');
    expect(fmt('pressure', 1, 'psi', 'pa')).toBe('6894.75729317');
    expect(fmt('pressure', 1, 'bar', 'psi')).toBe('14.503773773');
    expect(fmt('pressure', 1, 'bar', 'kpa')).toBe('100');
    expect(fmt('pressure', 1, 'atm', 'mmhg')).toBe('759.999891726');
    expect(fmt('pressure', 1013.25, 'hpa', 'atm')).toBe('1');
  });

  it('energy', () => {
    expect(fmt('energy', 1, 'kwh', 'mj')).toBe('3.6');
    expect(fmt('energy', 1, 'kcal', 'kj')).toBe('4.184');
    expect(fmt('energy', 1, 'btu', 'j')).toBe('1055.05585262');
    expect(fmt('energy', 1, 'wh', 'j')).toBe('3600');
    expect(fmt('energy', 1, 'ev', 'j')).toBe('1.602176634e-19');
    expect(fmt('energy', 1, 'j', 'erg')).toBe('10000000');
  });

  it('power', () => {
    expect(fmt('power', 1, 'hp', 'w')).toBe('745.699871582');
    expect(fmt('power', 1, 'ps', 'w')).toBe('735.49875');
    expect(fmt('power', 1, 'kw', 'hp')).toBe('1.3410220896');
    expect(fmt('power', 1, 'mw', 'kw')).toBe('1000');
  });

  it('angle', () => {
    expect(fmt('angle', 180, 'deg', 'rad')).toBe('3.14159265359');
    expect(fmt('angle', 90, 'deg', 'grad')).toBe('100');
    expect(fmt('angle', 1, 'turn', 'deg')).toBe('360');
    expect(fmt('angle', 1, 'deg', 'arcmin')).toBe('60');
    expect(fmt('angle', 1, 'arcmin', 'arcsec')).toBe('60');
  });

  it('fuel economy (reciprocal)', () => {
    expect(fmt('fuel', 10, 'l100', 'kml')).toBe('10');
    expect(fmt('fuel', 5, 'l100', 'kml')).toBe('20');
    expect(fmt('fuel', 30, 'mpg-us', 'l100')).toBe('7.84048611111');
    expect(fmt('fuel', 7.84048611111, 'l100', 'mpg-us')).toBe('30');
    expect(fmt('fuel', 1, 'mpg-us', 'kml')).toBe('0.42514370743');
    expect(fmt('fuel', 1, 'mpg-uk', 'mpg-us')).toBe('0.832674184629');
    expect(fmt('fuel', 1, 'mpg-us', 'mpg-uk')).toBe('1.2009499255');
    expect(fmt('fuel', 10, 'kml', 'l100')).toBe('10');
    expect(c('fuel', 0, 'l100', 'kml')).toBe(Infinity);
    expect(c('fuel', 0, 'l100', 'mpg-us')).toBe(Infinity);
    expect(c('fuel', 0, 'kml', 'l100')).toBe(Infinity);
  });

  it('data storage (SI and IEC)', () => {
    expect(fmt('data', 1, 'kib', 'byte')).toBe('1024');
    expect(fmt('data', 1, 'mib', 'byte')).toBe('1048576');
    expect(fmt('data', 1, 'kb', 'byte')).toBe('1000');
    expect(fmt('data', 1, 'byte', 'bit')).toBe('8');
    expect(fmt('data', 1, 'gb', 'mb')).toBe('1000');
    expect(fmt('data', 1000, 'kb', 'mb')).toBe('1');
    expect(fmt('data', 1, 'gb', 'gib')).toBe('0.931322574615');
    expect(fmt('data', 1, 'tb', 'tib')).toBe('0.909494701773');
    expect(fmt('data', 1, 'pib', 'byte')).toBe('1.12589990684e15');
    expect(c('data', 1, 'pib', 'byte')).toBe(2 ** 50);
    expect(fmt('data', 1, 'mbit', 'kb')).toBe('125');
  });

  it('data transfer rate', () => {
    expect(fmt('rate', 100, 'mbps', 'mbyteps')).toBe('12.5');
    expect(fmt('rate', 1, 'gbps', 'mbyteps')).toBe('125');
    expect(fmt('rate', 1, 'gbps', 'mibps')).toBe('119.209289551');
    expect(fmt('rate', 1, 'mibps', 'kibps')).toBe('1024');
    expect(fmt('rate', 1, 'byteps', 'bps')).toBe('8');
  });
});

describe('validation and search', () => {
  it('warns below absolute zero and on invalid fuel values', () => {
    const t = getCategory('temperature')!;
    expect(validateValue(t, getUnit(t, 'k')!, -1)?.level).toBe('warning');
    expect(validateValue(t, getUnit(t, 'c')!, -273.15)).toBeNull();
    expect(validateValue(t, getUnit(t, 'c')!, -300)?.message).toMatch(/absolute zero/);
    expect(validateValue(t, getUnit(t, 'f')!, -459.67)).toBeNull();
    const f = getCategory('fuel')!;
    expect(validateValue(f, getUnit(f, 'kml')!, -1)?.level).toBe('error');
    expect(validateValue(f, getUnit(f, 'l100')!, 0)?.level).toBe('warning');
    expect(validateValue(getCategory('length')!, getUnit(getCategory('length')!, 'm')!, -5)).toBeNull();
  });

  it('finds units across categories', () => {
    expect(searchUnits('')).toEqual([]);
    expect(searchUnits('ft')[0].unit.id).toBe('ft');
    expect(searchUnits('feet')[0].unit.id).toBe('ft');
    expect(searchUnits('fahrenheit')[0].category.id).toBe('temperature');
    expect(searchUnits('farenheit')[0].unit.id).toBe('f');
    expect(searchUnits('mib').some((m) => m.category.id === 'data')).toBe(true);
    expect(searchUnits('gallon').length).toBeGreaterThanOrEqual(2);
    expect(searchUnits('zzzz')).toEqual([]);
    expect(searchUnits('psi')[0].unit.id).toBe('psi');
  });
});
