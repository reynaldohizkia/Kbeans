// functions/api/midtrans-webhook.js
// Route: POST /api/midtrans-webhook
//
// Daftarkan URL ini (https://domainmu.pages.dev/api/midtrans-webhook)
// sebagai "Payment Notification URL" di dashboard Midtrans:
// Settings > Configuration > Notification URL.
//
// Verifikasi signature pakai Web Crypto API (crypto.subtle), pengganti
// modul `crypto` Node.js yang tidak tersedia penuh di Workers runtime.
//
// Rumus signature Midtrans:
//   SHA512(order_id + status_code + gross_amount + server_key)

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const notification = await request.json();
    const {
      order_id,
      status_code,
      gross_amount,
      signature_key,
      transaction_status,
      fraud_status,
    } = notification;

    const serverKey = env.MIDTRANS_SERVER_KEY;
    if (!serverKey) {
      return jsonResponse({ error: "MIDTRANS_SERVER_KEY belum diset" }, 500);
    }

    const expectedSignature = await sha512Hex(order_id + status_code + gross_amount + serverKey);

    if (expectedSignature !== signature_key) {
      // Signature tidak cocok -> kemungkinan bukan request asli dari Midtrans
      return jsonResponse({ error: "Signature tidak valid" }, 403);
    }

    // Tentukan status order berdasarkan transaction_status
    let newStatus = "pending";
    if (transaction_status === "capture" || transaction_status === "settlement") {
      newStatus = (!fraud_status || fraud_status === "accept") ? "paid" : "pending_review";
    } else if (["cancel", "deny", "expire"].includes(transaction_status)) {
      newStatus = "failed";
    } else if (transaction_status === "pending") {
      newStatus = "pending";
    }

    // Update status order di KV kalau binding-nya ada
    if (env.ORDERS_KV) {
      const existingRaw = await env.ORDERS_KV.get(`order:${order_id}`);
      const orderData = existingRaw ? JSON.parse(existingRaw) : {};
      orderData.status = newStatus;
      orderData.transactionStatus = transaction_status;
      orderData.updatedAt = new Date().toISOString();
      await env.ORDERS_KV.put(`order:${order_id}`, JSON.stringify(orderData));
    }

    // Midtrans hanya butuh respons 200 OK, isi body bebas
    return jsonResponse({ received: true }, 200);

  } catch (err) {
    return jsonResponse({ error: "Server error", detail: String(err) }, 500);
  }
}

async function sha512Hex(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-512", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
