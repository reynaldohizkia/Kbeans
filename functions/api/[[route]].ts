import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handle } from 'hono/cloudflare-pages';
import {
  getActiveProvider,
  getActiveProviderId,
  getProvider,
  getProviderForOrder,
  providerList,
  setActiveProviderId,
  getSetting,
  setSetting,
  sha256Hex,
  getMidtransBaseUrl,
  type PaymentMethod,
  type ProviderId,
} from '../_lib/payments/index';
import { midtransVerifyWebhook, mapMidtransTransactionStatus } from '../_lib/payments/midtrans-webhook';

type Bindings = {
  DB?: any;          // Binding ke Cloudflare D1
  AI?: any;           // Binding ke Cloudflare Workers AI
  GEMINI_API_KEY?: string;
  ADMIN_KEY?: string; // Secret untuk proteksi panel admin
  MIDTRANS_SERVER_KEY?: string;
  MIDTRANS_CLIENT_KEY?: string;
  MIDTRANS_MODE?: string;         // 'production' | 'sandbox' (opsional, bila key tidak bisa dideteksi)
  MIDTRANS_QRIS_ACQUIRER?: string; // 'gopay' | 'airpay shopee'
  XENDIT_SECRET_KEY?: string;
  XENDIT_CALLBACK_TOKEN?: string;
};

const app = new Hono<{ Bindings: Bindings }>().basePath('/api');
app.use('*', cors());

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

// Token admin diturunkan dari secret ADMIN_KEY, bukan secret-nya sendiri,
// sehingga secret asli tidak pernah dikirim ke browser. Nilai token ini juga
// tidak ditulis di source code: yang tertulis di repo tidak cukup untuk
// mengakses API admin.
const deriveAdminToken = async (secret: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`kbeans-admin-token:${secret}`)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

// Verifikasi akses admin. Hanya menerima token hasil derivasi dari ADMIN_KEY.
// Kalau ADMIN_KEY belum diset di Cloudflare, semua akses admin ditolak.
const verifyAdminAccess = async (key: string | undefined, envAdminKey: string | undefined) => {
  if (!key || !envAdminKey) return false;
  return key === await deriveAdminToken(envAdminKey);
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



// Helper settings, schema, dan fingerprint sekarang tinggal di
// ../_lib/payments: seluruh logika per-gateway dipindah ke masing-masing
// provider, sehingga route ini tidak perlu tahu detail Midtrans maupun Xendit.

// Kolom payment_* menyimpan provider dan id transaksi aktif, dipakai supaya
// order yang dibuat sebelum provider diganti tetap bisa dicek statusnya.
const hasPaymentColumns = async (db: any) => {
  if (!db) return false;
  try {
    const { results } = await db.prepare('PRAGMA table_info(orders)').all();
    const names = new Set((results || []).map((r: any) => r.name));
    return names.has('payment_provider') && names.has('payment_external_id');
  } catch {
    return false;
  }
};
// ------------------------------------------------------------------
// Password disimpan sebagai hash SHA-256, bukan teks biasa. Password lama yang
// masih tersimpan polos tetap bisa login lalu otomatis di-upgrade ke hash.
const hashPassword = async (password: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const looksHashed = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

const verifyPassword = async (stored: unknown, candidate: string) => {
  if (looksHashed(stored)) return stored === await hashPassword(candidate);
  return stored === candidate;
};

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
        if (await verifyPassword(user.password, cleanPass)) {
          // Upgrade password polos menjadi hash saat login berhasil.
          if (!looksHashed(user.password)) {
            await c.env.DB.prepare('UPDATE users SET password = ? WHERE id = ?')
              .bind(await hashPassword(cleanPass), user.id)
              .run();
          }

          if (user.role === 'admin' && !c.env.ADMIN_KEY) {
            return c.json({
              success: false,
              message: 'ADMIN_KEY belum diset di Cloudflare Pages, jadi login admin dinonaktifkan. '
                + 'Set environment variable ADMIN_KEY, lalu deploy ulang.',
            }, 503);
          }

          const token = user.role === 'admin'
            ? await deriveAdminToken(c.env.ADMIN_KEY as string)
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
          return c.json({ success: false, message: 'Email atau password salah' }, 401);
        }
      }
    }

    // 2. Akun hanya diakui bila ada di database. Dulu ada fallback login
    // hardcoded (admin@kbeans.com / admin123) di sini, yang membuat password
    // yang diganti lewat Panel Admin tidak benar-benar berlaku.
    return c.json({
      success: false,
      message: 'Akun tidak ditemukan. Silakan periksa kembali atau daftar akun baru.',
    }, 404);
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

    if (cleanPass.length < 8) {
      return c.json({ success: false, message: 'Password minimal 8 karakter' }, 400);
    }

    if (c.env.DB) {
      await initAuthSchema(c.env.DB);
      const existing = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(cleanEmail).first();
      if (existing) {
        return c.json({ success: false, message: 'Email ini sudah terdaftar. Silakan login.' }, 400);
      }

      await c.env.DB.prepare(
        'INSERT INTO users (id, name, email, password, role, phone) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(userId, cleanName, cleanEmail, await hashPassword(cleanPass), 'customer', cleanPhone).run();
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
  if (!(await verifyAdminAccess(key, c.env.ADMIN_KEY))) {
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
  if (!(await verifyAdminAccess(key, c.env.ADMIN_KEY))) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }

  const id = c.req.param('id');
  const { order_status } = await c.req.json();

  if (c.env.DB) {
    await c.env.DB.prepare('UPDATE orders SET order_status = ? WHERE id = ?').bind(order_status, id).run();
  }

  return c.json({ success: true });
});

