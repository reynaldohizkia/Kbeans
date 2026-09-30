// Xendit Payments API v3.
//
// Dipilih karena sandbox-nya tidak perlu aktivasi manual: seluruh payment
// channel tersedia di test mode begitu akun dibuat, dan ada endpoint simulasi
// bawaan sehingga alur pembayaran bisa diuji tanpa uang asli dan tanpa
// website simulator eksternal.
//
// Docs: https://docs.xendit.co/apidocs/create-payment-request

import type {
  CreatePaymentArgs,
  CreatePaymentResult,
  Env,
  PaymentProvider,
  PaymentState,
  StatusResult,
  VerifyResult,
} from './types';
import { getSetting, maskSecret, sha256Hex } from './settings';

const BASE_URL = 'https://api.xendit.co';
const API_VERSION = '2024-11-11';

const KEY_SETTING = 'XENDIT_SECRET_KEY';
const VERIFIED_FINGERPRINT = 'XENDIT_VERIFIED_KEY';

// Batas nominal QRIS versi Xendit: Rp1 sampai Rp10.000.000.
const QRIS_MIN = 1;
const QRIS_MAX = 10_000_000;

type Mode = 'test' | 'live';

const detectMode = (key: string): Mode | null => {
  const k = key.trim();
  if (!k) return null;
  if (k.startsWith('xnd_development_')) return 'test';
  if (k.startsWith('xnd_production_')) return 'live';
  return null;
};

const authHeader = (key: string) => `Basic ${btoa(`${key}:`)}`;

const headers = (key: string) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Authorization: authHeader(key),
  'api-version': API_VERSION,
});

const resolveKey = async (env: Env): Promise<{ key: string; source: string }> => {
  const envKey = (env.XENDIT_SECRET_KEY || '').trim();
  const dbKey = (await getSetting(env, KEY_SETTING)).trim();
  return { key: dbKey || envKey, source: dbKey ? 'Database Settings' : envKey ? 'Cloudflare Environment' : 'Belum Diatur' };
};

/**
 * Ambil nilai dari `actions` sesuai descriptor. QRIS dikembalikan sebagai
 * string EMVCo (descriptor QR_STRING), sedangkan Virtual Account dikembalikan
 * sebagai nomor VA (descriptor VIRTUAL_ACCOUNT_NUMBER).
 */
const findActionValue = (actions: any[] | undefined, descriptor: string): string => {
  if (!Array.isArray(actions)) return '';
  const match = actions.find((a) => a?.descriptor === descriptor);
  return match?.value ? String(match.value) : '';
};

const mapStatus = (raw: string | undefined): PaymentState => {
  switch (raw) {
    case 'SUCCEEDED':
    case 'CAPTURED':
      return 'settlement';
    case 'EXPIRED':
    case 'CANCELLED':
    case 'FAILED':
      return 'failed';
    default:
      // PENDING, REQUIRES_ACTION, AUTHORIZED, dan lainnya masih menunggu.
      return 'pending';
  }
};

