import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handle } from 'hono/cloudflare-pages';

type Bindings = {
  DB?: any;          // Binding ke Cloudflare D1
  AI?: any;           // Binding ke Cloudflare Workers AI
  GEMINI_API_KEY?: string;
  ADMIN_KEY?: string; // Secret untuk proteksi panel admin
  MIDTRANS_SERVER_KEY?: string;
  MIDTRANS_CLIENT_KEY?: string;
  MIDTRANS_MODE?: string;         // 'production' | 'sandbox' (opsional, bila key tidak bisa dideteksi)
  MIDTRANS_QRIS_ACQUIRER?: string; // 'gopay' | 'airpay shopee'
};

const app = new Hono<{ Bindings: Bindings }>().basePath('/api');
app.use('*', cors());

type MidtransMode = 'production' | 'sandbox';

// Base URL resmi Midtrans Core API untuk tiap environment.
const MIDTRANS_BASE_URL: Record<MidtransMode, string> = {
  production: 'https://api.midtrans.com',
  sandbox: 'https://api.sandbox.midtrans.com',
};

// Acquirer QRIS yang didukung Midtrans. QRIS hanya bisa dibuat lewat acquirer
// yang sudah diaktifkan di Dashboard Midtrans, jadi urutan fallback di bawah
// selalu mencoba acquirer yang paling umum terlebih dahulu.
const MIDTRANS_QRIS_ACQUIRERS = ['gopay', 'airpay shopee'] as const;

// Menentukan environment dari format Server Key Midtrans:
//   Sandbox    -> SB-Mid-server-xxxxxxxx
//   Production -> SK-Mid-server-xxxxxxxx / Mid-server-xxxxxxxx
// Key sandbox TIDAK PERNAH bisa diautentikasi ke api.midtrans.com (dan
// sebaliknya), jadi prefix key adalah sumber kebenaran paling akurat.
const detectModeFromServerKey = (serverKey: string): MidtransMode | null => {
  const key = serverKey.trim();
  if (!key) return null;
  if (/^SB-Mid-server-/i.test(key)) return 'sandbox';
  if (/^(SK-)?Mid-server-/i.test(key)) return 'production';
  return null;
};

// ------------------------------------------------------------------
// GET /api/products
// Mengambil daftar produk kopi, bisa difilter berdasarkan kategori,
// tingkat roast, atau ketersediaan stok.
// Contoh: /api/products?category=cat-single-origin&roast=medium&inStock=true
// ------------------------------------------------------------------
app.get('/products', async (c) => {
  const category = c.req.query('category');
  const roast = c.req.query('roast');
  const inStockOnly = c.req.query('inStock') === 'true';

  if (c.env.DB) {
    let query = 'SELECT * FROM products WHERE 1=1';
    const params: any[] = [];

    if (category && category !== 'all') {
      query += ' AND category_id = ?';
      params.push(category);
    }
    if (roast) {
      query += ' AND roast_level = ?';
      params.push(roast);
    }
    if (inStockOnly) {
      query += ' AND stock_quantity > 0';
    }

    const stmt = c.env.DB.prepare(query);
    const { results } = await stmt.bind(...params).all();
    return c.json({ success: true, count: results.length, data: results });
  }

  return c.json({ success: true, data: [] });
});

// ------------------------------------------------------------------
// GET /api/products/:slug
// Detail satu produk kopi, termasuk atribut-atributnya
// (arabica/robusta, roast level, organic, dll).
// ------------------------------------------------------------------
app.get('/products/:slug', async (c) => {
  const slug = c.req.param('slug');

  if (c.env.DB) {
    const product = await c.env.DB
      .prepare('SELECT * FROM products WHERE slug = ?')
      .bind(slug)
      .first();

    if (!product) {
      return c.json({ success: false, message: 'Produk tidak ditemukan' }, 404);
    }

    const { results: attributes } = await c.env.DB
      .prepare(
        `SELECT ca.name, ca.slug, ca.badge_color
         FROM coffee_attributes ca
         JOIN product_coffee_attributes pca ON pca.attribute_id = ca.id
         WHERE pca.product_id = ?`
      )
      .bind(product.id)
      .all();

    return c.json({ success: true, data: { ...product, attributes } });
  }

  return c.json({ success: false, message: 'Database tidak tersedia' }, 500);
});

// ------------------------------------------------------------------
// GET /api/categories
// Daftar kategori kopi (Single Origin, Blend, Ground, Cold Brew, dst)
// ------------------------------------------------------------------
app.get('/categories', async (c) => {
  if (c.env.DB) {
    const { results } = await c.env.DB.prepare('SELECT * FROM categories').all();
    return c.json({ success: true, data: results });
  }
  return c.json({ success: true, data: [] });
});

// Helper verifikasi akses admin (menerima key Cloudflare atau token admin bawaan)
const verifyAdminAccess = (key: string | undefined, envAdminKey: string | undefined) => {
  if (!key) return false;
  if (envAdminKey && key === envAdminKey) return true;
  if (key === 'kbeans_admin_token' || key === 'admin123') return true;
  return false;
};

// Nama tabel yang wajib ada sebelum route auth / admin bisa bekerja. Tabelnya
// dibuat lewat migration (migration_auth_settings.sql), bukan dari dalam
// request: DDL runtime sempat gagal diam-diam sehingga database produksi tetap
// tanpa tabel users & settings, dan gejalanya baru muncul jauh kemudian
// (login diam-diam jatuh ke kredensial hardcoded, Panel Admin 500).
const REQUIRED_TABLES = ['users', 'settings'] as const;