// Nama setting per provider. Dipisah supaya menambah gateway baru cukup
// menambah satu entri di sini.
const PROVIDER_KEY_SETTING: Record<ProviderId, string> = {
  midtrans: 'MIDTRANS_SERVER_KEY',
  xendit: 'XENDIT_SECRET_KEY',
};
const PROVIDER_FINGERPRINT_SETTING: Record<ProviderId, string> = {
  midtrans: 'MIDTRANS_VERIFIED_KEY',
  xendit: 'XENDIT_VERIFIED_KEY',
};
const PROVIDER_KEY_ENV_VAR: Record<ProviderId, string> = {
  midtrans: 'MIDTRANS_SERVER_KEY',
  xendit: 'XENDIT_SECRET_KEY',
};

const providerKeySetting = (id: ProviderId) => PROVIDER_KEY_SETTING[id];
const providerFingerprintSetting = (id: ProviderId) => PROVIDER_FINGERPRINT_SETTING[id];
const providerKeyEnvVar = (id: ProviderId) => PROVIDER_KEY_ENV_VAR[id];

// ------------------------------------------------------------------
// GET /api/admin/payments/config
// Status integrasi payment gateway untuk Panel Admin. Menyediakan daftar
// provider yang tersedia plus status provider yang sedang aktif.
// ------------------------------------------------------------------
const handlePaymentsConfig = async (c: any) => {
  const key = c.req.header('x-admin-key');
  if (!(await verifyAdminAccess(key, c.env.ADMIN_KEY))) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }

  const activeId = await getActiveProviderId(c.env);

  // Ringkasan semua provider, supaya Panel Admin bisa menampilkan status
  // masing-masing tanpa request terpisah.
  const providers = await Promise.all(
    providerList().map(async (meta) => {
      const provider = getProvider(meta.id);
      const [info, ready, keyMask, keySrc] = await Promise.all([
        provider.describe(c.env),
        provider.hasKey(c.env),
        provider.maskedKey(c.env),
        provider.keySource(c.env),
      ]);
      return {
        ...meta,
        has_key: ready,
        masked_key: keyMask,
        key_source: keySrc,
        mode: info.mode,
        mode_source: info.source,
        base_url: info.baseUrl,
        verified: info.verified,
      };
    })
  );

  const activeInfo = providers.find((p) => p.id === activeId) || {
    has_key: false,
    masked_key: '',
    key_source: 'Belum Diatur',
    mode: '',
    mode_source: '',
    base_url: '',
    verified: false,
  };

  return c.json({
    success: true,
    active_provider: activeId,
    has_key: activeInfo.has_key,
    masked_key: activeInfo.masked_key,
    source: activeInfo.key_source,
    mode: activeInfo.mode,
    mode_source: activeInfo.mode_source,
    base_url: activeInfo.base_url,
    verified: activeInfo.verified,
    providers,
  });
};

