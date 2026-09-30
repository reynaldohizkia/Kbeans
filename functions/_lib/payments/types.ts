// Kontrak bersama untuk semua payment provider.
//
// Tujuannya satu: menambah atau mengganti payment gateway tidak boleh
// menyentuh route handler maupun komponen React. Route hanya berbicara ke
// interface ini, jadi pindah gateway cukup menulis satu file baru.

export type PaymentMethod = 'qris' | 'bca_va' | 'credit_card';
export type ProviderId = 'midtrans' | 'xendit';
export type PaymentState = 'pending' | 'settlement' | 'failed';

export interface Env {
  DB?: any;
  [key: string]: any;
}

export interface OrderRow {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  total_amount: number;
  payment_provider?: string;
  payment_external_id?: string;
  midtrans_order_id?: string;
  midtrans_qr_url?: string;
  payment_status?: string;
}

export interface CreatePaymentArgs {
  env: Env;
  order: OrderRow;
  method: PaymentMethod;
  /** reference id unik untuk gateway (dipakai juga untuk idempotensi) */
  referenceId: string;
  /** origin aplikasi, dipakai untuk callback/webhook URL */
  origin: string;
}

export interface PaymentInstruction {
  /** ID transaksi di sisi gateway, dipakai untuk cek status */
  externalId: string;
  /**
   * String QRIS (EMVCo) asli dari gateway. Frontend yang merender-nya, jadi
   * tidak perlu layanan pihak ketiga dan tidak ada CORS.
   */
  qrString?: string;
  /** URL gambar QR resmi dari gateway (dipakai Midtrans). */
  qrImageUrl?: string;
  vaNumber?: string;
  vaBank?: string;
  expiresAt?: string;
  amount: number;
  /** pesan tambahan untuk ditampilkan ke pengguna, mis. "mode test" */
  notes?: string[];
}

export type CreatePaymentResult =
  | { ok: true; instruction: PaymentInstruction }
  | { ok: false; message: string; hint?: string; failures?: string[] };

export interface StatusResult {
  state: PaymentState;
  rawStatus?: string;
}

export interface VerifyResult {
  ok: boolean;
  detail: string;
  /** environment yang terdeteksi, mis. 'sandbox' / 'production' / 'test' */
  mode?: string;
  notes?: string[];
}

export interface PaymentProvider {
  id: ProviderId;
  label: string;
  /** contoh format key, ditampilkan di Panel Admin */
  keyHint: string;
  /** apakah provider ini punya key yang tersimpan */
  hasKey(env: Env): Promise<boolean>;
  /** masked key untuk ditampilkan di Panel Admin */
  maskedKey(env: Env): Promise<string>;
  /** sumber key: env Cloudflare atau Database Settings */
  keySource(env: Env): Promise<string>;
  createPayment(args: CreatePaymentArgs): Promise<CreatePaymentResult>;
  /** status terbaru dari gateway; null kalau tidak bisa dicek */
  fetchStatus(env: Env, order: OrderRow): Promise<StatusResult | null>;
  /** memvalidasi key sebelum disimpan; dipakai Panel Admin "Simpan & Uji" */
  verifyKey(env: Env, key: string, opts?: Record<string, any>): Promise<VerifyResult>;
  /** environment aktif untuk ditampilkan di Panel Admin */
  describe(env: Env): Promise<{ mode: string; baseUrl: string; source: string; verified: boolean }>;
  /** hanya tersedia di test mode: menandai pembayaran lunas */
  simulate?(env: Env, order: OrderRow, amount: number): Promise<{ ok: boolean; message: string }>;
}