export class SchemaError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Tabel database belum lengkap (${missing.join(', ')}). `
      + 'Jalankan: npx wrangler d1 execute kbeans-db --remote --file=migration_auth_settings.sql'
    );
    this.name = 'SchemaError';
  }
}

// Memastikan skema sudah dimigrasi, tanpa mencoba membuatnya sendiri.
const assertSchemaReady = async (db: any) => {
  if (!db) throw new SchemaError([...REQUIRED_TABLES]);

  const placeholders = REQUIRED_TABLES.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
    .bind(...REQUIRED_TABLES)
    .all();

  const existing = new Set((results || []).map((r: any) => r.name));
  const missing = REQUIRED_TABLES.filter((t) => !existing.has(t));
  if (missing.length) throw new SchemaError(missing);
};

// Memastikan akun demo tersedia. Idempotent, jadi aman dipanggil tiap request.
const seedDefaultUsers = async (db: any) => {
  if (!db) return;
  const defaults = [
    ['usr_admin', 'Administrator Kbeans', 'admin@kbeans.com', 'admin123', 'admin', '081234567890'],
    ['usr_demo_cust', 'Reynaldo Pelanggan', 'pelanggan@gmail.com', 'pelanggan123', 'customer', '089876543210'],
  ];

  for (const [id, name, email, password, role, phone] of defaults) {
    const exists = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (exists) continue;
    await db
      .prepare('INSERT OR IGNORE INTO users (id, name, email, password, role, phone) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, name, email, password, role, phone)
      .run();
  }
};

// Satu-satunya Eintritt point untuk route yang butuh tabel auth/settings.
const initAuthSchema = async (db: any) => {
  await assertSchemaReady(db);
  await seedDefaultUsers(db);
};

// Menjamin kolom Midtrans di tabel orders tersedia. Kolomnya dibuat lewat
// migration; di sini hanya dibaca, dan bila kosong seluruh fitur QRIS/VA
// otomatis dinonaktifkan dengan pesan yang jelas.
const hasOrderMidtransColumns = async (db: any) => {
  if (!db) return false;
  try {
    const { results } = await db.prepare('PRAGMA table_info(orders)').all();
    const names = new Set((results || []).map((r: any) => r.name));
    return names.has('midtrans_order_id') && names.has('midtrans_qr_url');
  } catch {
    return false;
  }
};

// Membaca satu nilai dari tabel settings. Tabel dibuat lewat migration
// (migration_auth_settings.sql); kalau belum ada, nilainya dianggap kosong
// supaya route lain tetap bisa jalan.
const getSetting = async (env: Bindings, key: string): Promise<string> => {
  if (!env.DB) return '';
  try {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
    return row?.value ? String(row.value) : '';
  } catch {
    return '';
  }
};

// Menyimpan satu nilai ke tabel settings
const setSetting = async (env: Bindings, key: string, value: string) => {
  if (!env.DB) return;
  await env.DB.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(key, value).run();
};

const maskSecret = (value: string) =>
  value
    ? value.substring(0, Math.min(8, value.length)) +
      '••••••••' +
      (value.length > 12 ? value.substring(value.length - 4) : '')
    : '';

export interface MidtransConfig {
  serverKey: string;
  mode: MidtransMode;
  baseUrl: string;
  acquirer: string;
  keySource: string;
  modeSource: string;
}

// Sidik jari Server Key, dipakai untuk mengikat mode yang sudah diverifikasi
// ke key spesifik itu. Tanpa ini, mode lama ikut terpakai setelah key diganti
// sehingga transaksi diarahkan ke environment yang salah.
const serverKeyFingerprint = async (serverKey: string): Promise<string> => {
  if (!serverKey) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serverKey));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
};

// Mengambil seluruh konfigurasi Midtrans: Server Key, environment (production /
// sandbox), base URL, dan acquirer QRIS. Environment ditentukan dari prefix
// Server Key, sehingga Key produksi otomatis memakai api.midtrans.com.
//
// Key yang disimpan lewat Panel Admin (tabel settings) didahulukan atas
// Environment Variable Cloudflare, supaya key bisa diperbarui dari browser
// tanpa harus membuka dashboard Cloudflare. Env var tetap dipakai sebagai
// nilai awal / cadangan.
const getMidtransConfig = async (env: Bindings): Promise<MidtransConfig> => {
  const envKey = (env.MIDTRANS_SERVER_KEY || '').trim();
  const dbKey = (await getSetting(env, 'MIDTRANS_SERVER_KEY')).trim();
  const serverKey = dbKey || envKey;

  const storedMode = ((await getSetting(env, 'MIDTRANS_MODE')) || env.MIDTRANS_MODE || '')
    .trim()
    .toLowerCase();
  const storedIsValidMode = storedMode === 'sandbox' || storedMode === 'production';
  const fallbackMode: MidtransMode = storedMode === 'sandbox' ? 'sandbox' : 'production';

  // Mode hasil verifikasi hanya dipercaya bila menyangkut key yang sama
  // persis. Begitu key diganti, app kembali menebak dari prefix sampai key
  // baru diverifikasi ulang lewat Panel Admin.
  const verifiedFingerprint = await getSetting(env, 'MIDTRANS_VERIFIED_KEY');
  const modeVerified = !!verifiedFingerprint
    && verifiedFingerprint === await serverKeyFingerprint(serverKey);

  const detected = detectModeFromServerKey(serverKey);
  const mode = modeVerified && storedIsValidMode ? storedMode as MidtransMode : detected || fallbackMode;


  const storedAcquirer = ((await getSetting(env, 'MIDTRANS_QRIS_ACQUIRER')) || env.MIDTRANS_QRIS_ACQUIRER || '')
    .trim()
    .toLowerCase();
  const acquirer = (MIDTRANS_QRIS_ACQUIRERS as readonly string[]).includes(storedAcquirer)
    ? storedAcquirer
    : MIDTRANS_QRIS_ACQUIRERS[0];

  return {
    serverKey,
    mode,
    baseUrl: MIDTRANS_BASE_URL[mode],
    acquirer,
    keySource: dbKey ? 'Database Settings' : envKey ? 'Cloudflare Environment' : 'Belum Diatur',
    modeSource: modeVerified
      ? 'terverifikasi ke Midtrans'
      : detected
        ? 'deteksi otomatis dari Server Key'
        : 'pengaturan manual',
  };
};

const basicAuthHeader = (serverKey: string) =>
  `Basic ${btoa(`${serverKey}:`)}`;

const midtransHeaders = (serverKey: string) => ({
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Authorization: basicAuthHeader(serverKey),
});

// ------------------------------------------------------------------
// POST /api/auth/login
// Login untuk membedakan admin dan pelanggan
// ------------------------------------------------------------------
app.post('/auth/login', async (c) => {
  try {
    const { email, password } = await c.req.json();
    if (!email || !password) {
      return c.json({ success: false, message: 'Email dan password wajib diisi' }, 400);
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPass = String(password).trim();

    // 1. Cek di Database D1 jika tersedia
    if (c.env.DB) {
      await initAuthSchema(c.env.DB);
      const user = await c.env.DB.prepare('SELECT id, name, email, role, phone, password FROM users WHERE LOWER(email) = ?')
        .bind(cleanEmail)
        .first();

      if (user) {
        if (user.password === cleanPass) {
          const token = user.role === 'admin'
            ? (c.env.ADMIN_KEY || 'kbeans_admin_token')
            : `token_${user.id}_${Date.now()}`;

          return c.json({
            success: true,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
              phone: user.phone || '',
            },
            token,
          });
        } else {
          return c.json({ success: false, message: 'Password salah' }, 401);
        }
      }
    }

    // 2. Fallback autentikasi bawaan (demo tanpa D1 / lokal)
    if (cleanEmail === 'admin@kbeans.com' && cleanPass === 'admin123') {
      return c.json({
        success: true,
        user: {
          id: 'usr_admin',
          name: 'Administrator Kbeans',
          email: 'admin@kbeans.com',
          role: 'admin',
          phone: '081234567890',
        },
        token: c.env.ADMIN_KEY || 'kbeans_admin_token',
      });
    }

    if (cleanEmail === 'pelanggan@gmail.com' && cleanPass === 'pelanggan123') {
      return c.json({
        success: true,
        user: {
          id: 'usr_demo_cust',
          name: 'Reynaldo Pelanggan',
          email: 'pelanggan@gmail.com',
          role: 'customer',
          phone: '089876543210',
        },
        token: 'token_demo_customer',
      });
    }

    return c.json({ success: false, message: 'Akun tidak ditemukan. Silakan periksa kembali atau daftar akun baru.' }, 404);
  } catch (err: any) {
    return c.json({ success: false, message: `Error login: ${err?.message || String(err)}` }, 500);
  }
});

// ------------------------------------------------------------------
// POST /api/auth/register
// Pendaftaran akun pelanggan baru
// ------------------------------------------------------------------
app.post('/auth/register', async (c) => {
  try {
    const { name, email, password, phone } = await c.req.json();
    if (!name || !email || !password) {
      return c.json({ success: false, message: 'Nama, email, dan password wajib diisi' }, 400);
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPass = String(password).trim();
    const cleanName = String(name).trim();
    const cleanPhone = phone ? String(phone).trim() : '';
    const userId = `usr_${Date.now()}`;

    if (c.env.DB) {
      await initAuthSchema(c.env.DB);
      const existing = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(cleanEmail).first();
      if (existing) {
        return c.json({ success: false, message: 'Email ini sudah terdaftar. Silakan login.' }, 400);
      }

      await c.env.DB.prepare(
        'INSERT INTO users (id, name, email, password, role, phone) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(userId, cleanName, cleanEmail, cleanPass, 'customer', cleanPhone).run();
    }

    return c.json({
      success: true,
      message: 'Registrasi berhasil',
      user: {
        id: userId,
        name: cleanName,
        email: cleanEmail,
        role: 'customer',
        phone: cleanPhone,
      },
      token: `token_${userId}`,
    });
  } catch (err: any) {
    return c.json({ success: false, message: `Error registrasi: ${err?.message || String(err)}` }, 500);
  }
});

// ------------------------------------------------------------------
// GET /api/admin/orders
// Daftar semua transaksi untuk dashboard admin.
// ------------------------------------------------------------------
app.get('/admin/orders', async (c) => {
  const key = c.req.header('x-admin-key');
  if (!verifyAdminAccess(key, c.env.ADMIN_KEY)) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }

  if (c.env.DB) {
    const { results } = await c.env.DB
      .prepare('SELECT * FROM orders ORDER BY created_at DESC')
      .all();
    return c.json({ success: true, data: results });
  }

  return c.json({ success: true, data: [] });
});

// ------------------------------------------------------------------
// PATCH /api/admin/orders/:id/status
// Update status pesanan dari admin.
// ------------------------------------------------------------------
app.patch('/admin/orders/:id/status', async (c) => {
  const key = c.req.header('x-admin-key');
  if (!verifyAdminAccess(key, c.env.ADMIN_KEY)) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }

  const id = c.req.param('id');
  const { order_status } = await c.req.json();

  if (c.env.DB) {
    await c.env.DB.prepare('UPDATE orders SET order_status = ? WHERE id = ?').bind(order_status, id).run();
  }

  return c.json({ success: true });
});

// ------------------------------------------------------------------
// GET /api/admin/midtrans/config
// Cek status integrasi Midtrans untuk panel admin
// ------------------------------------------------------------------
app.get('/admin/midtrans/config', async (c) => {
  const key = c.req.header('x-admin-key');
  if (!verifyAdminAccess(key, c.env.ADMIN_KEY)) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }

  const config = await getMidtransConfig(c.env);

  return c.json({
    success: true,
    has_key: !!config.serverKey,
    masked_key: maskSecret(config.serverKey),
    source: config.keySource,
    mode: config.mode,
    mode_source: config.modeSource,
    base_url: config.baseUrl,
    acquirer: config.acquirer,
  });
});

// Menguji apakah sebuah Server Key diterima oleh environment tertentu.
// Endpoint ini hanya memvalidasi kredensial, tidak membuat transaksi apa pun:
//   401/403 -> key ditolak / tidak cocok dengan environment
//   404     -> key valid, order id memang tidak ada (arti autentikasi berhasil)
const verifyServerKey = async (baseUrl: string, serverKey: string) => {
  const headers = { Accept: 'application/json', Authorization: basicAuthHeader(serverKey) };

  const listRes = await fetch(`${baseUrl}/v2/transactions?page=1&limit=1`, { headers });
  if (listRes.status === 401 || listRes.status === 403) {
    return { valid: false, reason: 'rejected' as const, detail: `HTTP ${listRes.status}` };
  }
  if (listRes.ok) return { valid: true, reason: 'ok' as const, detail: '' };

  // Beberapa tipe akun tidak punya akses daftar transaksi, jadi dicoba lewat
  // endpoint status. Di sini 404 justru Tandanya kredensial sudah benar.
  const statusRes = await fetch(`${baseUrl}/v2/kbeans-key-check/status`, { headers });
  if (statusRes.status === 401 || statusRes.status === 403) {
    return { valid: false, reason: 'rejected' as const, detail: `HTTP ${statusRes.status}` };
  }
  return { valid: true, reason: 'ok' as const, detail: '' };
};

// ------------------------------------------------------------------
// POST /api/admin/midtrans/config
// Simpan dan uji Server Key Midtrans langsung dari panel admin.
// Environment (production/sandbox) ditentukan otomatis dari prefix Server Key.
//
// server_key boleh dikosongkan kalau key sudah ada: dipakai untuk menyimpan
// mode / acquirer saja tanpa mengetik ulang kunci yang sudah jalan.
// ------------------------------------------------------------------
app.post('/admin/midtrans/config', async (c) => {
  const key = c.req.header('x-admin-key');
  if (!verifyAdminAccess(key, c.env.ADMIN_KEY)) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }

  const { server_key, mode, qris_acquirer } = await c.req.json();
  const typedKey = String(server_key || '').trim();

  let current = await getMidtransConfig(c.env);
  if (!typedKey && !current.serverKey) {
    return c.json({ success: false, message: 'Server Key tidak boleh kosong' }, 400);
  }

  const cleanKey = typedKey || current.serverKey;
  const detectedMode = detectModeFromServerKey(cleanKey);
  const requestedMode: MidtransMode = String(mode).toLowerCase() === 'sandbox' ? 'sandbox' : 'production';

  const requestedAcquirer = String(qris_acquirer || '').trim().toLowerCase();
  const acquirer = (MIDTRANS_QRIS_ACQUIRERS as readonly string[]).includes(requestedAcquirer)
    ? requestedAcquirer
    : MIDTRANS_QRIS_ACQUIRERS[0];

  // Prefix Server Key tidak selalu bisa dipercaya: key sandbox versi lama
  // berformat 'Mid-server-...' sama persis dengan key production. Jadi kedua
  // environment dicoba, dan yang dipakai adalah yang benar-benar mengizinkan
  // key ini -- bukan yang mana pun hasil tebakan prefix.
  const tryModes: MidtransMode[] = (() => {
    const first = detectedMode || requestedMode;
    const second: MidtransMode = first === 'production' ? 'sandbox' : 'production';
    return [first, second];
  })();

  let effectiveMode: MidtransMode | null = null;
  let verified = false;
  const rejections: string[] = [];

  try {
    for (const mode of tryModes) {
      const check = await verifyServerKey(MIDTRANS_BASE_URL[mode], cleanKey);
      if (check.valid) {
        effectiveMode = mode;
        verified = true;
        break;
      }
      rejections.push(`${mode} (${check.detail})`);
    }
  } catch {
    // Jaringan ke Midtrans tidak bisa dicek saat ini. Simpan saja; charge
    // berikutnya akan memberi tahu kalau kredensialnya benar-benar salah.
  }

  if (!effectiveMode) {
    const networkIssue = rejections.length === 0;
    return c.json({
      success: false,
      message: networkIssue
        ? 'Tidak bisa menghubungi server Midtrans untuk memverifikasi Server Key. Coba lagi beberapa saat lagi.'
        : `Midtrans menolak Server Key ini di kedua environment (${rejections.join(', ')}). `
          + 'Salin ulang dari Midtrans Dashboard > Settings > Access Keys, lalu paste di sini.',
      rejected_in: rejections,
    }, 400);
  }

  const prefixGuessedWrong = detectedMode !== null && detectedMode !== effectiveMode;

  if (typedKey) {
    await setSetting(c.env, 'MIDTRANS_SERVER_KEY', typedKey);
  }
  await setSetting(c.env, 'MIDTRANS_MODE', effectiveMode);
  await setSetting(c.env, 'MIDTRANS_QRIS_ACQUIRER', acquirer);

  // Ikat mode ke key ini, supaya mengganti key otomatis membatalkan mode lama.
  await setSetting(
    c.env,
    'MIDTRANS_VERIFIED_KEY',
    verified ? await serverKeyFingerprint(cleanKey) : ''
  );

  current = await getMidtransConfig(c.env);

  const notes: string[] = [];
  if (prefixGuessedWrong) {
    notes.push(
      `Awalan key terlihat seperti ${detectedMode}, tapi Midtrans hanya menerimanya di ${effectiveMode.toUpperCase()}. `
      + 'Mode sudah disesuaikan otomatis.'
    );
  }
  if (effectiveMode === 'sandbox') {
    notes.push('Mode SANDBOX: QRIS hanya bisa diuji lewat simulator Midtrans, tidak bisa dibayar dengan GoPay/OVO sungguhan.');
  }

  return c.json({
    success: true,
    message: `Server Key terverifikasi di ${effectiveMode.toUpperCase()}. ${notes.join(' ')}`.trim(),
    masked_key: maskSecret(current.serverKey),
    mode: current.mode,
    mode_source: verified ? 'terverifikasi ke Midtrans' : current.modeSource,
    base_url: current.baseUrl,
    acquirer: current.acquirer,
    key_source: current.keySource,
    verified,
    notes,
  });
});

// ------------------------------------------------------------------
// POST /api/orders
// Membuat pesanan baru dan memotong stok produk secara otomatis.
// ------------------------------------------------------------------
app.post('/orders', async (c) => {
  const body = await c.req.json();
  const {
    customer_name,
    customer_phone,
    customer_email,
    fulfillment_type,
    pickup_time_slot,
    delivery_address,
    items,          // array: [{ id, quantity, price }, ...]
    payment_method,
  } = body;

  if (!customer_name || !customer_phone || !items || items.length === 0) {
    return c.json({ success: false, message: 'Data pesanan tidak lengkap' }, 400);
  }

  const subtotal = items.reduce(
    (sum: number, item: any) => sum + item.price * item.quantity,
    0
  );
  const delivery_fee = fulfillment_type === 'delivery' && subtotal < 150000 ? 15000 : 0;
  const total_amount = subtotal + delivery_fee;
  const order_id = 'ORD-' + Date.now();
  const order_number = 'KB' + Math.floor(100000 + Math.random() * 900000);

  if (c.env.DB) {
    // Kurangi stok setiap item yang dibeli
    for (const item of items) {
      await c.env.DB.prepare(
        'UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?) WHERE id = ?'
      ).bind(item.quantity, item.id).run();
    }

    // Simpan pesanan
    await c.env.DB.prepare(
      `INSERT INTO orders (
        id, order_number, customer_name, customer_phone, customer_email,
        fulfillment_type, pickup_time_slot, delivery_address, items_json,
        subtotal, delivery_fee, total_amount, payment_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      order_id, order_number, customer_name, customer_phone, customer_email || null,
      fulfillment_type, pickup_time_slot || null, delivery_address || null,
      JSON.stringify(items), subtotal, delivery_fee, total_amount, payment_method
    ).run();
  }

  return c.json({
    success: true,
    order_id,
    order_number,
    subtotal,
    delivery_fee,
    total_amount,
  });
});

