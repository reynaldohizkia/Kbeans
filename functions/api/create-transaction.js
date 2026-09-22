// functions/api/create-transaction.js
// Route: POST /api/create-transaction
//
// Menggantikan `midtrans-client` (SDK Node.js) dengan panggilan REST API
// langsung via fetch(), supaya kompatibel dengan runtime Cloudflare
// Workers/Pages Functions (V8 isolate, bukan Node.js penuh).
//
// Env vars yang perlu di-set di Cloudflare Pages > Settings > Environment variables:
//   MIDTRANS_SERVER_KEY   -> server key dari dashboard Midtrans
//   MIDTRANS_IS_PRODUCTION -> "true" atau "false" (string)
//
// Opsional (kalau mau simpan status order):
//   ORDERS_KV -> KV namespace binding untuk menyimpan status order

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { orderId, grossAmount, items, customer } = body;

    // Validasi input dasar
    if (!orderId || !grossAmount || !items || !customer) {
      return jsonResponse({ error: "Data tidak lengkap (orderId, grossAmount, items, customer wajib diisi)" }, 400);
    }

    const serverKey = env.MIDTRANS_SERVER_KEY;
    if (!serverKey) {
      return jsonResponse({ error: "MIDTRANS_SERVER_KEY belum diset di environment variables" }, 500);
    }

    const isProduction = env.MIDTRANS_IS_PRODUCTION === "true";
    const snapUrl = isProduction
      ? "https://app.midtrans.com/snap/v1/transactions"
      : "https://app.sandbox.midtrans.com/snap/v1/transactions";

    // Basic Auth Midtrans: base64(server_key + ":")
    // Pakai btoa() bawaan Workers, bukan Buffer.from(...).toString('base64') dari Node
    const authHeader = "Basic " + btoa(`${serverKey}:`);

    const payload = {
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount,
      },
      item_details: items,
      customer_details: customer,
    };

    const midtransRes = await fetch(snapUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify(payload),
    });

    const data = await midtransRes.json();

    if (!midtransRes.ok) {
      return jsonResponse({ error: "Gagal membuat transaksi di Midtrans", detail: data }, midtransRes.status);
    }

    // Simpan order sebagai "pending" ke KV kalau binding-nya ada
    if (env.ORDERS_KV) {
      await env.ORDERS_KV.put(
        `order:${orderId}`,
        JSON.stringify({
          status: "pending",
          grossAmount,
          items,
          customer,
          createdAt: new Date().toISOString(),
        })
      );
    }

    // token dipakai frontend untuk window.snap.pay(token)
    // redirect_url dipakai kalau mau redirect penuh (bukan popup)
    return jsonResponse({ token: data.token, redirect_url: data.redirect_url }, 200);

  } catch (err) {
    return jsonResponse({ error: "Server error", detail: String(err) }, 500);
  }
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
