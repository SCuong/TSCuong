import { sqlLiteral } from './sqlBuild';

/** Deterministic PRNG (mulberry32) so the sample database is identical every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Ava', 'Liam', 'Mia', 'Noah', 'Sofia', 'Lucas', 'Chloé', 'Mateo', 'Hana', 'Oliver', 'Zoë', 'Ethan', 'Amara', 'Leo', 'Yuki', 'Isla', 'Kai', 'Nora', 'Arjun', 'Elena'];
const LAST = ['Nguyen', 'Smith', 'García', 'Müller', 'Kim', 'Rossi', 'Dubois', 'Tanaka', 'Silva', 'Novak', 'Johansson', 'Okafor', 'Patel', 'Cohen', 'Lopez'];
const COUNTRIES = ['US', 'DE', 'FR', 'VN', 'JP', 'GB', 'BR', 'IN', 'SE', 'NG', 'ES', 'IT'];
const PRODUCTS: Array<[string, string, number]> = [
  ['Mechanical Keyboard', 'Peripherals', 8900],
  ['Wireless Mouse', 'Peripherals', 2900],
  ['USB-C Hub (7-in-1)', 'Accessories', 4500],
  ['27" 4K Monitor', 'Displays', 32900],
  ['Laptop Stand', 'Accessories', 3900],
  ['Noise-cancelling Headphones', 'Audio', 19900],
  ['Webcam 1080p', 'Peripherals', 5900],
  ['Desk Lamp', 'Office', 2500],
  ['Ergonomic Chair', 'Office', 45900],
  ['Standing Desk', 'Office', 59900],
  ['Portable SSD 1 TB', 'Storage', 10900],
  ['microSD Card 256 GB', 'Storage', 2800],
  ['Bluetooth Speaker', 'Audio', 7900],
  ['Cable Organizer', 'Accessories', 1200],
  ['Graphics Tablet', 'Peripherals', 12900],
  ['Studio Microphone', 'Audio', 14900],
  ['Monitor Arm', 'Displays', 8900],
  ['Wrist Rest', 'Accessories', 1900],
  ['Smart Plug (2-pack)', 'Home', 2400],
  ['E-reader', 'Devices', 13900],
];
const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'delivered', 'delivered', 'cancelled', 'refunded'];

const LONG_DESCRIPTION =
  'Hot-swappable switches, per-key RGB lighting and a solid aluminium frame. Ships with a detachable braided USB-C cable, a keycap puller and two sets of keycaps.\nCompatible with Windows, macOS and Linux. Layout: ANSI US. Weight: 1.1 kg.';

function isoDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** SQL script that creates the sample store database (schema + data). */
export function buildSampleSql(): string {
  const r = rng(20240611);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const lines: string[] = [];
  lines.push(
    'PRAGMA foreign_keys = ON;',
    'PRAGMA user_version = 3;',
    `CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL DEFAULT 'US',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  marketing_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (marketing_opt_in IN (0, 1))
);`,
    `CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  thumbnail BLOB
);`,
    `CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  ordered_at TEXT NOT NULL,
  shipping_country TEXT,
  notes TEXT
);`,
    `CREATE TABLE order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
) WITHOUT ROWID;`,
  );

  const customerCount = 48;
  const base = Date.UTC(2023, 0, 1);
  const day = 86_400_000;
  const emails = new Set<string>();
  for (let id = 1; id <= customerCount; id++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    let email = `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@example.com';
    if (emails.has(email)) email = email.replace('@', `${id}@`);
    emails.add(email);
    lines.push(
      `INSERT INTO customers VALUES (${id}, ${sqlLiteral(`${first} ${last}`)}, ${sqlLiteral(email)}, ${sqlLiteral(pick(COUNTRIES))}, ${sqlLiteral(isoDate(base + Math.floor(r() * 400) * day + Math.floor(r() * day)))}, ${r() < 0.4 ? 1 : 0});`,
    );
  }

  PRODUCTS.forEach(([name, category, price], i) => {
    const id = i + 1;
    const sku = `${category.slice(0, 3).toUpperCase()}-${String(1000 + id * 7)}`;
    const thumb = i % 4 === 0 ? new Uint8Array(Array.from({ length: 24 + i }, (_, k) => (k < 8 ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][k] : Math.floor(r() * 256)))) : null;
    const description = i === 0 ? LONG_DESCRIPTION : i % 3 === 0 ? null : `${name} — ${category.toLowerCase()} essentials.`;
    lines.push(
      `INSERT INTO products VALUES (${id}, ${sqlLiteral(sku)}, ${sqlLiteral(name)}, ${sqlLiteral(category)}, ${price}, ${20 + Math.floor(r() * 180)}, ${sqlLiteral(description)}, ${sqlLiteral(thumb)});`,
    );
  });

  const notes = [null, null, null, 'Leave at the front desk', 'Gift wrap, please 🎁', 'Call before delivery', null, 'Invoice to company address'];
  for (let id = 1; id <= 320; id++) {
    const customer = 1 + Math.floor(r() * customerCount);
    const when = isoDate(base + 60 * day + Math.floor(r() * 540 * day));
    lines.push(
      `INSERT INTO orders (id, customer_id, status, ordered_at, shipping_country, notes) VALUES (${id}, ${customer}, ${sqlLiteral(pick(STATUSES))}, ${sqlLiteral(when)}, ${r() < 0.1 ? 'NULL' : sqlLiteral(pick(COUNTRIES))}, ${sqlLiteral(pick(notes))});`,
    );
    const itemCount = 1 + Math.floor(r() * 4);
    const used = new Set<number>();
    for (let k = 0; k < itemCount; k++) {
      const p = 1 + Math.floor(r() * PRODUCTS.length);
      if (used.has(p)) continue;
      used.add(p);
      lines.push(`INSERT INTO order_items VALUES (${id}, ${p}, ${1 + Math.floor(r() * 3)}, ${PRODUCTS[p - 1][2]});`);
    }
  }

  lines.push(
    'CREATE UNIQUE INDEX idx_products_sku ON products(sku);',
    'CREATE INDEX idx_orders_customer ON orders(customer_id);',
    'CREATE INDEX idx_orders_status_date ON orders(status, ordered_at);',
    'CREATE INDEX idx_order_items_product ON order_items(product_id);',
    `CREATE VIEW customer_order_totals AS
SELECT c.id AS customer_id,
       c.name,
       c.country,
       COUNT(DISTINCT o.id) AS orders,
       ROUND(COALESCE(SUM(oi.quantity * oi.unit_price_cents), 0) / 100.0, 2) AS total_spent
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.status NOT IN ('cancelled', 'refunded')
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY c.id;`,
    `CREATE TRIGGER trg_order_items_stock AFTER INSERT ON order_items
BEGIN
  UPDATE products SET stock = stock - NEW.quantity WHERE id = NEW.product_id;
END;`,
  );
  return lines.join('\n');
}

export const SAMPLE_QUERY = `-- Top customers by revenue (read-only query)
SELECT name, country, orders, total_spent
FROM customer_order_totals
WHERE orders > 0
ORDER BY total_spent DESC
LIMIT 10;`;