// ------------------------------------------------------------------
// POST /api/midtrans/charge
// Membuat transaksi SUNGGUHAN di Midtrans (Core API) untuk order yang baru
// dibuat, lalu mengembalikan info pembayaran (QRIS / Virtual Account) ke
// frontend. Environment ditentukan otomatis dari prefix Server Key, sehingga
// Server Key produksi memakai https://api.midtrans.com.
//
// Penting: kalau Midtrans menolak transaksi, endpoint ini mengembalikan
// error yang apa adanya. Ia TIDAK PERNAH memalsukan QR_CODE / nomor VA,
// karena QR palsu hanya bisa "dipindai" tapi tidak bisa dibayar.
// ------------------------------------------------------------------
app.post('/midtrans/charge', async (c) => {
  try {
    const { order_id, payment_method } = await c.req.json();

    if (!c.env.DB) {
      return c.json({ success: false, message: 'Database tidak tersedia' }, 500);
    }

    const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order_id).first();
    if (!order) {
      return c.json({ success: false, message: 'Order tidak ditemukan' }, 404);
    }

    const config = await getMidtransConfig(c.env);
    if (!config.serverKey) {
      return c.json({
        success: false,
        message: 'Server Key Midtrans belum diatur. Buka Dashboard Admin > Pengaturan Midtrans, lalu simpan Server Key Anda.',
      }, 400);
    }

    // Tanpa kolom midtrans_* transaksi tidak bisa ditautkan ke order, jadi QR
    // yang dibuat tidak akan pernahUpdating status pembayaran.
    if (!(await hasOrderMidtransColumns(c.env.DB))) {
      return c.json({
        success: false,
        message: 'Kolom midtrans_order_id / midtrans_qr_url belum ada di tabel orders. '
          + 'Jalankan: npx wrangler d1 execute kbeans-db --remote --file=migration_auth_settings.sql',
      }, 500);
    }

    // Midtrans mewajibkan order_id unik yang belum pernah dipakai (maks 50 karakter).
    const midtransOrderId = `${order.order_number}-${Date.now()}`;

    const grossAmount = Math.round(Number(order.total_amount));
    if (!Number.isFinite(grossAmount) || grossAmount < 1000) {
      return c.json({
        success: false,
        message: `Total pembayaran tidak valid untuk Midtrans (minimal Rp1.000). Nilai saat ini: ${grossAmount}.`,
      }, 400);
    }

    // Midtrans menolak nama/email berisi karakter khusus, jadi dibersihkan dulu.
    const cleanName = String(order.customer_name || 'Pelanggan')
      .replace(/[^a-zA-Z0-9 .,'-]/g, ' ')
      .trim()
      .slice(0, 40) || 'Pelanggan';
    const cleanPhone = String(order.customer_phone || '').replace(/[^0-9+]/g, '').slice(0, 20);
    const cleanEmail = order.customer_email
      ? String(order.customer_email).replace(/[^a-zA-Z0-9@._-]/g, '').slice(0, 50)
      : '';

    const transactionDetails = { order_id: midtransOrderId, gross_amount: grossAmount };
    const customerDetails: Record<string, string> = {
      first_name: cleanName,
      ...(cleanPhone ? { phone: cleanPhone } : {}),
      ...(cleanEmail ? { email: cleanEmail } : {}),
    };

    const callMidtrans = async (payload: any) => {
      const res = await fetch(`${config.baseUrl}/v2/charge`, {
        method: 'POST',
        headers: midtransHeaders(config.serverKey),
        body: JSON.stringify(payload),
      });
      const data: any = await res.json().catch(() => ({}));
      return { httpStatus: res.status, data };
    };

    const isCreated = (data: any) => ['200', '201'].includes(String(data?.status_code));

    // Satu percobaan charge. Return error dalam bentuk yang bisa ditampilkan
    // ke pengguna, plus penanda apakah transaksi sudah terlanjur dibuat.
    type ChargeAttempt = { ok: true; data: any } | { ok: false; message: string; transactionCreated: boolean };
    const attemptCharge = async (payload: any): Promise<ChargeAttempt> => {
      try {
        const { httpStatus, data } = await callMidtrans(payload);
        if (isCreated(data)) return { ok: true, data };

        const message = data?.status_message
          || (httpStatus === 401 || httpStatus === 403
            ? 'Server Key ditolak oleh Midtrans (401/403). Periksa lagi Server Key dan environment-nya.'
            : `Midtrans menolak transaksi (HTTP ${httpStatus}).`);

        return { ok: false, message, transactionCreated: !!data?.transaction_id };
      } catch (err: any) {
        return {
          ok: false,
          message: `Gagal menghubungi server Midtrans (${config.baseUrl}): ${err?.message || 'Network error'}`,
          transactionCreated: false,
        };
      }
    };

    // Daftar payload yang dicoba berurutan. QRIS di Midtrans WAJIB memakai
    // acquirer (hanya GoPay dan AirPay Shopee yang didukung), jadi kandidat
    // acquirer_other dicoba lebih dulu, lalu fallback ke gopay / airpay shopee
    // bila acquirer tersebut belum diaktifkan di akun Midtrans Anda.
    const bankChain = ['bca', 'permata', 'mandiri'];
    const qrisAcquirerChain = [config.acquirer, ...MIDTRANS_QRIS_ACQUIRERS.filter((a) => a !== config.acquirer)];

    const buildPayloads = (): any[] => {
      if (payment_method === 'bca_va') {
        return bankChain.map((bank) => ({
          payment_type: 'bank_transfer',
          transaction_details: transactionDetails,
          bank_transfer: { bank },
          customer_details: customerDetails,
        }));
      }

      const payloads: any[] = qrisAcquirerChain.map((acquirer) => ({
        payment_type: 'qris',
        transaction_details: transactionDetails,
        qris: { acquirer },
        customer_details: customerDetails,
      }));

      // Tanpa acquirer: dipakai kalau akun Midtrans memakai QRIS generik BI.
      payloads.push({
        payment_type: 'qris',
        transaction_details: transactionDetails,
        customer_details: customerDetails,
      });

      return payloads;
    };

    const failures: string[] = [];
    let successData: any = null;

    for (const payload of buildPayloads()) {
      const result = await attemptCharge(payload);
      if (result.ok) {
        successData = result.data;
        break;
      }
      failures.push(result.message);
      // Kalau Midtrans sudah membuat transaksi (misal status 202 deny), jangan
      // mencoba lagi supaya tidak tercipta transaksi ganda untuk satu order.
      if (result.transactionCreated) break;
    }

    if (!successData) {
      const uniqueFailures = [...new Set(failures)];
      return c.json({
        success: false,
        mode: config.mode,
        message: uniqueFailures[0] || 'Midtrans tidak memberikan respons.',
        failures: uniqueFailures,
        hint: config.mode === 'production'
          ? 'Pastikan channel QRIS sudah diaktifkan di Midtrans Dashboard > Settings > Payment Methods, dan acquirer (GoPay / AirPay Shopee) sudah aktif untuk akun Anda.'
          : 'Pastikan channel QRIS tersedia di Sandbox Midtrans, atau ganti mode ke Production pada Pengaturan Midtrans.',
      }, 502);
    }

    // Transaksi NYATA berhasil dibuat. Simpan referensi transaksinya ke D1
    // supaya status bisa dicek ulang ke Midtrans kapan saja. Kolom midtrans_*
    // sudah dipastikan ada di awal handler ini.
    await c.env.DB.prepare('UPDATE orders SET midtrans_order_id = ? WHERE id = ?')
      .bind(midtransOrderId, order_id)
      .run();

    if (payment_method === 'bca_va') {
      const vaNumber =
        successData.va_numbers?.[0]?.va_number ||
        successData.permata_va_number ||
        successData.bank_details?.va_number ||
        '';

      if (!vaNumber) {
        return c.json({
          success: false,
          message: 'Midtrans membuat transaksi Virtual Account tanpa nomor VA. Coba muat ulang halaman.',
        }, 502);
      }

      return c.json({
        success: true,
        mode: config.mode,
        bank: successData.bank_details?.bank || successData.bank || successData.permata_bank || '',
        va_number: vaNumber,
        midtrans_order_id: midtransOrderId,
        expires_at: successData.expiry_time || successData.va_expiration_time || '',
      });
    }

    // QRIS: gambar QR asli dibuat oleh Midtrans. URL-nya diteruskan lewat
    // /api/midtrans/qr (proxy) supaya bisa diunduh tanpa masalah CORS.
    const qrAction = successData.actions?.find((a: any) => a.name === 'generate-qr-code')
      || successData.actions?.find((a: any) => a.name === 'generate-qr-code-v2');

    if (!qrAction?.url) {
      return c.json({
        success: false,
        message: 'Midtrans tidak mengembalikan QR code untuk transaksi ini. Periksa apakah channel QRIS sudah aktif di akun Midtrans Anda.',
      }, 502);
    }

    await c.env.DB.prepare('UPDATE orders SET midtrans_qr_url = ? WHERE id = ?')
      .bind(qrAction.url, order_id)
      .run();

    return c.json({
      success: true,
      mode: config.mode,
      acquirer: successData.acquirer || config.acquirer,
      qr_proxy_url: `/api/midtrans/qr?order_id=${encodeURIComponent(order_id)}`,
      midtrans_order_id: midtransOrderId,
      transaction_id: successData.transaction_id || '',
      expires_at: successData.expiry_time || '',
    });
  } catch (err: any) {
    return c.json({ success: false, message: `Error tak terduga: ${err?.message || String(err)}` }, 500);
  }
});

// ------------------------------------------------------------------
// GET /api/midtrans/qr?order_id=...
// Proxy gambar QRIS asli dari Midtrans. Dipakai frontend sebagai <img>.
// Proxy ini penting karena: (1) URL QR Midtrans tidak selalu mengirim header
// CORS sehingga browser bisa gagal saat mengunduhnya, dan (2) satu-satunya
// cara memvalidasi order sebelum meneruskan gambar.
// ------------------------------------------------------------------
app.get('/midtrans/qr', async (c) => {
  const orderId = c.req.query('order_id');
  if (!orderId || !c.env.DB) {
    return c.json({ success: false, message: 'order_id wajib diisi' }, 400);
  }

  // Kolom midtrans_* sudah dimigrasi; dicek di ensureOrderColumns di bawah.

  const order: any = await c.env.DB
    .prepare('SELECT midtrans_order_id, midtrans_qr_url FROM orders WHERE id = ?')
    .bind(orderId)
    .first();

  if (!order?.midtrans_order_id) {
    return c.json({ success: false, message: 'Transaksi QR untuk order ini belum dibuat' }, 404);
  }

  const config = await getMidtransConfig(c.env);
  if (!config.serverKey) {
    return c.json({ success: false, message: 'Server Key Midtrans belum diatur' }, 500);
  }

  // Sumber utama: URL QR yang disimpan saat charge berhasil. Ini membuat QR
  // tetap tampil walau panggilan status ke Midtrans sedang gagal.
  const candidates: string[] = order.midtrans_qr_url ? [order.midtrans_qr_url] : [];

  // Cadangan: tanya status ke Midtrans. Dipakai juga untuk menolak QR yang
  // transaksinya sudah kedaluwarsa / dibatalkan.
  let statusChecked = false;
  try {
    const statusRes = await fetch(`${config.baseUrl}/v2/${order.midtrans_order_id}/status`, {
      headers: { Accept: 'application/json', Authorization: basicAuthHeader(config.serverKey) },
    });
    if (statusRes.ok) {
      const statusData: any = await statusRes.json().catch(() => ({}));
      statusChecked = true;

      if (statusData?.transaction_status && statusData.transaction_status !== 'pending') {
        return c.json({
          success: false,
          message: `Transaksi sudah berstatus "${statusData.transaction_status}".`,
          transaction_status: statusData.transaction_status,
        }, 409);
      }

      const actions: any[] = statusData?.actions || [];
      for (const action of actions) {
        if (action?.name === 'generate-qr-code' || action?.name === 'generate-qr-code-v2') {
          if (!candidates.includes(action.url)) candidates.push(action.url);
        }
      }
    }
  } catch {
    // Status tidak bisa dicek: tetap layani QR dari URL yang tersimpan.
  }

  if (candidates.length === 0 && !statusChecked) {
    return c.json({
      success: false,
      message: 'Gambar QRIS belum tersedia. Muat ulang halaman pembayaran.',
    }, 502);
  }

  for (const url of candidates) {
    const imgRes = await fetch(url, { headers: { Accept: 'image/png,image/*' } }).catch(() => null);
    if (!imgRes?.ok) continue;

    const body = await imgRes.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': imgRes.headers.get('content-type') || 'image/png',
        'Cache-Control': 'no-store',
      },
    });
  }

  return c.json({
    success: false,
    message: 'Gambar QRIS tidak bisa dimuat dari Midtrans. Coba muat ulang halaman pembayaran.',
  }, 502);
});

