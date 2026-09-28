/**
 * Unit definitions with exact (defined) conversion factors where they exist.
 * Linear units carry `factor` = size of one unit in the category's base unit.
 * Temperature (offsets) and fuel economy (reciprocal L/100 km) use explicit functions.
 */

export interface Unit {
  id: string;
  name: string;
  symbol: string;
  /** Extra search terms (plural names, spellings). */
  keywords?: string[];
  factor?: number;
  toBase?: (value: number) => number;
  fromBase?: (value: number) => number;
}

export interface UnitCategory {
  id: CategoryKey;
  name: string;
  /** Short note about the base unit or exactness shown under the table. */
  note?: string;
  units: Unit[];
  defaultFrom: string;
  defaultTo: string;
}

export type CategoryKey =
  | 'length'
  | 'mass'
  | 'area'
  | 'volume'
  | 'speed'
  | 'time'
  | 'temperature'
  | 'pressure'
  | 'energy'
  | 'power'
  | 'angle'
  | 'fuel'
  | 'data'
  | 'rate';

// Exact defined constants
const INCH = 0.0254;
const FOOT = 0.3048;
const YARD = 0.9144;
const MILE = 1609.344;
const NAUTICAL_MILE = 1852;
const POUND = 0.45359237;
const GRAVITY = 9.80665;
const POUND_FORCE = POUND * GRAVITY; // 4.4482216152605 N
const US_GALLON = 3.785411784; // litres
const IMP_GALLON = 4.54609; // litres
const CALORIE = 4.184; // thermochemical
const BTU = 1055.05585262; // International Table BTU
const FOOT_POUND = FOOT * POUND_FORCE;

const l = (id: string, name: string, symbol: string, factor: number, keywords?: string[]): Unit => ({
  id,
  name,
  symbol,
  factor,
  keywords,
});