export const xenditProvider: PaymentProvider = {
  id: 'xendit',
  label: 'Xendit',
  keyHint: 'xnd_development_… (test) atau xnd_production_… (live)',

  async hasKey(env) {
    return !!(await resolveKey(env)).key;
  },

  async maskedKey(env) {
    return maskSecret((await resolveKey(env)).key);
  },

  async keySource(env) {
    return (await resolveKey(env)).source;
  },

  async describe(env) {
    const { key, source } = await resolveKey(env);
    const detected = detectMode(key);
    const storedFingerprint = await getSetting(env, VERIFIED_FINGERPRINT);
    const verified = !!key && !!storedFingerprint && storedFingerprint === await sha256Hex(key);
    const mode: Mode = detected || 'test';
    return {
      mode,
      baseUrl: BASE_URL,
      source: verified ? 'terverifikasi ke Xendit' : detected ? 'deteksi awalan Secret Key' : source,
      verified,
    };
  },

  async verifyKey(_env, key): Promise<VerifyResult> {
    const detected = detectMode(key);
    if (!detected) {
      return {
        ok: false,
        detail: 'format tidak dikenal',
        notes: [
          'Secret Key Xendit harus berawalan xnd_development_ (test) atau xnd_production_ (live). '
          + 'Ambil dari Dashboard > Settings > API Keys.',
        ],
      };
    }

    // Endpoint yang murah dan hanya butuh scope read: mengambil balance.
    try {
      const res = await fetch(`${BASE_URL}/balance`, { headers: headers(key) });
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          detail: `HTTP ${res.status}`,
          notes: ['Xendit menolak Secret Key ini. Pastikan Anda menyalin Secret API Key (prefix xnd_development_ / xnd_production_), bukan Public Key.'],
        };
      }
      if (!res.ok) {
        return {
          ok: true,
          detail: `HTTP ${res.status}`,
          mode: detected,
          notes: ['Key diterima, tapi endpoint balance tidak merespons normal. Coba lagi saat menjawabannya akan dipakai.'],
        };
      }
    } catch (err: any) {
      return {
        ok: false,
        detail: err?.message || 'Network error',
        notes: ['Tidak bisa menghubungi server Xendit untuk memverifikasi key. Coba lagi beberapa saat lagi.'],
      };
    }

    return {
      ok: true,
      detail: '',
      mode: detected,
      notes:
        detected === 'test'
          ? ['Mode TEST: seluruh channel aktif dan pembayaran bisa disimulasikan tanpa uang asli.']
          : ['Mode LIVE: pembayaran memakai uang sungguhan. Pastikan testing sudah selesai sebelum menyimpan key ini.'],
    };
  },

  async createPayment({ env, order, method, referenceId, origin }: CreatePaymentArgs): Promise<CreatePaymentResult> {
    const { key } = await resolveKey(env);
    if (!key) {
      return {
        ok: false,
        message: 'Xendit Secret Key belum diatur. Buka Dashboard Admin > Pengaturan Pembayaran.',
      };
    }

    const amount = Math.round(Number(order.total_amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, message: `Total pembayaran tidak valid. Nilai: ${amount}.` };
    }

    const isVA = method === 'bca_va';
    if (isVA ? false : amount < QRIS_MIN || amount > QRIS_MAX) {
      return {
        ok: false,
        message: `QRIS Xendit menerima Rp${QRIS_MIN.toLocaleString('id-ID')} sampai Rp${QRIS_MAX.toLocaleString('id-ID')}. Nilai order: Rp${amount.toLocaleString('id-ID')}.`,
      };
    }

    const channelCode = isVA ? 'BCA_VA' : 'QRIS';
    const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    const channelProperties: Record<string, any> = { expires_at: expiresAt };
    if (!isVA) channelProperties.qr_string_type = 'DYNAMIC';

    const body: Record<string, any> = {
      reference_id: referenceId,
      type: 'PAY',
      country: 'ID',
      currency: 'IDR',
      channel_code: channelCode,
      request_amount: amount,
      capture_method: 'AUTOMATIC',
      description: `Kbeans ${order.order_number}`,
      channel_properties: {
        ...channelProperties,
        success_return_url: `${origin}/?payment=success`,
        failure_return_url: `${origin}/?payment=failed`,
      },
      metadata: { order_id: order.id, order_number: order.order_number },
    };

    let res: Response;
    let data: any;
    try {
      res = await fetch(`${BASE_URL}/v3/payment_requests`, {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify(body),
      });
      data = await res.json().catch(() => ({}));
    } catch (err: any) {
      return { ok: false, message: `Gagal menghubungi server Xendit: ${err?.message || 'Network error'}` };
    }

    if (res.status !== 201 && !data?.payment_request_id) {
      return {
        ok: false,
        message: data?.message || `Xendit menolak permintaan (HTTP ${res.status}).`,
        hint: data?.error_code
          ? `Kode error Xendit: ${data.error_code}.`
          : 'Pastikan channel QRIS / Virtual Account aktif di Dashboard > Payment Channels.',
      };
    }

    const paymentRequestId: string = data.payment_request_id;
    const mode = detectMode(key) === 'live' ? 'live' : 'test';
    const notes = mode === 'test'
      ? ['Mode TEST: QR tidak bisa dibayar e-wallet sungguhan, tetapi statusnya bisa disimulasikan dari Dashboard Admin.']
      : [];

    if (isVA) {
      const vaNumber = findActionValue(data.actions, 'VIRTUAL_ACCOUNT_NUMBER');
      if (!vaNumber) {
        return { ok: false, message: 'Xendit tidak mengembalikan nomor Virtual Account untuk transaksi ini.' };
      }
      return {
        ok: true,
        instruction: { externalId: paymentRequestId, vaNumber, vaBank: 'BCA', expiresAt, amount, notes },
      };
    }

    const qrString = findActionValue(data.actions, 'QR_STRING');
    if (!qrString) {
      return {
        ok: false,
        message: 'Xendit tidak mengembalikan string QRIS untuk transaksi ini.',
        hint: 'Pastikan channel QRIS aktif di Dashboard > Payment Channels.',
      };
    }

    return {
      ok: true,
      instruction: { externalId: paymentRequestId, qrString, expiresAt, amount, notes },
    };
  },

  async fetchStatus(env, order): Promise<StatusResult | null> {
    const { key } = await resolveKey(env);
    const externalId = order.payment_external_id;
    if (!key || !externalId) return null;

    try {
      const res = await fetch(`${BASE_URL}/v3/payment_requests/${encodeURIComponent(externalId)}`, {
        headers: headers(key),
      });
      if (!res.ok) return null;
      const data: any = await res.json().catch(() => ({}));
      if (!data?.status) return null;
      return { state: mapStatus(data.status), rawStatus: data.status };
    } catch {
      return null;
    }
  },

  async simulate(env, order, amount) {
    const { key } = await resolveKey(env);
    const externalId = order.payment_external_id;
    if (!key || !externalId) {
      return { ok: false, message: 'Transaksi Xendit untuk order ini belum dibuat.' };
    }
    if (detectMode(key) !== 'test') {
      return { ok: false, message: 'Simulasi hanya tersedia di mode TEST. Production key memakai uang sungguhan.' };
    }

    try {
      const res = await fetch(`${BASE_URL}/v3/payment_requests/${encodeURIComponent(externalId)}/simulate`, {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify({ amount }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) {
        return { ok: true, message: data?.message || 'Simulasi dikirim. Status akan berubah dalam beberapa detik.' };
      }
      return { ok: false, message: data?.message || `Xendit menolak simulasi (HTTP ${res.status}).` };
    } catch (err: any) {
      return { ok: false, message: `Gagal menghubungi Xendit: ${err?.message || 'Network error'}` };
    }
  },
};