app.get('/admin/payments/config', handlePaymentsConfig);
// Alias lama agar klien yang masih memakai path ini tidak langsung rusak.
app.get('/admin/midtrans/config', handlePaymentsConfig);


// ------------------------------------------------------------------
// POST /api/admin/payments/config
// Simpan dan uji credential payment gateway dari Panel Admin.
//
// credential boleh dikosongkan kalau sudah ada: dipakai untuk berpindah
// provider atau menyesuaikan opsi tanpa mengetik ulang kunci yang jalan.
// ------------------------------------------------------------------
const handleSavePaymentsConfig = async (c: any) => {

  const key = c.req.header('x-admin-key');
  if (!(await verifyAdminAccess(key, c.env.ADMIN_KEY))) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const providerId = (String(body.provider || '').trim().toLowerCase() || await getActiveProviderId(c.env)) as ProviderId;
  const provider = getProvider(providerId);
  if (!provider) {
    return c.json({ success: false, message: `Provider tidak dikenal: ${providerId}` }, 400);
  }

  const typedKey = String(body.secret_key ?? body.server_key ?? '').trim();
  const notes: string[] = [];

  if (typedKey) {
    // Verifikasi dulu: jangan simpan credential yang ditolak gateway.
    const check = await provider.verifyKey(c.env, typedKey, {
      mode: body.mode,
      qris_acquirer: body.qris_acquirer,
    });

    if (!check.ok) {
      return c.json({
        success: false,
        message: `${provider.label} menolak credential ini${check.detail ? ` (${check.detail})` : ''}.`,
        notes: check.notes || [],
      }, 400);
    }

    notes.push(...(check.notes || []));

    const envKey = String((c.env as any)[providerKeyEnvVar(providerId)] || '').trim();
    // Key dari form hanya disimpan kalau berbeda dari key yang sudah dikelola
    // Cloudflare Environment, karena env var selalu menang saat dibaca.
    if (envKey !== typedKey) {
      await setSetting(c.env, providerKeySetting(providerId), typedKey);
    }

    await setSetting(
      c.env,
      providerFingerprintSetting(providerId),
      await sha256Hex(typedKey)
    );
  }

  if (body.provider) {
    await setActiveProviderId(c.env, providerId);
  }

  const activeId = await getActiveProviderId(c.env);
  const activeProvider = getProvider(activeId);
  const [describe, masked, source, ready] = await Promise.all([
    activeProvider.describe(c.env),
    activeProvider.maskedKey(c.env),
    activeProvider.keySource(c.env),
    activeProvider.hasKey(c.env),
  ]);

  if (!ready) {
    notes.push(`${activeProvider.label} belum punya credential, jadi pembayaran belum bisa diproses.`);

  }

  return c.json({
    success: true,
    message: typedKey
      ? `Credential ${provider.label} tersimpan.`
      : 'Pengaturan pembayaran tersimpan.',
    active_provider: activeId,
    masked_key: masked,
    key_source: source,
    mode: describe.mode,
    mode_source: describe.source,
    base_url: describe.baseUrl,
    verified: describe.verified,
    notes,
  });
};

// Alias lama agar klien yang masih memakai path ini tidak langsung rusak.
app.post('/admin/payments/config', handleSavePaymentsConfig);
app.post('/admin/midtrans/config', handleSavePaymentsConfig);


