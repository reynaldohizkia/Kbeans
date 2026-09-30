// Midtrans Core API. Provider bawaan Kbeans.
//
// Catatan penting: mode environment TIDAK boleh ditebak dari prefix key saja.
// Key sandbox versi lama berformat 'Mid-server-...' sama persis dengan key
// production, jadi key selalu diuji ke kedua environment dan yang dipakai
// adalah yang benar-benar menerimanya.

import type {
  CreatePaymentArgs,
  CreatePaymentResult,
  Env,
  PaymentProvider,
  PaymentState,
  StatusResult,
} from './types';
import { getSetting, maskSecret, setSetting, sha256Hex } from './settings';

type Mode = 'production' | 'sandbox';

const BASE_URL: Record<Mode, string> = {
  production: 'https://api.midtrans.com',
  sandbox: 'https://api.sandbox.midtrans.com',
};

const KEY_SETTING = 'MIDTRANS_SERVER_KEY';
const MODE_SETTING = 'MIDTRANS_MODE';
const ACQUIRER_SETTING = 'MIDTRANS_QRIS_ACQUIRER';
const VERIFIED_FINGERPRINT = 'MIDTRANS_VERIFIED_KEY';

const ACQUIRERS = ['gopay', 'airpay shopee'] as const;

const detectMode = (key: string): Mode | null => {
  const k = key.trim();
  if (!k) return null;
  if (/^SB-Mid-server-/i.test(k)) return 'sandbox';
  if (/^(SK-)?Mid-server-/i.test(k)) return 'production';
  return null;
};

const authHeader = (key: string) => `Basic ${btoa(`${key}:`)}`;

const jsonHeaders = (key: string) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Authorization: authHeader(key),
});

interface ResolvedConfig {
  serverKey: string;
  mode: Mode;
  baseUrl: string;
  acquirer: string;
  keySource: string;
  modeSource: string;
  verified: boolean;
}

const resolveConfig = async (env: Env): Promise<ResolvedConfig> => {
  const envKey = (env.MIDTRANS_SERVER_KEY || '').trim();
  const dbKey = (await getSetting(env, KEY_SETTING)).trim();
  const serverKey = dbKey || envKey;

  const storedMode = ((await getSetting(env, MODE_SETTING)) || env.MIDTRANS_MODE || '').trim().toLowerCase();
  const storedIsValid = storedMode === 'sandbox' || storedMode === 'production';
  const fallback: Mode = storedMode === 'sandbox' ? 'sandbox' : 'production';

  const storedFingerprint = await getSetting(env, VERIFIED_FINGERPRINT);
  const verified = !!serverKey && !!storedFingerprint && storedFingerprint === await sha256Hex(serverKey);

  const detected = detectMode(serverKey);
  const mode = verified && storedIsValid ? (storedMode as Mode) : detected || fallback;

  const storedAcquirer = ((await getSetting(env, ACQUIRER_SETTING)) || env.MIDTRANS_QRIS_ACQUIRER || '')
    .trim()
    .toLowerCase();
  const acquirer = (ACQUIRERS as readonly string[]).includes(storedAcquirer) ? storedAcquirer : ACQUIRERS[0];

  return {
    serverKey,
    mode,
    baseUrl: BASE_URL[mode],
    acquirer,
    keySource: dbKey ? 'Database Settings' : envKey ? 'Cloudflare Environment' : 'Belum Diatur',
    modeSource: verified ? 'terverifikasi ke Midtrans' : detected ? 'deteksi awalan Server Key' : 'pengaturan manual',
    verified,
  };
};

/** Hanya memvalidasi kredensial, tidak membuat transaksi apa pun. */
const verifyAgainst = async (mode: Mode, key: string): Promise<{ valid: boolean; detail: string }> => {
  const headers = { Accept: 'application/json', Authorization: authHeader(key) };
  const listRes = await fetch(`${BASE_URL[mode]}/v2/transactions?page=1&limit=1`, { headers });
  if (listRes.status === 401 || listRes.status === 403) {
    return { valid: false, detail: `HTTP ${listRes.status}` };
  }
  if (listRes.ok) return { valid: true, detail: '' };

  // Sebagian tipe akun tidak punya akses daftar transaksi; endpoint status
  // dipakai sebagai gantinya, dan di sini 404 justru tanda kredensial benar.
  const statusRes = await fetch(`${BASE_URL[mode]}/v2/kbeans-key-check/status`, { headers });
  if (statusRes.status === 401 || statusRes.status === 403) {
    return { valid: false, detail: `HTTP ${statusRes.status}` };
  }
  return { valid: true, detail: '' };
};

const mapStatus = (transactionStatus: string | undefined): PaymentState | null => {
  if (!transactionStatus) return null;
  if (transactionStatus === 'settlement' || transactionStatus === 'capture') return 'settlement';
  if (['deny', 'cancel', 'expire', 'failure', 'refund', 'partial_refund'].includes(transactionStatus)) {
    return 'failed';
  }
  return 'pending';
};