export const UNIT_CATEGORIES: UnitCategory[] = [
  {
    id: 'length',
    name: 'Length',
    note: 'Base unit: metre. International inch/foot/yard/mile (1959) are exact.',
    defaultFrom: 'ft',
    defaultTo: 'm',
    units: [
      l('nm', 'Nanometre', 'nm', 1e-9, ['nanometer', 'nanometers']),
      l('um', 'Micrometre', 'µm', 1e-6, ['micrometer', 'micron', 'um']),
      l('mm', 'Millimetre', 'mm', 1e-3, ['millimeter', 'millimeters']),
      l('cm', 'Centimetre', 'cm', 1e-2, ['centimeter', 'centimeters']),
      l('m', 'Metre', 'm', 1, ['meter', 'meters', 'metres']),
      l('km', 'Kilometre', 'km', 1e3, ['kilometer', 'kilometers', 'kms']),
      l('in', 'Inch', 'in', INCH, ['inches', '"']),
      l('ft', 'Foot', 'ft', FOOT, ['feet', "'"]),
      l('yd', 'Yard', 'yd', YARD, ['yards']),
      l('mi', 'Mile', 'mi', MILE, ['miles', 'statute mile']),
      l('nmi', 'Nautical mile', 'nmi', NAUTICAL_MILE, ['nautical miles', 'nm']),
      l('mil', 'Mil (thou)', 'mil', INCH / 1000, ['thou', 'thousandth of an inch']),
      l('angstrom', 'Ångström', 'Å', 1e-10, ['angstrom']),
      l('au', 'Astronomical unit', 'au', 149_597_870_700, ['astronomical units']),
      l('ly', 'Light-year', 'ly', 9_460_730_472_580_800, ['light year', 'lightyear']),
      l('pc', 'Parsec', 'pc', 3.085677581491367e16, ['parsecs']),
    ],
  },
  {
    id: 'mass',
    name: 'Mass / weight',
    note: 'Base unit: kilogram. The international avoirdupois pound is exactly 0.45359237 kg.',
    defaultFrom: 'lb',
    defaultTo: 'kg',
    units: [
      l('ug', 'Microgram', 'µg', 1e-9, ['microgram', 'mcg', 'ug']),
      l('mg', 'Milligram', 'mg', 1e-6, ['milligram', 'milligrams']),
      l('g', 'Gram', 'g', 1e-3, ['grams', 'gramme']),
      l('kg', 'Kilogram', 'kg', 1, ['kilograms', 'kilo', 'kilos']),
      l('t', 'Tonne (metric ton)', 't', 1000, ['metric ton', 'tonnes', 'tons']),
      l('oz', 'Ounce', 'oz', POUND / 16, ['ounces', 'avoirdupois ounce']),
      l('lb', 'Pound', 'lb', POUND, ['pounds', 'lbs']),
      l('st', 'Stone', 'st', POUND * 14, ['stones']),
      l('ton-us', 'Short ton (US)', 'ton (US)', POUND * 2000, ['short ton', 'us ton']),
      l('ton-uk', 'Long ton (UK)', 'ton (UK)', POUND * 2240, ['long ton', 'imperial ton']),
      l('gr', 'Grain', 'gr', POUND / 7000, ['grains']),
      l('ozt', 'Troy ounce', 'oz t', 0.0311034768, ['troy ounce', 'gold']),
      l('ct', 'Carat', 'ct', 0.0002, ['carats', 'karat']),
    ],
  },
  {
    id: 'area',
    name: 'Area',
    note: 'Base unit: square metre.',
    defaultFrom: 'ft2',
    defaultTo: 'm2',
    units: [
      l('mm2', 'Square millimetre', 'mm²', 1e-6, ['sq mm', 'mm2']),
      l('cm2', 'Square centimetre', 'cm²', 1e-4, ['sq cm', 'cm2']),
      l('m2', 'Square metre', 'm²', 1, ['sq m', 'm2', 'square meter']),
      l('ha', 'Hectare', 'ha', 1e4, ['hectares']),
      l('km2', 'Square kilometre', 'km²', 1e6, ['sq km', 'km2', 'square kilometer']),
      l('in2', 'Square inch', 'in²', INCH * INCH, ['sq in', 'in2']),
      l('ft2', 'Square foot', 'ft²', FOOT * FOOT, ['sq ft', 'ft2', 'square feet']),
      l('yd2', 'Square yard', 'yd²', YARD * YARD, ['sq yd', 'yd2']),
      l('ac', 'Acre', 'ac', 4046.8564224, ['acres']),
      l('mi2', 'Square mile', 'mi²', MILE * MILE, ['sq mi', 'mi2']),
    ],
  },
  {
    id: 'volume',
    name: 'Volume',
    note: 'Base unit: litre. US gallon = 3.785411784 L, imperial gallon = 4.54609 L (both exact).',
    defaultFrom: 'gal-us',
    defaultTo: 'l',
    units: [
      l('ml', 'Millilitre', 'mL', 1e-3, ['milliliter', 'ml', 'cc']),
      l('cl', 'Centilitre', 'cL', 1e-2, ['centiliter']),
      l('l', 'Litre', 'L', 1, ['liter', 'liters', 'litres']),
      l('m3', 'Cubic metre', 'm³', 1000, ['cubic meter', 'm3']),
      l('cm3', 'Cubic centimetre', 'cm³', 1e-3, ['cubic centimeter', 'cm3', 'cc']),
      l('in3', 'Cubic inch', 'in³', INCH ** 3 * 1000, ['cubic inches', 'in3', 'cu in']),
      l('ft3', 'Cubic foot', 'ft³', FOOT ** 3 * 1000, ['cubic feet', 'ft3', 'cu ft']),
      l('yd3', 'Cubic yard', 'yd³', YARD ** 3 * 1000, ['cubic yards', 'yd3']),
      l('gal-us', 'Gallon (US)', 'gal (US)', US_GALLON, ['us gallon', 'gallons']),
      l('qt-us', 'Quart (US)', 'qt (US)', US_GALLON / 4, ['us quart', 'quarts']),
      l('pt-us', 'Pint (US)', 'pt (US)', US_GALLON / 8, ['us pint', 'pints']),
      l('cup-us', 'Cup (US)', 'cup', US_GALLON / 16, ['cups', 'us cup']),
      l('floz-us', 'Fluid ounce (US)', 'fl oz (US)', US_GALLON / 128, ['us fluid ounce', 'fl oz', 'floz']),
      l('tbsp', 'Tablespoon (US)', 'tbsp', US_GALLON / 256, ['tablespoon', 'tablespoons']),
      l('tsp', 'Teaspoon (US)', 'tsp', US_GALLON / 768, ['teaspoon', 'teaspoons']),
      l('gal-uk', 'Gallon (imperial)', 'gal (UK)', IMP_GALLON, ['imperial gallon', 'uk gallon']),
      l('qt-uk', 'Quart (imperial)', 'qt (UK)', IMP_GALLON / 4, ['imperial quart']),
      l('pt-uk', 'Pint (imperial)', 'pt (UK)', IMP_GALLON / 8, ['imperial pint', 'uk pint']),
      l('floz-uk', 'Fluid ounce (imperial)', 'fl oz (UK)', IMP_GALLON / 160, ['imperial fluid ounce']),
      l('bbl', 'Barrel (oil)', 'bbl', 158.987294928, ['oil barrel', 'barrels']),
    ],
  },
  {
    id: 'speed',
    name: 'Speed',
    note: 'Base unit: metre per second.',
    defaultFrom: 'mph',
    defaultTo: 'kmh',
    units: [
      l('mps', 'Metre per second', 'm/s', 1, ['meters per second', 'mps']),
      l('kmh', 'Kilometre per hour', 'km/h', 1000 / 3600, ['kph', 'kmh', 'kilometers per hour']),
      l('mph', 'Mile per hour', 'mph', MILE / 3600, ['miles per hour', 'mi/h']),
      l('kn', 'Knot', 'kn', NAUTICAL_MILE / 3600, ['knots', 'kt']),
      l('fps', 'Foot per second', 'ft/s', FOOT, ['feet per second', 'fps']),
      l('c', 'Speed of light', 'c', 299_792_458, ['light speed']),
    ],
  },
  {
    id: 'time',
    name: 'Time',
    note: 'Base unit: second. Month and year use the Gregorian average (365.2425 days).',
    defaultFrom: 'h',
    defaultTo: 'min',
    units: [
      l('ns', 'Nanosecond', 'ns', 1e-9, ['nanoseconds']),
      l('us', 'Microsecond', 'µs', 1e-6, ['microseconds', 'us']),
      l('ms', 'Millisecond', 'ms', 1e-3, ['milliseconds']),
      l('s', 'Second', 's', 1, ['seconds', 'sec', 'secs']),
      l('min', 'Minute', 'min', 60, ['minutes', 'mins']),
      l('h', 'Hour', 'h', 3600, ['hours', 'hr', 'hrs']),
      l('d', 'Day', 'd', 86_400, ['days']),
      l('wk', 'Week', 'wk', 604_800, ['weeks']),
      l('mo', 'Month (average)', 'mo', 2_629_746, ['months']),
      l('yr', 'Year (average)', 'yr', 31_556_952, ['years', 'gregorian year']),
      l('decade', 'Decade', 'dec', 315_569_520, ['decades']),
      l('century', 'Century', 'c.', 3_155_695_200, ['centuries']),
    ],
  },
  {
    id: 'temperature',
    name: 'Temperature',
    note: 'Offsets are applied exactly: K = °C + 273.15, °F = °C × 9/5 + 32, °R = K × 9/5.',
    defaultFrom: 'c',
    defaultTo: 'f',
    units: [
      { id: 'c', name: 'Celsius', symbol: '°C', keywords: ['centigrade', 'celcius', 'c'], toBase: (v) => v, fromBase: (v) => v },
      {
        id: 'f',
        name: 'Fahrenheit',
        symbol: '°F',
        keywords: ['farenheit', 'f'],
        toBase: (v) => ((v - 32) * 5) / 9,
        fromBase: (v) => (v * 9) / 5 + 32,
      },
      { id: 'k', name: 'Kelvin', symbol: 'K', keywords: ['kelvins', 'absolute'], toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
      {
        id: 'r',
        name: 'Rankine',
        symbol: '°R',
        keywords: ['rankine', 'ra'],
        toBase: (v) => ((v - 491.67) * 5) / 9,
        fromBase: (v) => ((v + 273.15) * 9) / 5,
      },
    ],
  },
  {
    id: 'pressure',
    name: 'Pressure',
    note: 'Base unit: pascal. psi is derived exactly from the pound-force and inch.',
    defaultFrom: 'psi',
    defaultTo: 'bar',
    units: [
      l('pa', 'Pascal', 'Pa', 1, ['pascals', 'n/m2']),
      l('hpa', 'Hectopascal', 'hPa', 100, ['hectopascals']),
      l('kpa', 'Kilopascal', 'kPa', 1e3, ['kilopascals']),
      l('mpa', 'Megapascal', 'MPa', 1e6, ['megapascals']),
      l('bar', 'Bar', 'bar', 1e5, ['bars']),
      l('mbar', 'Millibar', 'mbar', 100, ['millibars']),
      l('atm', 'Standard atmosphere', 'atm', 101_325, ['atmosphere', 'atmospheres']),
      l('psi', 'Pound per square inch', 'psi', POUND_FORCE / (INCH * INCH), ['lbf/in2', 'pounds per square inch']),
      l('torr', 'Torr', 'Torr', 101_325 / 760, ['torr']),
      l('mmhg', 'Millimetre of mercury', 'mmHg', 133.322387415, ['mm hg', 'mmhg']),
      l('inhg', 'Inch of mercury', 'inHg', 3386.388640341, ['in hg', 'inches of mercury']),
      l('at', 'Kilogram-force per cm²', 'kgf/cm²', GRAVITY * 1e4, ['technical atmosphere', 'at']),
    ],
  },
  {
    id: 'energy',
    name: 'Energy',
    note: 'Base unit: joule. Calorie = thermochemical (4.184 J); BTU = International Table.',
    defaultFrom: 'kwh',
    defaultTo: 'mj',
    units: [
      l('j', 'Joule', 'J', 1, ['joules']),
      l('kj', 'Kilojoule', 'kJ', 1e3, ['kilojoules']),
      l('mj', 'Megajoule', 'MJ', 1e6, ['megajoules']),
      l('gj', 'Gigajoule', 'GJ', 1e9, ['gigajoules']),
      l('wh', 'Watt-hour', 'Wh', 3600, ['watt hour']),
      l('kwh', 'Kilowatt-hour', 'kWh', 3.6e6, ['kilowatt hour', 'kwh']),
      l('cal', 'Calorie', 'cal', CALORIE, ['calories', 'small calorie']),
      l('kcal', 'Kilocalorie (food Calorie)', 'kcal', CALORIE * 1000, ['food calorie', 'kilocalories', 'Cal']),
      l('btu', 'British thermal unit', 'BTU', BTU, ['btus']),
      l('ftlb', 'Foot-pound', 'ft·lbf', FOOT_POUND, ['foot pound', 'ft lb', 'ft-lb']),
      l('ev', 'Electronvolt', 'eV', 1.602176634e-19, ['electron volt']),
      l('erg', 'Erg', 'erg', 1e-7, ['ergs']),
    ],
  },
  {
    id: 'power',
    name: 'Power',
    note: 'Base unit: watt. Mechanical horsepower = 550 ft·lbf/s; metric horsepower (PS) = 735.49875 W.',
    defaultFrom: 'hp',
    defaultTo: 'kw',
    units: [
      l('mw-milli', 'Milliwatt', 'mW', 1e-3, ['milliwatts']),
      l('w', 'Watt', 'W', 1, ['watts']),
      l('kw', 'Kilowatt', 'kW', 1e3, ['kilowatts']),
      l('mw', 'Megawatt', 'MW', 1e6, ['megawatts']),
      l('gw', 'Gigawatt', 'GW', 1e9, ['gigawatts']),
      l('hp', 'Horsepower (mechanical)', 'hp', 550 * FOOT_POUND, ['horsepower', 'bhp', 'imperial horsepower']),
      l('ps', 'Metric horsepower', 'PS', 735.49875, ['ps', 'cv', 'pferdestarke']),
      l('btuh', 'BTU per hour', 'BTU/h', BTU / 3600, ['btu/hr', 'btuh']),
      l('kcalh', 'Kilocalorie per hour', 'kcal/h', (CALORIE * 1000) / 3600, ['kcal per hour']),
      l('ftlbs', 'Foot-pound per second', 'ft·lbf/s', FOOT_POUND, ['ft lb/s']),
    ],
  },
  {
    id: 'angle',
    name: 'Angle',
    note: 'Base unit: radian.',
    defaultFrom: 'deg',
    defaultTo: 'rad',
    units: [
      l('deg', 'Degree', '°', Math.PI / 180, ['degrees', 'deg']),
      l('rad', 'Radian', 'rad', 1, ['radians']),
      l('grad', 'Gradian', 'gon', Math.PI / 200, ['gon', 'grads', 'gradians']),
      l('arcmin', 'Arcminute', '′', Math.PI / 10_800, ['minute of arc', 'arcminutes']),
      l('arcsec', 'Arcsecond', '″', Math.PI / 648_000, ['second of arc', 'arcseconds']),
      l('mrad', 'Milliradian', 'mrad', 1e-3, ['mil', 'milliradians']),
      l('turn', 'Turn', 'tr', 2 * Math.PI, ['revolution', 'turns', 'rotations']),
    ],
  },
  {
    id: 'fuel',
    name: 'Fuel economy',
    note: 'L/100 km is a consumption (lower is better) and converts reciprocally to distance-per-volume units.',
    defaultFrom: 'mpg-us',
    defaultTo: 'l100',
    units: [
      {
        id: 'l100',
        name: 'Litres per 100 km',
        symbol: 'L/100 km',
        keywords: ['l/100km', 'liters per 100 km', 'consumption'],
        toBase: (v) => 100 / v,
        fromBase: (v) => 100 / v,
      },
      l('kml', 'Kilometres per litre', 'km/L', 1, ['km/l', 'kilometers per liter']),
      l('mpg-us', 'Miles per gallon (US)', 'mpg (US)', MILE / 1000 / US_GALLON, ['mpg', 'miles per gallon']),
      l('mpg-uk', 'Miles per gallon (UK)', 'mpg (UK)', MILE / 1000 / IMP_GALLON, ['imperial mpg', 'mpg uk']),
      l('mil', 'Miles per litre', 'mi/L', MILE / 1000, ['miles per liter']),
    ],
  },
  {
    id: 'data',
    name: 'Data storage',
    note: 'SI prefixes are powers of 1000 (1 MB = 1,000,000 bytes); IEC prefixes are powers of 1024 (1 MiB = 1,048,576 bytes).',
    defaultFrom: 'gb',
    defaultTo: 'gib',
    units: [
      l('bit', 'Bit', 'bit', 1, ['bits', 'b']),
      l('kbit', 'Kilobit', 'kbit', 1e3, ['kilobits', 'kb']),
      l('mbit', 'Megabit', 'Mbit', 1e6, ['megabits', 'mb']),
      l('gbit', 'Gigabit', 'Gbit', 1e9, ['gigabits', 'gb']),
      l('byte', 'Byte', 'B', 8, ['bytes', 'octet']),
      l('kb', 'Kilobyte', 'kB', 8e3, ['kilobytes', 'kb']),
      l('mb', 'Megabyte', 'MB', 8e6, ['megabytes', 'mb']),
      l('gb', 'Gigabyte', 'GB', 8e9, ['gigabytes', 'gb']),
      l('tb', 'Terabyte', 'TB', 8e12, ['terabytes', 'tb']),
      l('pb', 'Petabyte', 'PB', 8e15, ['petabytes', 'pb']),
      l('kib', 'Kibibyte', 'KiB', 8 * 2 ** 10, ['kibibytes', 'kib']),
      l('mib', 'Mebibyte', 'MiB', 8 * 2 ** 20, ['mebibytes', 'mib']),
      l('gib', 'Gibibyte', 'GiB', 8 * 2 ** 30, ['gibibytes', 'gib']),
      l('tib', 'Tebibyte', 'TiB', 8 * 2 ** 40, ['tebibytes', 'tib']),
      l('pib', 'Pebibyte', 'PiB', 8 * 2 ** 50, ['pebibytes', 'pib']),
    ],
  },
  {
    id: 'rate',
    name: 'Data transfer rate',
    note: 'Network speeds are usually decimal bits per second (1 Mbit/s = 1,000,000 bit/s = 125,000 B/s).',
    defaultFrom: 'mbps',
    defaultTo: 'mbyteps',
    units: [
      l('bps', 'Bit per second', 'bit/s', 1, ['bps', 'bits per second']),
      l('kbps', 'Kilobit per second', 'kbit/s', 1e3, ['kbps', 'kilobits per second']),
      l('mbps', 'Megabit per second', 'Mbit/s', 1e6, ['mbps', 'megabits per second']),
      l('gbps', 'Gigabit per second', 'Gbit/s', 1e9, ['gbps', 'gigabits per second']),
      l('tbps', 'Terabit per second', 'Tbit/s', 1e12, ['tbps']),
      l('byteps', 'Byte per second', 'B/s', 8, ['bytes per second']),
      l('kbyteps', 'Kilobyte per second', 'kB/s', 8e3, ['kilobytes per second', 'kbps']),
      l('mbyteps', 'Megabyte per second', 'MB/s', 8e6, ['megabytes per second', 'mbps']),
      l('gbyteps', 'Gigabyte per second', 'GB/s', 8e9, ['gigabytes per second']),
      l('kibps', 'Kibibyte per second', 'KiB/s', 8 * 2 ** 10, ['kibibytes per second']),
      l('mibps', 'Mebibyte per second', 'MiB/s', 8 * 2 ** 20, ['mebibytes per second']),
      l('gibps', 'Gibibyte per second', 'GiB/s', 8 * 2 ** 30, ['gibibytes per second']),
    ],
  },
];

export function getCategory(id: string): UnitCategory | undefined {
  return UNIT_CATEGORIES.find((c) => c.id === id);
}

export function getUnit(category: UnitCategory, id: string): Unit | undefined {
  return category.units.find((u) => u.id === id);
}

export function toBase(unit: Unit, value: number): number {
  return unit.toBase ? unit.toBase(value) : value * unit.factor!;
}

export function fromBase(unit: Unit, value: number): number {
  return unit.fromBase ? unit.fromBase(value) : value / unit.factor!;
}

/** Convert `value` between two units of the same category. */
export function convert(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  // Same-kind linear units: a single ratio avoids an extra rounding step.
  if (from.factor !== undefined && to.factor !== undefined) return (value * from.factor) / to.factor;
  return fromBase(to, toBase(from, value));
}

/** Input problems specific to a category (e.g. below absolute zero). */
export function validateValue(category: UnitCategory, unit: Unit, value: number): { level: 'error' | 'warning'; message: string } | null {
  if (category.id === 'temperature') {
    const kelvin = convert(value, unit, getUnit(category, 'k')!);
    if (kelvin < -1e-9) return { level: 'warning', message: 'That temperature is below absolute zero (0 K), which is physically impossible.' };
  }
  if (category.id === 'fuel' && value < 0) return { level: 'error', message: 'Fuel economy cannot be negative.' };
  if (category.id === 'fuel' && value === 0) {
    return {
      level: 'warning',
      message:
        unit.id === 'l100'
          ? '0 L/100 km means no fuel is used, so distance per volume is infinite.'
          : 'Zero distance per volume means consumption per 100 km is infinite.',
    };
  }
  return null;
}

export interface UnitMatch {
  category: UnitCategory;
  unit: Unit;
  score: number;
}

/** Search units across all categories by name, symbol and keywords. */
export function searchUnits(query: string, limit = 12): UnitMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: UnitMatch[] = [];
  for (const category of UNIT_CATEGORIES) {
    for (const unit of category.units) {
      const name = unit.name.toLowerCase();
      const symbol = unit.symbol.toLowerCase();
      const keywords = (unit.keywords ?? []).map((k) => k.toLowerCase());
      let score = 0;
      if (symbol === q || unit.id === q) score = 100;
      else if (name === q || keywords.includes(q)) score = 90;
      else if (name.startsWith(q)) score = 70;
      else if (keywords.some((k) => k.startsWith(q))) score = 60;
      else if (name.includes(q)) score = 50;
      else if (keywords.some((k) => k.includes(q)) || symbol.includes(q)) score = 40;
      else if (category.name.toLowerCase().includes(q)) score = 10;
      if (score > 0) results.push({ category, unit, score });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
