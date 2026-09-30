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
