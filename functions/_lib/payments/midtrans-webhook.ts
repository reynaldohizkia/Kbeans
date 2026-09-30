// Verifikasi notifikasi Midtrans (webhook).
//
// Notifikasi hanya diterima kalau signature-nya cocok dengan
// SHA-512(order_id + status_code + gross_amount + server_key). Tanpa ini,
// siapa pun bisa mengirim POST palsu untuk menandai order lunas.

import type { Env } from './types';
import { getSetting } from './settings';

const BASE_URL: Record<'production' | 'sandbox', string> = {
  production: 'https://api.midtrans.com',
  sandbox: 'https://api.sandbox.midtrans.com',
};

const detectMode = (key: string): 'production' | 'sandbox' | null => {
  const k = key.trim();
  if (!k) return null;
  if (/^SB-Mid-server-/i.test(k)) return 'sandbox';
  if (/^(SK-)?Mid-server-/i.test(k)) return 'production';
  return null;
};

export async function getMidtransServerKey(env: Env): Promise<string> {
  const envKey = (env.MIDTRANS_SERVER_KEY || '').trim();
  const dbKey = (await getSetting(env, 'MIDTRANS_SERVER_KEY')).trim();
  return dbKey || envKey;
}

/** Environment aktif, dipakai untuk memanggil API status. */
export async function getMidtransBaseUrl(env: Env): Promise<string> {
  const key = await getMidtransServerKey(env);
  const stored = ((await getSetting(env, 'MIDTRANS_MODE')) || env.MIDTRANS_MODE || '').trim().toLowerCase();
  const mode = detectMode(key) || (stored === 'sandbox' ? 'sandbox' : 'production');
  return BASE_URL[mode];
}

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

export async function signMidtransPayload(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string
): Promise<string> {
  const raw = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  return toHex(await crypto.subtle.digest('SHA-512', new TextEncoder().encode(raw)));
}

export type WebhookResult =
  | { ok: true; orderId: string; statusCode: string; transactionStatus: string }
  | { ok: false; status: number; message: string };

export async function midtransVerifyWebhook(
  env: Env,
  body: any
): Promise<WebhookResult> {
  const { order_id, status_code, gross_amount, signature_key, transaction_status } = body || {};

  if (!order_id || !signature_key) {
    return { ok: false, status: 400, message: 'Payload notifikasi tidak lengkap' };
  }

  const serverKey = await getMidtransServerKey(env);
  if (!serverKey) {
    return { ok: false, status: 500, message: 'Server Key belum diset' };
  }

  const expected = await signMidtransPayload(
    String(order_id),
    String(status_code),
    String(gross_amount),
    serverKey
  );

  if (expected !== signature_key) {
    return { ok: false, status: 403, message: 'Invalid signature' };
  }

  return {
    ok: true,
    orderId: String(order_id),
    statusCode: String(status_code),
    transactionStatus: String(transaction_status || ''),
  };
}

/** Terjemahkan transaction_status Midtrans ke status order di aplikasi. */
export function mapMidtransTransactionStatus(transactionStatus: string | undefined): string | null {
  if (!transactionStatus) return null;
  if (transactionStatus === 'settlement' || transactionStatus === 'capture') return 'settlement';
  if (['deny', 'cancel', 'expire', 'failure', 'refund', 'partial_refund'].includes(transactionStatus)) {
    return 'failed';
  }
  if (transactionStatus === 'pending') return 'pending';
  return null;
}
