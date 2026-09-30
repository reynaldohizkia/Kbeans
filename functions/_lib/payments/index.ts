// Registry payment provider. Satu-satunya tempat route perlu tahu
// provider apa saja yang tersedia.

import type { Env, ProviderId, PaymentProvider } from './types';
import { getActiveProviderId as getProviderId } from './settings';
import { midtransProvider } from './midtrans';
import { xenditProvider } from './xendit';

export const PAYMENT_PROVIDERS: Record<ProviderId, PaymentProvider> = {
  midtrans: midtransProvider,
  xendit: xenditProvider,
};

export const providerList = () =>
  (Object.keys(PAYMENT_PROVIDERS) as ProviderId[]).map((id) => ({
    id,
    label: PAYMENT_PROVIDERS[id].label,
    key_hint: PAYMENT_PROVIDERS[id].keyHint,
  }));

export const getActiveProviderId = (env: Env): Promise<ProviderId> => getProviderId(env);

export const getProvider = (id: ProviderId): PaymentProvider => PAYMENT_PROVIDERS[id];

export const getActiveProvider = async (env: Env): Promise<PaymentProvider> =>
  PAYMENT_PROVIDERS[await getProviderId(env)];

/**
 * Provider untuk sebuah order. Order lama yang belum punya
 * payment_provider dianggap memakai Midtrans, supaya riwayat transaksi
 * sebelumnya tetap bisa dicek statusnya.
 */
export const getProviderForOrder = async (_env: Env, order: any): Promise<PaymentProvider> => {
  const stored = String(order?.payment_provider || '').trim().toLowerCase();
  if (stored === 'xendit' || stored === 'midtrans') return PAYMENT_PROVIDERS[stored];
  return PAYMENT_PROVIDERS.midtrans;
};

export * from './types';
export { setActiveProviderId, getSetting, setSetting, sha256Hex, maskSecret } from './settings';
export { getMidtransServerKey, getMidtransBaseUrl } from './midtrans-webhook';
