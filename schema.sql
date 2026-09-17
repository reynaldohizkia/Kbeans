-- ============================================================
-- schema.sql — Kbeans (Toko Biji Kopi)
-- Skema database Cloudflare D1 (berbasis SQLite)
-- Adaptasi dari studi kasus Eden Healthy Market untuk domain kopi
-- ============================================================

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon TEXT NOT NULL,
  description TEXT
);

CREATE TABLE coffee_attributes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  badge_color TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  price INTEGER NOT NULL,              -- Disimpan dalam Rupiah (misal: 65000)
  unit TEXT NOT NULL,                   -- Misal: '250 g', '500 g', '1 kg'
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL,
  origin TEXT NOT NULL,                 -- Asal biji kopi, misal: 'Toraja, Sulawesi Selatan'
  roast_level TEXT NOT NULL,            -- 'light' | 'medium' | 'dark'
  processing_method TEXT,               -- Misal: 'Full Wash', 'Natural', 'Honey'
  tasting_notes TEXT,                   -- Misal: 'Cokelat, karamel, sedikit asam jeruk'
  is_featured INTEGER DEFAULT 0,
  is_bundle INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_coffee_attributes (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES coffee_attributes(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, attribute_id)
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  fulfillment_type TEXT NOT NULL,       -- 'pickup' | 'delivery'
  pickup_time_slot TEXT,
  delivery_address TEXT,
  items_json TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL,
  payment_method TEXT NOT NULL,         -- 'qris', 'bca_va', 'mandiri_va', 'credit_card'
  payment_status TEXT NOT NULL DEFAULT 'pending',
  order_status TEXT NOT NULL DEFAULT 'processing',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