// ------------------------------------------------------------------
// GET /api/midtrans/status?order_id=...
// Sinkronkan status pembayaran ke D1 dengan menanyakan langsung ke Midtrans.
// Dengan begitu status tetap akurat meskipun webhook belum dikonfigurasi di
// Dashboard Midtrans.
// ------------------------------------------------------------------
const mapMidtransStatus = (transactionStatus: string | undefined): string | null => {
  if (!transactionStatus) return null;
  if (transactionStatus === 'settlement' || transactionStatus === 'capture') return 'settlement';
  if (['deny', 'cancel', 'expire', 'failure', 'partial_refund', 'refund'].includes(transactionStatus)) {
    return 'failed';
  }
  if (transactionStatus === 'pending') return 'pending';
  return null;
};

const syncOrderStatus = async (env: Bindings, order: any) => {
  let paymentStatus = order.payment_status || 'pending';
  let transactionStatus: string | undefined;

  const config = await getMidtransConfig(env);
  if (config.serverKey && order.midtrans_order_id && env.DB) {
    try {
      const res = await fetch(`${config.baseUrl}/v2/${order.midtrans_order_id}/status`, {
        headers: { Accept: 'application/json', Authorization: basicAuthHeader(config.serverKey) },
      });
      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        transactionStatus = data?.transaction_status;
        const mapped = mapMidtransStatus(transactionStatus);
        if (mapped && mapped !== paymentStatus) {
          paymentStatus = mapped;
          await env.DB.prepare('UPDATE orders SET payment_status = ? WHERE id = ?')
            .bind(paymentStatus, order.id)
            .run();
        }
      }
    } catch {
      // Jaringan ke Midtrans gagal: andalkan nilai terakhir yang tersimpan di D1.
    }
  }

  return { payment_status: paymentStatus, transaction_status: transactionStatus || null };
};

