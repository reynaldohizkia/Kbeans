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

// ------------------------------------------------------------------
// GET /api/admin/orders
// Daftar semua transaksi untuk dashboard admin. Dilindungi header
// x-admin-key yang harus cocok dengan secret ADMIN_KEY di Cloudflare.
// ------------------------------------------------------------------
app.get('/admin/orders', async (c) => {
  const key = c.req.header('x-admin-key');
  if (!c.env.ADMIN_KEY || key !== c.env.ADMIN_KEY) {
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
// Update status pesanan (diproses/dikirim/selesai/dibatalkan) dari admin.
// ------------------------------------------------------------------
app.patch('/admin/orders/:id/status', async (c) => {
  const key = c.req.header('x-admin-key');
  if (!c.env.ADMIN_KEY || key !== c.env.ADMIN_KEY) {
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
// Membuat transaksi SUNGGUHAN di Midtrans (Core API) untuk order yang
// baru dibuat, lalu mengembalikan info pembayaran (QR/VA) ke frontend.
// ------------------------------------------------------------------
app.post('/midtrans/charge', async (c) => {
  try {
    const { order_id, payment_method } = await c.req.json();

    if (!c.env.DB || !c.env.MIDTRANS_SERVER_KEY) {
      return c.json({ success: false, message: 'Konfigurasi Midtrans belum lengkap' }, 500);
    }

    const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order_id).first();
    if (!order) {
      return c.json({ success: false, message: 'Order tidak ditemukan' }, 404);
    }

    // Midtrans mewajibkan order_id unik yang belum pernah dipakai. Karena
    // order_id lokal kita (ORD-timestamp) bisa dipakai retry, kita tempel
    // suffix waktu supaya selalu unik tiap kali charge dibuat.
    const midtransOrderId = `${order.order_number}-${Date.now()}`;

    let payload: Record<string, unknown> = {
      payment_type: payment_method === 'bca_va' ? 'bank_transfer' : 'gopay',
      transaction_details: {
        order_id: midtransOrderId,
        gross_amount: order.total_amount,
      },
    };

    if (payment_method === 'bca_va') {
      payload.bank_transfer = { bank: 'bca' };
    }
    // Catatan: kita pakai payment_type "gopay" (bukan "qris") karena channel
    // GoPay hampir selalu aktif otomatis di akun Sandbox baru tanpa perlu
    // approval tambahan, sementara "qris" murni kadang butuh aktivasi manual
    // yang tidak selalu tersedia. Dari sisi pembeli, hasilnya sama: QR code
    // yang bisa di-scan lewat aplikasi e-wallet apa pun yang mendukung QRIS.

    const auth = btoa(`${c.env.MIDTRANS_SERVER_KEY}:`);

    let midtransRes: Response;
    try {
      midtransRes = await fetch('https://api.sandbox.midtrans.com/v2/charge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (fetchErr: any) {
      return c.json({ success: false, message: `Gagal menghubungi Midtrans: ${fetchErr?.message || 'network error'}` }, 502);
    }

    const midtransData: any = await midtransRes.json().catch(() => ({}));

    // PENTING: Midtrans sering membalas dengan HTTP 200/201 meski transaksi
    // sebenarnya GAGAL di level bisnis -- status aslinya ada di field
    // status_code di dalam body ("200"/"201" = sukses, selain itu = gagal).
    const isBusinessSuccess = ['200', '201'].includes(String(midtransData.status_code));

    if (!midtransRes.ok || !isBusinessSuccess) {
      return c.json(
        {
          success: false,
          message: midtransData.status_message || `Midtrans menolak transaksi (status_code: ${midtransData.status_code})`,
          debug: midtransData,
        },
        500
      );
    }

    // Simpan referensi transaksi Midtrans supaya webhook nanti bisa
    // mencocokkan notifikasi pembayaran ke order yang benar.
    await c.env.DB.prepare('UPDATE orders SET midtrans_order_id = ? WHERE id = ?')
      .bind(midtransOrderId, order_id)
      .run();

    if (payment_method === 'bca_va') {
      const vaNumber = midtransData.va_numbers?.[0]?.va_number;
      return c.json({ success: true, va_number: vaNumber, midtrans_order_id: midtransOrderId, debug: midtransData });
    }

    const qrAction = midtransData.actions?.find((a: any) => a.name === 'generate-qr-code');
    return c.json({ success: true, qr_url: qrAction?.url, midtrans_order_id: midtransOrderId, debug: midtransData });
  } catch (err: any) {
    return c.json({ success: false, message: `Error tak terduga: ${err?.message || String(err)}` }, 500);
  }
});

// ------------------------------------------------------------------
// POST /api/midtrans/notification
// Webhook resmi Midtrans -- dipanggil otomatis oleh server Midtrans
// setiap status transaksi berubah (pending/settlement/expire/dll).
// URL ini yang didaftarkan di Midtrans Dashboard > Settings > Configuration.
// ------------------------------------------------------------------
app.post('/midtrans/notification', async (c) => {
  const body: any = await c.req.json();
  const { order_id, status_code, gross_amount, signature_key, transaction_status } = body;

  if (!c.env.MIDTRANS_SERVER_KEY) {
    return c.json({ success: false }, 500);
  }

  // Verifikasi signature supaya notifikasi ini benar-benar dari Midtrans,
  // bukan orang lain yang berpura-pura mengirim status "sudah bayar".
  const raw = `${order_id}${status_code}${gross_amount}${c.env.MIDTRANS_SERVER_KEY}`;
  const hashBuffer = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(raw));
  const computedSignature = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (computedSignature !== signature_key) {
    return c.json({ success: false, message: 'Invalid signature' }, 403);
  }

  let paymentStatus = 'pending';
  if (transaction_status === 'settlement' || transaction_status === 'capture') paymentStatus = 'settlement';
  else if (['deny', 'cancel', 'expire', 'failure'].includes(transaction_status)) paymentStatus = 'failed';

  if (c.env.DB) {
    await c.env.DB.prepare('UPDATE orders SET payment_status = ? WHERE midtrans_order_id = ?')
      .bind(paymentStatus, order_id)
      .run();
  }

  return c.json({ success: true });
});

// ------------------------------------------------------------------
// GET /api/orders/:id/status
// Dipakai frontend untuk polling status pembayaran sambil pembeli
// menunggu di layar QR/VA, tanpa perlu tombol simulasi manual lagi.
// ------------------------------------------------------------------
app.get('/orders/:id/status', async (c) => {
  const id = c.req.param('id');
  if (c.env.DB) {
    const order = await c.env.DB.prepare('SELECT payment_status FROM orders WHERE id = ?').bind(id).first();
    return c.json({ success: true, payment_status: order?.payment_status || 'pending' });
  }
  return c.json({ success: true, payment_status: 'pending' });
});

// ------------------------------------------------------------------
// POST /api/midtrans/simulate-payment
// Simulasi webhook Midtrans: mengubah status order dari 'pending'
// menjadi 'settlement' saat tombol "Simulate Payment" diklik.
// ------------------------------------------------------------------
app.post('/midtrans/simulate-payment', async (c) => {
  const { order_id } = await c.req.json();

  if (c.env.DB && order_id) {
    await c.env.DB.prepare(
      "UPDATE orders SET payment_status = 'settlement' WHERE id = ?"
    ).bind(order_id).run();
  }

  return c.json({ success: true, payment_status: 'settlement' });
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
