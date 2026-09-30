-- Kbeans — migrasi tabel auth & konfigurasi
--
-- Awalnya tabel users dan settings hanya dibuat lewat DDL runtime
-- (initUsersTable di functions/api/[[route]].ts). Eksekusi DDL dari dalam
-- request tidak selalu berhasil, dan kegagalannya ditelan oleh try/catch,
-- sehingga database bisa tetap tanpa tabel ini: login hanya berhasil lewat
-- fallback hardcoded, dan Panel Admin gagal menyimpan Server Key dengan
-- "Internal Server Error".
--
-- Jalankan sekali pada database D1 Kbeans:
--   npx wrangler d1 execute kbeans-db --remote --file=migration_auth_settings.sql
--
-- Semua pernyataan di sini idempotent, jadi aman dijalankan berulang kali.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  phone TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Disimpan konfigurasi Midtrans (Server Key, mode environment, acquirer QRIS).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO users (id, name, email, password, role, phone)
VALUES ('usr_admin', 'Administrator Kbeans', 'admin@kbeans.com', 'admin123', 'admin', '081234567890');

INSERT OR IGNORE INTO users (id, name, email, password, role, phone)
VALUES ('usr_demo_cust', 'Reynaldo Pelanggan', 'pelanggan@gmail.com', 'pelanggan123', 'customer', '089876543210');

-- Referensi transaksi payment gateway. `payment_provider` mencatat gateway mana
-- yang dipakai, `payment_external_id` adalah id transaksinya di gateway itu.
-- Dibuat generik (bukan per-gateway) supaya menukar gateway tidak butuh kolom
-- baru. Order lama yang sudah punya midtrans_order_id ikut ditandai supaya
-- statusnya tetap bisa dicek.
--
-- SQLite tidak punya "ADD COLUMN IF NOT EXISTS", jadi ketiga perintah di bawah
-- hanya dijalankan sekali pada database yang belum punya kolom-kolom ini.
ALTER TABLE orders ADD COLUMN payment_provider TEXT;
ALTER TABLE orders ADD COLUMN payment_external_id TEXT;

UPDATE orders
SET payment_provider = 'midtrans',
    payment_external_id = midtrans_order_id
WHERE midtrans_order_id IS NOT NULL
  AND midtrans_order_id != ''
  AND payment_provider IS NULL;

-- Kolom Midtrans lama tetap dipakai untuk kompatibilitas webhook dan proxy QR.
ALTER TABLE orders ADD COLUMN midtrans_qr_url TEXT;