const stripSpecialChars = (value: string) => value.replace(/[^a-zA-Z0-9 .,'-]/g, ' ').trim();

export const midtransProvider: PaymentProvider = {
  id: 'midtrans',
  label: 'Midtrans',
  keyHint: 'SK-Mid-server-… (production) atau SB-Mid-server-… (sandbox)',

  async hasKey(env) {
    return !!(await resolveConfig(env)).serverKey;
  },

  async maskedKey(env) {
    return maskSecret((await resolveConfig(env)).serverKey);
  },

  async keySource(env) {
    return (await resolveConfig(env)).keySource;
  },

  async describe(env) {
    const cfg = await resolveConfig(env);
    return { mode: cfg.mode, baseUrl: cfg.baseUrl, source: cfg.modeSource, verified: cfg.verified };
  },

  async verifyKey(_env, key, opts) {
    const requested: Mode = String(opts?.mode).toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
    const detected = detectMode(key);
    const order: Mode[] = detected ? [detected, detected === 'production' ? 'sandbox' : 'production'] : [requested, requested === 'production' ? 'sandbox' : 'production'];

    const rejections: string[] = [];
    for (const mode of order) {
      const check = await verifyAgainst(mode, key);
      if (check.valid) {
        const notes: string[] = [];
        if (detected && detected !== mode) {
          notes.push(
            `Awalan key terlihat seperti ${detected}, tapi Midtrans hanya menerimanya di ${mode.toUpperCase()}. Mode disesuaikan otomatis.`
          );
        }
        if (mode === 'sandbox') {
          notes.push('Mode SANDBOX: transaksi tidak memakai uang asli dan hanya bisa disimulasikan lewat Midtrans Payment Simulator.');
        }
        return { ok: true, detail: '', mode, notes };
      }
      rejections.push(`${mode} (${check.detail})`);
    }

    return {
      ok: false,
      detail: rejections.join(', '),
      notes: ['Midtrans menolak Server Key ini di kedua environment. Salin ulang dari Dashboard > Settings > Access Keys.'],
    };
  },

  async createPayment({ env, order, method, referenceId }: CreatePaymentArgs): Promise<CreatePaymentResult> {
    const cfg = await resolveConfig(env);
    if (!cfg.serverKey) {
      return {
        ok: false,
        message: 'Server Key Midtrans belum diatur. Buka Dashboard Admin > Pengaturan Pembayaran.',
      };
    }

    const grossAmount = Math.round(Number(order.total_amount));
    if (!Number.isFinite(grossAmount) || grossAmount < 1000) {
      return { ok: false, message: `Total pembayaran tidak valid untuk Midtrans (minimal Rp1.000). Nilai: ${grossAmount}.` };
    }

    const cleanName = stripSpecialChars(order.customer_name || 'Pelanggan').slice(0, 40) || 'Pelanggan';
    const cleanPhone = String(order.customer_phone || '').replace(/[^0-9+]/g, '').slice(0, 20);
    const cleanEmail = order.customer_email ? stripSpecialChars(order.customer_email).slice(0, 50) : '';

    const transactionDetails = { order_id: referenceId, gross_amount: grossAmount };
    const customerDetails: Record<string, string> = {
      first_name: cleanName,
      ...(cleanPhone ? { phone: cleanPhone } : {}),
      ...(cleanEmail ? { email: cleanEmail } : {}),
    };

    const isVA = method === 'bca_va';
    const acquirerChain = [cfg.acquirer, ...ACQUIRERS.filter((a) => a !== cfg.acquirer)];
    const bankChain = ['bca', 'permata', 'mandiri'];

    const payloads: any[] = isVA
      ? bankChain.map((bank) => ({
          payment_type: 'bank_transfer',
          transaction_details: transactionDetails,
          bank_transfer: { bank },
          customer_details: customerDetails,
        }))
      : [
          ...acquirerChain.map((acquirer) => ({
            payment_type: 'qris',
            transaction_details: transactionDetails,
            qris: { acquirer },
            customer_details: customerDetails,
          })),
          // Tanpa acquirer: dipakai kalau akun memakai QRIS generik BI.
          { payment_type: 'qris', transaction_details: transactionDetails, customer_details: customerDetails },
        ];

    const failures: string[] = [];
    let success: any = null;

    for (const payload of payloads) {
      try {
        const res = await fetch(`${cfg.baseUrl}/v2/charge`, {
          method: 'POST',
          headers: jsonHeaders(cfg.serverKey),
          body: JSON.stringify(payload),
        });
        const data: any = await res.json().catch(() => ({}));

        if (['200', '201'].includes(String(data?.status_code))) {
          success = data;
          break;
        }

        failures.push(
          data?.status_message ||
            (res.status === 401 || res.status === 403
              ? 'Server Key ditolak oleh Midtrans (401/403).'
              : `Midtrans menolak transaksi (HTTP ${res.status}).`)
        );

        // Kalau transaksi sudah terlanjur dibuat (mis. 202 deny), jangan coba
        // lagi supaya tidak tercipta transaksi ganda untuk satu order.
        if (data?.transaction_id) break;
      } catch (err: any) {
        failures.push(`Gagal menghubungi server Midtrans (${cfg.baseUrl}): ${err?.message || 'Network error'}`);
      }
    }

    if (!success) {
      const unique = [...new Set(failures)];
      return {
        ok: false,
        message: unique[0] || 'Midtrans tidak memberikan respons.',
        failures: unique,
        hint:
          cfg.mode === 'production'
            ? 'Pastikan channel QRIS sudah aktif di Midtrans Dashboard > Settings > Payment Methods, dan acquirer (GoPay / AirPay Shopee) aktif untuk akun Anda.'
            : 'Channel ini belum diaktifkan di akun Midtrans Anda. Ajukan aktivasi ke support@midtrans.com, atau ganti provider ke Xendit yang sandbox-nya langsung aktif.',
      };
    }

    if (isVA) {
      const vaNumber =
        success.va_numbers?.[0]?.va_number || success.permata_va_number || success.bank_details?.va_number || '';
      if (!vaNumber) {
        return { ok: false, message: 'Midtrans membuat transaksi Virtual Account tanpa nomor VA. Coba muat ulang halaman.' };
      }
      return {
        ok: true,
        instruction: {
          externalId: referenceId,
          vaNumber,
          vaBank: success.bank_details?.bank || success.bank || success.permata_bank || '',
          expiresAt: success.expiry_time || success.va_expiration_time || '',
          amount: grossAmount,
          notes: cfg.mode === 'sandbox' ? ['Mode sandbox: pembayaran disimulasikan lewat Midtrans Payment Simulator.'] : [],
        },
      };
    }

    const qrAction =
      success.actions?.find((a: any) => a.name === 'generate-qr-code') ||
      success.actions?.find((a: any) => a.name === 'generate-qr-code-v2');

    if (!qrAction?.url) {
      return {
        ok: false,
        message: 'Midtrans tidak mengembalikan QR code untuk transaksi ini. Periksa apakah channel QRIS aktif di akun Anda.',
      };
    }

    return {
      ok: true,
      instruction: {
        externalId: referenceId,
        qrImageUrl: qrAction.url,
        expiresAt: success.expiry_time || '',
        amount: grossAmount,
        notes: cfg.mode === 'sandbox' ? ['Mode sandbox: QR hanya bisa dibayar lewat simulator, bukan e-wallet sungguhan.'] : [],
      },
    };
  },

  async fetchStatus(env, order): Promise<StatusResult | null> {
    const cfg = await resolveConfig(env);
    const externalId = order.payment_external_id || order.midtrans_order_id;
    if (!cfg.serverKey || !externalId) return null;

    try {
      const res = await fetch(`${cfg.baseUrl}/v2/${externalId}/status`, {
        headers: { Accept: 'application/json', Authorization: authHeader(cfg.serverKey) },
      });
      if (!res.ok) return null;
      const data: any = await res.json().catch(() => ({}));
      const state = mapStatus(data?.transaction_status);
      return state ? { state, rawStatus: data?.transaction_status } : null;
    } catch {
      return null;
    }
  },

  /** Dipanggil route Panel Admin setelah verifikasi berhasil. */
  async persistVerified(env: Env, key: string, opts: Record<string, any>) {
    const requested: Mode = String(opts?.mode).toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
    const detected = detectMode(key);
    const order: Mode[] = detected ? [detected, detected === 'production' ? 'sandbox' : 'production'] : [requested, requested === 'production' ? 'sandbox' : 'production'];

    for (const mode of order) {
      const check = await verifyAgainst(mode, key);
      if (!check.valid) continue;

      const envKey = (env.MIDTRANS_SERVER_KEY || '').trim();
      // Key dari form hanya disimpan kalau tidak ada key di env Cloudflare,
      // karena env var selalu menang saat dibaca.
      if (!envKey || key !== envKey) {
        await setSetting(env, KEY_SETTING, key);
      }
      await setSetting(env, MODE_SETTING, mode);

      const acquirer = String(opts?.qris_acquirer || '').trim().toLowerCase();
      if ((ACQUIRERS as readonly string[]).includes(acquirer)) {
        await setSetting(env, ACQUIRER_SETTING, acquirer);
      }
      await setSetting(env, VERIFIED_FINGERPRINT, await sha256Hex(key));
      return mode;
    }
    return null;
  },
} as PaymentProvider & { persistVerified: (env: Env, key: string, opts: Record<string, any>) => Promise<Mode | null> };
