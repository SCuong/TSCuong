import { Barcode, Binary, Dices, Hash, Pilcrow, TableProperties } from 'lucide-react';
import type { ToolDefinition } from '../types';

export const generatorsTools: ToolDefinition[] = [
  {
    id: 'uuid-generator',
    name: 'UUID Generator',
    description: 'Generate random, time-based and name-based (v1, v3, v4, v5, v6, v7) UUIDs in bulk, and validate UUIDs to read their version, variant and timestamp.',
    category: 'generators',
    icon: Hash,
    route: 'generators/uuid-generator',
    keywords: [
      'uuid', 'guid', 'unique id', 'random id', 'uuidv4', 'uuidv7', 'uuidv1', 'uuidv6', 'uuidv5', 'uuidv3', 'uuid v4', 'uuid v7',
      'uuid v5', 'uuid v3', 'v4', 'v7', 'v5', 'namespace', 'name-based', 'deterministic', 'sha-1', 'md5',
      'rfc 9562', 'rfc 4122', 'nil uuid', 'max uuid', 'bulk', 'validate', 'validator', 'parse', 'decode', 'timestamp',
      'identifier', 'generate',
    ],
    aliases: [
      'guid generator', 'uuid v4 generator', 'uuid v7 generator', 'uuid v5 generator', 'name based uuid', 'deterministic uuid',
      'random uuid', 'generate guid', 'uuid validator', 'uuid decoder', 'uuid timestamp', 'check uuid', 'bulk uuid generator',
      'online guid',
    ],
    load: () => import('../generators/UuidGenerator'),
    requires: ['webCrypto'],
  },
  {
    id: 'ulid-nanoid',
    name: 'ULID & NanoID Generator',
    description: 'Generate sortable ULIDs (with monotonic mode) and NanoIDs with a custom alphabet, decode ULID timestamps and estimate collision risk.',
    category: 'generators',
    icon: Barcode,
    route: 'generators/ulid-nanoid',
    keywords: [
      'ulid', 'nanoid', 'nano id', 'short id', 'sortable id', 'monotonic', 'crockford', 'base32', 'collision', 'probability',
      'custom alphabet', 'unique id', 'random id', 'url safe id', 'decode ulid', 'birthday', 'cuid', 'ksuid',
    ],
    aliases: [
      'ulid generator', 'nanoid generator', 'ulid decoder', 'ulid to timestamp', 'nanoid collision calculator',
      'short unique id', 'ulid to uuid', 'generate nanoid',
    ],
    load: () => import('../generators/UlidNanoid'),
    requires: ['webCrypto'],
  },
  {
    id: 'lorem-ipsum',
    name: 'Lorem Ipsum Generator',
    description: 'Generate placeholder paragraphs, sentences, words or list items as plain text or HTML.',
    category: 'generators',
    icon: Pilcrow,
    route: 'generators/lorem-ipsum',
    keywords: [
      'lorem', 'ipsum', 'lorem ipsum', 'placeholder', 'dummy text', 'filler text', 'text', 'paragraphs', 'sentences', 'words',
      'list', 'html', 'latin', 'mockup', 'lipsum',
    ],
    aliases: ['dummy text generator', 'placeholder text', 'filler text generator', 'lipsum', 'fake text', 'lorem ipsum html'],
    load: () => import('../generators/LoremIpsum'),
  },
  {
    id: 'random-string',
    name: 'Random String & Bytes Generator',
    description: 'Create secure random strings from any character set, or random bytes as hex, Base64 or a byte array.',
    category: 'generators',
    icon: Binary,
    route: 'generators/random-string',
    keywords: [
      'random', 'string', 'random string', 'token', 'secret', 'key', 'api key', 'salt', 'nonce', 'bytes', 'random bytes',
      'hex', 'base64', 'base64url', 'base58', 'alphanumeric', 'charset', 'secure', 'crypto', 'entropy', 'password',
    ],
    aliases: [
      'random string generator', 'random token generator', 'generate secret key', 'random hex generator',
      'secure random bytes', 'random base64', 'generate api key', 'random characters',
    ],
    load: () => import('../generators/RandomString'),
    requires: ['webCrypto'],
  },
  {
    id: 'mock-data',
    name: 'Mock Data Generator',
    description: 'Design a field schema and generate up to 10,000 reproducible rows of fake data as JSON, CSV, SQL or NDJSON.',
    category: 'generators',
    icon: TableProperties,
    route: 'generators/mock-data',
    keywords: [
      'mock', 'fake', 'data', 'test data', 'dummy data', 'sample data', 'seed', 'fixtures', 'json', 'csv', 'sql', 'insert',
      'ndjson', 'names', 'emails', 'addresses', 'schema', 'faker', 'mockaroo', 'rows', 'dataset', 'generate',
    ],
    aliases: [
      'fake data generator', 'test data generator', 'dummy data generator', 'random json generator',
      'generate csv data', 'sql insert generator', 'faker online', 'mockaroo alternative',
    ],
    load: () => import('../generators/MockData'),
    layout: 'wide',
  },
  {
    id: 'random-picker',
    name: 'Random Number & List Picker',
    description: 'Unbiased random numbers in a range, pick winners from a list, shuffle, roll dice and flip coins.',
    category: 'generators',
    icon: Dices,
    route: 'generators/random-picker',
    keywords: [
      'random number generator', 'rng', 'raffle', 'picker', 'dice roller', 'coin flip', 'shuffle', 'random', 'number',
      'lottery', 'draw', 'winner', 'giveaway', 'dice', 'd20', '2d6', 'coin', 'heads', 'tails', 'randomize list', 'pick',
    ],
    aliases: [
      'random number', 'pick a random name', 'random name picker', 'giveaway picker', 'roll dice', 'flip a coin',
      'shuffle list', 'list randomizer', 'random winner', 'lottery number generator',
    ],
    load: () => import('../generators/RandomPicker'),
    requires: ['webCrypto'],
  },
];