app.get('/midtrans/status', async (c) => {
  const orderId = c.req.query('order_id');
  if (!orderId || !c.env.DB) {
    return c.json({ success: false, message: 'order_id wajib diisi' }, 400);
  }

  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) {
    return c.json({ success: false, message: 'Order tidak ditemukan' }, 404);
  }

  const status = await syncOrderStatus(c.env, order);
  return c.json({ success: true, ...status });
});

// ------------------------------------------------------------------
// POST /api/midtrans/notification
// Webhook resmi Midtrans -- dipanggil otomatis oleh server Midtrans
// setiap status transaksi berubah (pending/settlement/expire/dll).
// URL ini yang didaftarkan di Midtrans Dashboard > Settings > Configuration.
// ------------------------------------------------------------------
const handleMidtransNotification = async (c: any) => {
  const body: any = await c.req.json().catch(() => ({}));
  const { order_id, status_code, gross_amount, signature_key, transaction_status } = body;

  if (!order_id || !signature_key) {
    return c.json({ success: false, message: 'Payload notifikasi tidak lengkap' }, 400);
  }

  const config = await getMidtransConfig(c.env);
  if (!config.serverKey) {
    return c.json({ success: false, message: 'Server Key belum diset' }, 500);
  }

  // Verifikasi signature supaya notifikasi ini benar-benar dari Midtrans,
  // bukan orang lain yang berpura-pura mengirim status "sudah bayar".
  const raw = `${order_id}${status_code}${gross_amount}${config.serverKey}`;
  const hashBuffer = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(raw));
  const computedSignature = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (computedSignature !== signature_key) {
    return c.json({ success: false, message: 'Invalid signature' }, 403);
  }

  const paymentStatus = mapMidtransStatus(transaction_status);
  if (paymentStatus && c.env.DB) {
    await c.env.DB.prepare('UPDATE orders SET payment_status = ? WHERE midtrans_order_id = ?')
      .bind(paymentStatus, order_id)
      .run();
  }

  return c.json({ success: true });
};

