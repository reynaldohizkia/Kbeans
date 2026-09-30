// Akses konfigurasi payment gateway (provider yang aktif, key, mode).
//
// Nilai disimpan di tabel `settings` (D1) dan didahulukan atas environment
// variable Cloudflare, supaya key bisa diperbarui dari Panel Admin tanpa
// membuka dashboard Cloudflare.

import type { Env, ProviderId } from './types';

export const SETTING_PROVIDER = 'PAYMENT_PROVIDER';

export async function getSetting(env: Env, key: string): Promise<string> {
  if (!env.DB) return '';
  try {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
    return row?.value ? String(row.value) : '';
  } catch {
    return '';
  }
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(key, value).run();
}

/** Provider yang sedang aktif; default ke midtrans demi kompatibilitas lama. */
export async function getActiveProviderId(env: Env): Promise<ProviderId> {
  const stored = (await getSetting(env, SETTING_PROVIDER)).trim().toLowerCase();
  return stored === 'xendit' ? 'xendit' : 'midtrans';
}

export async function setActiveProviderId(env: Env, id: ProviderId): Promise<void> {
  await setSetting(env, SETTING_PROVIDER, id);
}

/** SHA-256 hex, dipakai untuk mengikat mode terverifikasi ke key tertentu. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Mode hasil verifikasi hanya dipercaya bila sidik jari key-nya cocok.
 * Tanpa ini, mode lama ikut terpakai setelah key diganti.
 */
export async function readVerifiedMode(
  env: Env,
  fingerprintSetting: string,
  fingerprintOfKey: string
): Promise<boolean> {
  if (!fingerprintOfKey) return false;
  const stored = await getSetting(env, fingerprintSetting);
  return !!stored && stored === fingerprintOfKey;
}

export const maskSecret = (value: string) =>
  value
    ? value.substring(0, Math.min(8, value.length)) +
      '••••••••' +
      (value.length > 12 ? value.substring(value.length - 4) : '')
    : '';