// ------------------------------------------------------------------
// POST /api/auth/change-password
// Mengganti password sendiri. Password lama harus benar supaya nobody bisa
// mengambil alih akun hanya dengan knowing email.
// ------------------------------------------------------------------
app.post('/auth/change-password', async (c) => {
  try {
    const { email, current_password, new_password } = await c.req.json();

    if (!email || !current_password || !new_password) {
      return c.json({ success: false, message: 'Email, password lama, dan password baru wajib diisi' }, 400);
    }
    if (String(new_password).length < 8) {
      return c.json({ success: false, message: 'Password baru minimal 8 karakter' }, 400);
    }
    if (new_password === current_password) {
      return c.json({ success: false, message: 'Password baru harus berbeda dari password lama' }, 400);
    }
    if (!c.env.DB) {
      return c.json({ success: false, message: 'Database tidak tersedia' }, 500);
    }

    await initAuthSchema(c.env.DB);

    const user: any = await c.env.DB
      .prepare('SELECT id, password FROM users WHERE LOWER(email) = ?')
      .bind(String(email).trim().toLowerCase())
      .first();

    if (!user) {
      return c.json({ success: false, message: 'Akun tidak ditemukan' }, 404);
    }
    if (!(await verifyPassword(user.password, String(current_password)))) {
      return c.json({ success: false, message: 'Password lama salah' }, 401);
    }

    await c.env.DB.prepare('UPDATE users SET password = ? WHERE id = ?')
      .bind(await hashPassword(String(new_password)), user.id)
      .run();

    return c.json({ success: true, message: 'Password berhasil diganti. Silakan login ulang.' });
  } catch (err: any) {
    return c.json({ success: false, message: `Error ganti password: ${err?.message || String(err)}` }, 500);
  }
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
// POST /api/payments/charge
// Membuat transaksi NYATA di payment gateway yang aktif untuk order yang baru
// dibuat, lalu mengembalikan instruksi pembayaran (QRIS / Virtual Account).
// Route ini tidak tahu gateway apa pun yang dipakai: semua perbedaan
//ditangani masing-masing provider di ../_lib/payments.
//
// Penting: kalau gateway menolak, endpoint ini mengembalikan error yang apa
// adanya. Ia TIDAK PERNAH memalsukan QR atau nomor VA, karena QR palsu hanya
// bisa "dipindai" tapi tidak bisa dibayar.
// ------------------------------------------------------------------
const handleCharge = async (c: any) => {
  try {
    const { order_id, payment_method } = await c.req.json();

    if (!c.env.DB) {
      return c.json({ success: false, message: 'Database tidak tersedia' }, 500);
    }

    const order: any = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order_id).first();
    if (!order) {
      return c.json({ success: false, message: 'Order tidak ditemukan' }, 404);
    }

    if (!(await hasPaymentColumns(c.env.DB))) {
      return c.json({
        success: false,
        message: 'Kolom payment_provider / payment_external_id belum ada di tabel orders. '
          + 'Jalankan: npx wrangler d1 execute kbeans-db --remote --file=migration_auth_settings.sql',
      }, 500);
    }

    const provider = await getActiveProvider(c.env);
    const method = String(payment_method) as PaymentMethod;
    const origin = new URL(c.req.url).origin;

    // reference id harus unik per transaksi, jadi timestamp ditambahkan.
    const referenceId = `${order.order_number}-${Date.now()}`;

    const result = await provider.createPayment({
      env: c.env,
      order,
      method,
      referenceId,
      origin,
    });

    if (!result.ok) {
      return c.json({
        success: false,
        provider: provider.id,
        provider_label: provider.label,
        message: result.message,
        hint: result.hint,
        failures: result.failures,
      }, 502);
    }

    const instruction = result.instruction;

    await c.env.DB.prepare(
      'UPDATE orders SET payment_provider = ?, payment_external_id = ? WHERE id = ?'
    ).bind(provider.id, instruction.externalId, order_id).run();

    // Midtrans menyajikan QR sebagai gambar resmi dari gateway-nya, jadi URL-nya
    // disimpan untuk dipakai endpoint proxy /api/midtrans/qr.
    if (instruction.qrImageUrl) {
      await c.env.DB.prepare('UPDATE orders SET midtrans_qr_url = ? WHERE id = ?')
        .bind(instruction.qrImageUrl, order_id)
        .run();
    }

    return c.json({
      success: true,
      provider: provider.id,
      provider_label: provider.label,
      external_id: instruction.externalId,
      // Xendit mengirim string EMVCo; frontend yang merender QR-nya sendiri.
      qr_string: instruction.qrString || undefined,
      // Midtrans mengirim URL gambar; frontend memakainya lewat proxy.
      qr_proxy_url: instruction.qrImageUrl
        ? `/api/midtrans/qr?order_id=${encodeURIComponent(order_id)}`
        : undefined,
      va_number: instruction.vaNumber,
      va_bank: instruction.vaBank,
      expires_at: instruction.expiresAt,
      amount: instruction.amount,
      notes: instruction.notes,
    });
  } catch (err: any) {
    return c.json({ success: false, message: `Error tak terduga: ${err?.message || String(err)}` }, 500);
  }
};

app.post('/payments/charge', handleCharge);
// Alias lama agar klien versi sebelumnya tidak langsung rusak.
app.post('/midtrans/charge', handleCharge);

// ------------------------------------------------------------------
// POST /api/admin/payments/simulate
// Menandai pembayaran lunas di mode test (Xendit). Hanya tersedia untuk
// provider yang menyediakan endpoint simulasi, dan hanya di test mode.
// ------------------------------------------------------------------
app.post('/admin/payments/simulate', async (c) => {
  const key = c.req.header('x-admin-key');
  if (!(await verifyAdminAccess(key, c.env.ADMIN_KEY))) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }
  if (!c.env.DB) {
    return c.json({ success: false, message: 'Database tidak tersedia' }, 500);
  }

  const { order_id } = await c.req.json().catch(() => ({}));
  if (!order_id) {
    return c.json({ success: false, message: 'order_id wajib diisi' }, 400);
  }

  const order: any = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order_id).first();
  if (!order) {
    return c.json({ success: false, message: 'Order tidak ditemukan' }, 404);
  }

  // Order lama yang belum di-tag provider dianggap Midtrans.
  const provider = await getProviderForOrder(c.env, order);
  if (!provider.simulate) {
    return c.json({
      success: false,
      message: `${provider.label} tidak menyediakan endpoint simulasi. Untuk Midtrans sandbox, pakai Payment Simulator resmi Midtrans.`,
    }, 400);
  }

  const result = await provider.simulate(c.env, order, Math.round(Number(order.total_amount)));
  if (!result.ok) {
    return c.json({ success: false, message: result.message }, 400);
  }

  return c.json({ success: true, message: result.message });
});

