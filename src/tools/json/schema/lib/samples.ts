export interface SchemaSample {
  id: string;
  label: string;
  schema: string;
  doc: string;
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export const SCHEMA_SAMPLES: SchemaSample[] = [
  {
    id: 'user',
    label: 'User profile',
    schema: pretty({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/user.schema.json',
      title: 'User',
      type: 'object',
      required: ['id', 'email', 'name', 'role', 'createdAt'],
      properties: {
        id: { type: 'integer', minimum: 1 },
        email: { type: 'string', format: 'email' },
        name: { type: 'string', minLength: 2, maxLength: 80 },
        role: { enum: ['admin', 'editor', 'viewer'] },
        age: { type: 'integer', minimum: 13 },
        website: { type: 'string', format: 'uri' },
        createdAt: { type: 'string', format: 'date-time' },
        tags: { type: 'array', items: { type: 'string', pattern: '^[a-z0-9-]+$' }, uniqueItems: true },
        address: { $ref: '#/$defs/address' },
      },
      additionalProperties: false,
      $defs: {
        address: {
          type: 'object',
          required: ['city', 'country'],
          properties: {
            street: { type: 'string' },
            city: { type: 'string' },
            country: { type: 'string', pattern: '^[A-Z]{2}$' },
          },
        },
      },
    }),
    doc: pretty({
      id: 42,
      email: 'ada.lovelace@',
      name: 'Ada Lovelace',
      role: 'owner',
      age: 12,
      createdAt: '2024-03-18T09:30:00Z',
      tags: ['math', 'Engines', 'math'],
      address: { city: 'London', country: 'uk' },
      nickname: 'Countess',
    }),
  },
  {
    id: 'order',
    label: 'Order (valid)',
    schema: pretty({
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Order',
      type: 'object',
      required: ['orderId', 'items', 'payment'],
      properties: {
        orderId: { type: 'string', pattern: '^ORD-[0-9]{6}$' },
        items: { type: 'array', minItems: 1, items: { $ref: '#/definitions/lineItem' } },
        payment: { oneOf: [{ $ref: '#/definitions/card' }, { $ref: '#/definitions/invoice' }] },
        coupon: { type: 'string' },
        discount: { type: 'number', exclusiveMinimum: 0, maximum: 50 },
      },
      dependencies: { discount: ['coupon'] },
      definitions: {
        lineItem: {
          type: 'object',
          required: ['sku', 'quantity', 'price'],
          properties: {
            sku: { type: 'string' },
            quantity: { type: 'integer', minimum: 1 },
            price: { type: 'number', multipleOf: 0.01 },
          },
        },
        card: {
          type: 'object',
          required: ['method', 'last4'],
          properties: { method: { const: 'card' }, last4: { type: 'string', pattern: '^[0-9]{4}$' } },
        },
        invoice: {
          type: 'object',
          required: ['method', 'dueDays'],
          properties: { method: { const: 'invoice' }, dueDays: { type: 'integer', enum: [15, 30, 60] } },
        },
      },
    }),
    doc: pretty({
      orderId: 'ORD-004217',
      items: [
        { sku: 'BOOK-1843', quantity: 1, price: 19.99 },
        { sku: 'PEN-07', quantity: 3, price: 2.5 },
      ],
      payment: { method: 'card', last4: '4242' },
      coupon: 'SPRING',
      discount: 10,
    }),
  },
  {
    id: 'config',
    label: 'Draft-04 config',
    schema: pretty({
      $schema: 'http://json-schema.org/draft-04/schema#',
      id: 'https://example.com/config.json',
      type: 'object',
      required: ['port', 'hosts'],
      properties: {
        port: { type: 'integer', minimum: 0, exclusiveMinimum: true, maximum: 65535 },
        hosts: { type: 'array', items: { type: 'string', format: 'hostname' }, minItems: 1 },
        timeouts: {
          type: 'object',
          patternProperties: { '^[a-z]+Ms$': { type: 'integer', minimum: 0 } },
          additionalProperties: false,
        },
        mode: { type: 'string', enum: ['dev', 'prod'] },
      },
    }),
    doc: pretty({
      port: 0,
      hosts: ['api.example.com', 'bad host!'],
      timeouts: { connectMs: 500, readMs: -1, retry: 3 },
      mode: 'prod',
    }),
  },
  {
    id: 'event',
    label: 'anyOf and if/then',
    schema: pretty({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['kind', 'location'],
      properties: {
        kind: { enum: ['online', 'venue'] },
        location: {
          anyOf: [
            { type: 'string', format: 'uri' },
            {
              type: 'object',
              required: ['lat', 'lng'],
              properties: {
                lat: { type: 'number', minimum: -90, maximum: 90 },
                lng: { type: 'number', minimum: -180, maximum: 180 },
              },
            },
          ],
        },
        slot: {
          type: 'array',
          prefixItems: [
            { type: 'string', format: 'date' },
            { type: 'string', format: 'time' },
          ],
          items: false,
        },
        ticketUrl: { type: 'string', format: 'uri' },
        price: { type: 'number', minimum: 0 },
      },
      if: { properties: { kind: { const: 'venue' } } },
      then: { required: ['price'] },
      dependentRequired: { price: ['ticketUrl'] },
    }),
    doc: pretty({
      kind: 'venue',
      location: { lat: 51.5, lng: 200 },
      slot: ['2024-06-01', '19:30:00Z', 'extra'],
      ticketUrl: 'tickets.example.com',
    }),
  },
];