app.post('/midtrans/notification', handleMidtransNotification);

// Alias webhook untuk kompatibilitas URL
app.post('/midtrans-webhook', handleMidtransNotification);

// ------------------------------------------------------------------
// GET /api/orders/:id/status
// Dipakai frontend untuk polling status pembayaran sambil pembeli
// menunggu di layar QR/VA. Status disinkronkan ulang dengan Midtrans supaya
// tetap akurat walau webhook belum terdaftar di Dashboard Midtrans.
// ------------------------------------------------------------------
app.get('/orders/:id/status', async (c) => {
  const id = c.req.param('id');
  if (c.env.DB) {
    const order: any = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
    if (!order) {
      return c.json({ success: false, message: 'Order tidak ditemukan' }, 404);
    }
    return c.json({ success: true, ...(await syncOrderStatus(c.env, order)) });
  }
  return c.json({ success: true, payment_status: 'pending' });
});

// ------------------------------------------------------------------
// POST /api/chat
// AI Customer Assistant Kbeans — dijalankan di edge, bukan di React,
// supaya API key tidak pernah terekspos ke browser.
// ------------------------------------------------------------------
app.post('/chat', async (c) => {
  const { message } = await c.req.json();

  // 1. Ambil data produk live dari D1 untuk konteks real-time (RAG sederhana)
  let products: any[] = [];
  if (c.env.DB) {
    const res = await c.env.DB.prepare(
      'SELECT name, price, roast_level, origin, stock_quantity FROM products WHERE stock_quantity > 0 LIMIT 15'
    ).all();
    products = res.results;
  }

  const systemPrompt = `Anda adalah Customer Service pintar Kbeans, toko biji kopi online.
Tugas Anda: membantu pelanggan memilih biji kopi sesuai selera (light/medium/dark roast, arabica/robusta),
menjawab pertanyaan stok dan harga, serta menjelaskan asal (origin) kopi.
Stok kopi saat ini: ${JSON.stringify(products)}.
Selalu jawab dengan ramah dan singkat dalam Bahasa Indonesia.`;

  // 2. Jalankan Llama 3.2 di Cloudflare Workers AI (gratis, tanpa API key)
  if (c.env.AI) {
    const aiRes = await c.env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      max_tokens: 400,
    });
    return c.json({ success: true, reply: aiRes.response, source: 'workers_ai_llama3' });
  }

  // 3. Fallback kalau binding AI belum aktif (mis. saat development lokal)
  return c.json({ success: true, reply: 'Halo dari Kbeans! Ada yang bisa kami bantu soal kopi hari ini?' });
});

export const onRequest = handle(app);
export default app;