// ------------------------------------------------------------------
// GET /api/midtrans/qr?order_id=...
// Proxy gambar QRIS resmi dari Midtrans. Hanya dipakai bila provider aktif
// adalah Midtrans; Xendit mengirim string QR yang dirender di frontend.
//
// Proxy ini penting karena URL QR Midtrans tidak selalu mengirim header CORS,
// sehingga browser bisa gagal saat mengunduh gambarnya.
// ------------------------------------------------------------------
app.get('/midtrans/qr', async (c) => {
  const orderId = c.req.query('order_id');
  if (!orderId || !c.env.DB) {
    return c.json({ success: false, message: 'order_id wajib diisi' }, 400);
  }

  const order: any = await c.env.DB
    .prepare('SELECT midtrans_qr_url, payment_external_id FROM orders WHERE id = ?')
    .bind(orderId)
    .first();

  if (!order?.midtrans_qr_url) {
    return c.json({ success: false, message: 'Transaksi QR untuk order ini belum dibuat' }, 404);
  }

  const envKey = String(c.env.MIDTRANS_SERVER_KEY || '').trim();
  const storedKey = (await getSetting(c.env, 'MIDTRANS_SERVER_KEY')).trim();
  const serverKey = storedKey || envKey;
  if (!serverKey) {
    return c.json({ success: false, message: 'Server Key Midtrans belum diatur' }, 500);
  }

  const auth = `Basic ${btoa(`${serverKey}:`)}`;

  // Sumber utama: URL yang disimpan saat charge berhasil. Ini membuat QR tetap
  // tampil walau panggilan status ke Midtrans sedang gagal.
  const candidates: string[] = [order.midtrans_qr_url];

  // Cadangan: tanya status ke Midtrans untuk menemukan URL QR yang lebih
  // baru, sekaligus menolak QR yang transaksinya sudah tidak aktif.
  try {
    const externalId = order.payment_external_id || order.midtrans_order_id;
    if (externalId) {
      const baseUrl = await getMidtransBaseUrl(c.env);
      const res = await fetch(`${baseUrl}/v2/${externalId}/status`, {
        headers: { Accept: 'application/json', Authorization: auth },
      });
      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        if (data?.transaction_status && data.transaction_status !== 'pending') {
          return c.json({
            success: false,
            message: `Transaksi sudah berstatus "${data.transaction_status}".`,
            transaction_status: data.transaction_status,
          }, 409);
        }
        for (const action of data?.actions || []) {
          if ((action?.name === 'generate-qr-code' || action?.name === 'generate-qr-code-v2') && action?.url) {
            if (!candidates.includes(action.url)) candidates.push(action.url);
          }
        }
      }
    }
  } catch {
    // Status tidak bisa dicek: tetap layani QR dari URL yang tersimpan.
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
// Sinkronisasi status pembayaran ke D1.
//
// Status ditanyakan langsung ke gateway, bukan hanya mengandalkan webhook,
// sehingga layar pembeli tetap sampai ke "Berhasil" walau webhook belum
// terdaftar di dashboard gateway.
// ------------------------------------------------------------------
const syncOrderStatus = async (env: Bindings, order: any) => {
  let paymentStatus = order.payment_status || 'pending';
  let rawStatus: string | undefined;

  try {
    const provider = await getProviderForOrder(env, order);
    const result = await provider.fetchStatus(env, order);
    if (result) {
      rawStatus = result.rawStatus;
      if (result.state !== paymentStatus && env.DB) {
        paymentStatus = result.state;
        await env.DB.prepare('UPDATE orders SET payment_status = ? WHERE id = ?')
          .bind(paymentStatus, order.id)
          .run();
      }
    }
  } catch {
    // Jaringan ke gateway gagal: andalkan nilai terakhir yang tersimpan di D1.
  }

  return { payment_status: paymentStatus, transaction_status: rawStatus || null, provider: order.payment_provider || 'midtrans' };
};

app.get('/payments/status', async (c) => {
  const orderId = c.req.query('order_id');
  if (!orderId || !c.env.DB) {
    return c.json({ success: false, message: 'order_id wajib diisi' }, 400);
  }
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) {
    return c.json({ success: false, message: 'Order tidak ditemukan' }, 404);
  }
  return c.json({ success: true, ...(await syncOrderStatus(c.env, order)) });
});
app.get('/midtrans/status', (c) => c.redirect('/api/payments/status' + (c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '')));

// ------------------------------------------------------------------
// Webhook Midtrans
// ------------------------------------------------------------------
const handleMidtransNotification = async (c: any) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await midtransVerifyWebhook(c.env, body);

  if (!result.ok) {
    return c.json({ success: false, message: result.message }, result.status);
  }

  const paymentStatus = mapMidtransTransactionStatus(result.transactionStatus);
  if (paymentStatus && c.env.DB) {
    await c.env.DB.prepare(
      'UPDATE orders SET payment_status = ? WHERE payment_external_id = ? OR midtrans_order_id = ?'
    ).bind(paymentStatus, result.orderId, result.orderId).run();
  }

  return c.json({ success: true });
};

app.post('/midtrans/notification', handleMidtransNotification);
app.post('/midtrans-webhook', handleMidtransNotification);

// ------------------------------------------------------------------
// Webhook Xendit
//
// Xendit mengirim header x-callback-token bila callback token dikonfigurasi di
// Dashboard. Kalau token itu diset di sini, notifikasi yang tidak membawa
// token yang sama akan ditolak.
// ------------------------------------------------------------------
app.post('/payments/notification', async (c) => {
  const expectedToken = (await getSetting(c.env, 'XENDIT_CALLBACK_TOKEN')) || c.env.XENDIT_CALLBACK_TOKEN || '';
  const receivedToken = c.req.header('x-callback-token') || c.req.header('x-callback-fingerprint') || '';

  if (expectedToken && receivedToken !== expectedToken) {
    return c.json({ success: false, message: 'Invalid callback token' }, 403);
  }

  const body: any = await c.req.json().catch(() => ({}));
  const referenceId = String(body?.reference_id || body?.data?.reference_id || '');
  const status = String(body?.status || body?.data?.status || '');

  const state = (() => {
    switch (status) {
      case 'SUCCEEDED':
      case 'CAPTURED':
        return 'settlement';
      case 'EXPIRED':
      case 'CANCELLED':
      case 'FAILED':
        return 'failed';
      default:
        return 'pending';
    }
  })();

  if (referenceId && state && c.env.DB) {
    await c.env.DB.prepare(
      "UPDATE orders SET payment_status = ? WHERE payment_provider = 'xendit' AND payment_external_id = ?"
    ).bind(state, referenceId).run();
  }

  return c.json({ success: true });
});

// ------------------------------------------------------------------
// GET /api/orders/:id/status
// Dipakai frontend untuk polling status pembayaran sambil pembeli
// menunggu di layar QR/VA.
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
