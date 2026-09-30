import { useEffect, useState } from 'react';
import { Settings, Check, Copy, X, Key, ShieldCheck, AlertCircle } from 'lucide-react';

interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  fulfillment_type: string;
  delivery_address: string | null;
  items_json: string;
  subtotal: number;
  delivery_fee: number;
  total_amount: number;
  payment_method: string;
  payment_status: string;
  payment_provider: string | null;
  order_status: string;
  created_at: string;
}

const formatRupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);

interface ProviderSummary {
  id: 'midtrans' | 'xendit';
  label: string;
  key_hint: string;
  has_key: boolean;
  masked_key: string;
  key_source: string;
  mode: string;
  mode_source: string;
  base_url: string;
  verified: boolean;
}

interface PaymentsConfig {
  active_provider: 'midtrans' | 'xendit';
  has_key: boolean;
  masked_key: string;
  mode: string;
  mode_source: string;
  base_url: string;
  verified: boolean;
  providers: ProviderSummary[];
}

export default function AdminPanel() {
  const [adminKey, setAdminKey] = useState(localStorage.getItem('kbeans_admin_key') || '');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  // State Modal Pengaturan Pembayaran
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [paymentsConfig, setPaymentsConfig] = useState<PaymentsConfig | null>(null);
  const [providerInput, setProviderInput] = useState<'midtrans' | 'xendit'>('xendit');
  const [secretInput, setSecretInput] = useState('');
  const [modeInput, setModeInput] = useState<string>('sandbox');
  const [acquirerInput, setAcquirerInput] = useState<'gopay' | 'airpay shopee'>('gopay');
  const [savingKey, setSavingKey] = useState(false);
  const [configNotes, setConfigNotes] = useState<string[]>([]);
  const [configMsg, setConfigMsg] = useState('');
  const [configErr, setConfigErr] = useState('');
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [simulatingId, setSimulatingId] = useState<string | null>(null);


  const loadOrders = async (key: string) => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/admin/orders', { headers: { 'x-admin-key': key } });
      if (res.status === 401) {
        setLoadError('Sesi admin tidak valid. Silakan login ulang.');
        localStorage.removeItem('kbeans_admin_key');
        localStorage.removeItem('kbeans_user');
        setAdminKey('');
        setTimeout(() => { window.location.href = '/login'; }, 1500);
        return;
      }
      const data = await res.json();
      setOrders(data.data || []);
      localStorage.setItem('kbeans_admin_key', key);
      setAdminKey(key);
    } catch {
      setLoadError('Gagal memuat data. Cek koneksi internet kamu.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (adminKey) loadOrders(adminKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateStatus = async (id: string, order_status: string) => {
    await fetch(`/api/admin/orders/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ order_status }),
    });
    loadOrders(adminKey);
  };

  // Cek apakah sudah login sebagai admin via halaman /login
  // Token admin hanya disimpan localStorage oleh halaman /login setelah
  // autentikasi berhasil. Dulu ada token demo yang ditulis di source code,
  // sehingga siapa pun yang membaca repo bisa mengakses API admin.

  // ---------- Redirect ke /login jika belum login ----------
  if (!adminKey) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#1C1410] px-4 font-sans text-[#F0E6D8]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#C99A3D]/15">
            <span className="text-3xl">🔐</span>
          </div>
          <h1 className="font-serif text-2xl">Akses Admin Kbeans</h1>
          <p className="text-sm text-[#B8A896]">
            Anda harus login sebagai Admin terlebih dahulu untuk membuka halaman ini.
          </p>
        </div>
        <div className="flex gap-3">
          <a
            href="/login"
            className="rounded-full bg-[#C99A3D] px-6 py-2.5 text-sm font-medium text-[#1C1410] transition hover:bg-[#DBAE55]"
          >
            Masuk ke Admin
          </a>
          <a
            href="/"
            className="rounded-full border border-[#3A2A1E] px-6 py-2.5 text-sm text-[#B8A896] transition hover:border-[#C99A3D] hover:text-[#F0E6D8]"
          >
            Ke Toko
          </a>
        </div>
      </div>
    );
  }

  const handleLogout = () => {
    localStorage.removeItem('kbeans_admin_key');
    localStorage.removeItem('kbeans_user');
    window.location.href = '/login';
  };

  const loadPaymentsConfig = async () => {
    try {
      const res = await fetch('/api/admin/payments/config', { headers: { 'x-admin-key': adminKey } });
      const data = await res.json();
      if (data.success) {
        setPaymentsConfig(data);
        setProviderInput(data.active_provider);
        setModeInput(data.mode || 'sandbox');
      }
    } catch {}
  };

  const handleOpenConfigModal = () => {
    setShowConfigModal(true);
    setConfigMsg('');
    setConfigErr('');
    setConfigNotes([]);
    loadPaymentsConfig();
  };

  const selectedProvider = paymentsConfig?.providers.find((p) => p.id === providerInput);

  const handleSavePaymentsConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secretInput.trim() && !selectedProvider?.has_key) return;
    setSavingKey(true);
    setConfigMsg('');
    setConfigErr('');
    setConfigNotes([]);
    try {
      const res = await fetch('/api/admin/payments/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({
          provider: providerInput,
          secret_key: secretInput.trim(),
          mode: modeInput,
          qris_acquirer: acquirerInput,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setConfigErr(data.message || 'Gagal menyimpan pengaturan pembayaran.');
        setConfigNotes(Array.isArray(data.notes) ? data.notes : []);
        return;
      }
      setConfigMsg(data.message || 'Berhasil disimpan!');
      setConfigNotes(Array.isArray(data.notes) ? data.notes : []);
      setSecretInput('');
      loadPaymentsConfig();
    } catch {
      setConfigErr('Koneksi gagal saat menghubungi server.');
    } finally {
      setSavingKey(false);
    }
  };

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/payments/notification` : '';
  const handleCopyWebhook = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const handleSimulate = async (orderId: string) => {
    setSimulatingId(orderId);
    try {
      const res = await fetch('/api/admin/payments/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ order_id: orderId }),
      });
      const data = await res.json();
      if (!data.success) {
        setLoadError(data.message || 'Simulasi gagal.');
        return;
      }
      setConfigMsg(data.message || 'Simulasi dikirim.');
      // Status disinkronkan lewat polling frontend, jadi muat ulang daftarnya
      // supaya kolom status ikut berubah.
      setTimeout(() => loadOrders(adminKey), 3000);
    } catch {
      setLoadError('Gagal menghubungi server saat simulasi.');
    } finally {
      setSimulatingId(null);
    }
  };

  // ---------- Dashboard transaksi ----------
  return (
    <div className="min-h-screen bg-[#1C1410] p-6 font-sans text-[#F0E6D8]">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl">Kbeans — Panel Admin</h1>
            <p className="text-sm text-[#B8A896]">{orders.length} pesanan tercatat</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleOpenConfigModal}
              className="flex items-center gap-1.5 rounded-full border border-[#C99A3D]/50 bg-[#C99A3D]/10 px-3.5 py-1.5 text-xs font-medium text-[#C99A3D] transition hover:bg-[#C99A3D] hover:text-[#1C1410]"
            >
              <Settings size={13} />
              Pengaturan Pembayaran
            </button>
            <a
              href="/"
              className="rounded-full border border-[#3A2A1E] px-4 py-1.5 text-xs text-[#B8A896] hover:border-[#C99A3D] hover:text-[#F0E6D8]"
            >
              Lihat Toko
            </a>
            <button
              onClick={() => loadOrders(adminKey)}
              className="rounded-full border border-[#3A2A1E] px-4 py-1.5 text-xs hover:border-[#C99A3D]"
            >
              {loading ? 'Memuat...' : 'Refresh'}
            </button>
            <button
              onClick={handleLogout}
              className="rounded-full border border-red-500/30 bg-red-500/10 px-4 py-1.5 text-xs text-red-400 hover:bg-red-500/20"
            >
              Keluar
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#3A2A1E]">
          {loadError && (
            <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-400">
              {loadError}
            </div>
          )}
          <table className="w-full text-left text-sm">
            <thead className="bg-[#221812] text-[#B8A896]">
              <tr>
                <th className="whitespace-nowrap px-4 py-3">No. Pesanan</th>
                <th className="whitespace-nowrap px-4 py-3">Pelanggan</th>
                <th className="px-4 py-3">Item</th>
                <th className="whitespace-nowrap px-4 py-3">Total</th>
                <th className="whitespace-nowrap px-4 py-3">Bayar</th>
                <th className="whitespace-nowrap px-4 py-3">Status Bayar</th>
                <th className="whitespace-nowrap px-4 py-3">Status Pesanan</th>
                <th className="whitespace-nowrap px-4 py-3">Waktu</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                let items: { name: string; quantity: number }[] = [];
                try {
                  items = JSON.parse(o.items_json);
                } catch {
                  /* ignore malformed json */
                }
                return (
                  <tr key={o.id} className="border-t border-[#3A2A1E] align-top">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{o.order_number}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <p>{o.customer_name}</p>
                      <p className="text-xs text-[#8A7A68]">{o.customer_phone}</p>
                      <p className="text-xs text-[#8A7A68]">{o.fulfillment_type === 'delivery' ? 'Dikirim' : 'Ambil di toko'}</p>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-xs text-[#B8A896]">
                      {items.map((it) => `${it.name} ×${it.quantity}`).join(', ')}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{formatRupiah(o.total_amount)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs uppercase text-[#B8A896]">{o.payment_method}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-1 text-xs ${
                          o.payment_status === 'settlement'
                            ? 'bg-green-500/20 text-green-400'
                            : o.payment_status === 'failed'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}
                      >
                        {o.payment_status}
                      </span>
                      {o.payment_provider && (
                        <span className="ml-1.5 text-[10px] uppercase text-[#8A7A68]">{o.payment_provider}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {o.payment_status !== 'settlement' && o.payment_provider === 'xendit' && (
                          <button
                            type="button"
                            onClick={() => handleSimulate(o.id)}
                            disabled={simulatingId === o.id}
                            title="Tandai pembayaran lunas di mode test Xendit"
                            className="rounded-lg border border-[#C99A3D]/50 bg-[#C99A3D]/10 px-2 py-1 text-[10px] font-medium text-[#C99A3D] transition hover:bg-[#C99A3D]/25 disabled:opacity-50"
                          >
                            {simulatingId === o.id ? 'Memproses...' : 'Simulasi Bayar'}
                          </button>
                        )}
                        <select
                          value={o.order_status}
                          onChange={(e) => updateStatus(o.id, e.target.value)}
                          className="rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-2 py-1 text-xs"
                        >
                          <option value="processing">Diproses</option>
                          <option value="shipped">Dikirim</option>
                          <option value="completed">Selesai</option>
                          <option value="cancelled">Dibatalkan</option>
                        </select>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[#8A7A68]">
                      {new Date(o.created_at).toLocaleString('id-ID')}
                    </td>
                  </tr>
                );
              })}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[#8A7A68]">
                    Belum ada transaksi masuk.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Modal Pengaturan Pembayaran */}
        {showConfigModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/75 backdrop-blur-xs" onClick={() => setShowConfigModal(false)} />
            <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#3A2A1E] bg-[#221812] p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#3A2A1E] pb-4">
                <div className="flex items-center gap-2">
                  <Key size={18} className="text-[#C99A3D]" />
                  <h2 className="font-serif text-lg text-[#F0E6D8]">Payment Gateway</h2>
                </div>
                <button onClick={() => setShowConfigModal(false)} className="text-[#B8A896] hover:text-[#F0E6D8]">
                  <X size={18} />
                </button>
              </div>

              <div className="mt-4 space-y-4 text-xs text-[#B8A896]">
                {/* Pilihan provider */}
                <div>
                  <label className="mb-1.5 block font-medium text-[#F0E6D8]">Gateway Aktif</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(paymentsConfig?.providers ?? [{ id: 'xendit' as const, label: 'Xendit' }]).map((p) => {
                      const meta = paymentsConfig?.providers.find((x) => x.id === p.id);
                      const isActive = meta?.has_key;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setProviderInput(p.id)}
                          className={`rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition ${
                            providerInput === p.id
                              ? 'border-[#C99A3D] bg-[#C99A3D]/15 text-[#C99A3D]'
                              : 'border-[#3A2A1E] bg-[#1C1410] hover:border-[#C99A3D]/50'
                          }`}
                        >
                          <span className="block">{p.label}</span>
                          <span className="text-[10px] text-[#8A7A68]">
                            {isActive ? `mode ${meta?.mode}` : 'belum ada key'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Status provider terpilih */}
                <div className="rounded-xl border border-[#3A2A1E] bg-[#1C1410] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8A7A68]">Status</p>
                  {selectedProvider?.has_key ? (
                    <div className="mt-2 flex items-start gap-2 text-emerald-400">
                      <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium text-emerald-300">
                          {selectedProvider.label} aktif &middot; mode {selectedProvider.mode}
                        </p>
                        <p className="text-[11px]">
                          Key: <code className="font-mono text-[#F0E6D8]">{selectedProvider.masked_key}</code>{' '}
                          ({selectedProvider.key_source})
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#8A7A68]">
                          <code className="font-mono">{selectedProvider.base_url}</code> &middot; {selectedProvider.mode_source}
                        </p>
                        {selectedProvider.mode === 'test' || selectedProvider.mode === 'sandbox' ? (
                          <p className="mt-1 text-[11px] font-medium text-amber-300">
                            Mode test/sandbox: tidak ada uang sungguhan yang berpindah.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-start gap-2 text-amber-400">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium text-amber-300">{selectedProvider?.label} belum punya key</p>
                        <p className="text-[11px]">
                          Paste credential di bawah. {selectedProvider?.key_hint}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Form */}
                <form onSubmit={handleSavePaymentsConfig} className="space-y-3">
                  <div>
                    <label className="mb-1 block font-medium text-[#F0E6D8]">
                      {providerInput === 'xendit' ? 'Xendit Secret Key' : 'Midtrans Server Key'}
                    </label>
                    <input
                      type="password"
                      autoComplete="off"
                      value={secretInput}
                      onChange={(e) => setSecretInput(e.target.value)}
                      placeholder={
                        selectedProvider?.has_key
                          ? `Sudah aktif: ${selectedProvider.masked_key} — biarkan kosong bila tidak ingin mengganti`
                          : selectedProvider?.key_hint
                      }
                      className="w-full rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3.5 py-2.5 font-mono text-xs text-[#F0E6D8] outline-none transition focus:border-[#C99A3D]"
                    />
                    <p className="mt-1 text-[11px] text-[#8A7A68]">
                      {providerInput === 'xendit'
                        ? 'Dashboard Xendit > Settings > API Keys > Generate Secret Key. Prefix xnd_development_ berarti mode test.'
                        : 'Dashboard Midtrans > Settings > Access Keys. Environment terdeteksi otomatis dari awalan key.'}
                    </p>
                  </div>

                  {providerInput === 'midtrans' && (
                    <div>
                      <label className="mb-1 block font-medium text-[#F0E6D8]">Environment</label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['production', 'sandbox'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setModeInput(m)}
                            className={`rounded-lg border px-3 py-2 text-xs font-medium capitalize transition ${
                              modeInput === m
                                ? 'border-[#C99A3D] bg-[#C99A3D]/15 text-[#C99A3D]'
                                : 'border-[#3A2A1E] bg-[#1C1410] hover:border-[#C99A3D]/50'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {providerInput === 'midtrans' && (
                    <div>
                      <label className="mb-1 block font-medium text-[#F0E6D8]">Acquirer QRIS</label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['gopay', 'airpay shopee'] as const).map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => setAcquirerInput(a)}
                            className={`rounded-lg border px-3 py-2 text-xs font-medium capitalize transition ${
                              acquirerInput === a
                                ? 'border-[#C99A3D] bg-[#C99A3D]/15 text-[#C99A3D]'
                                : 'border-[#3A2A1E] bg-[#1C1410] hover:border-[#C99A3D]/50'
                            }`}
                          >
                            {a}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {configErr && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                      <p>{configErr}</p>
                      {configNotes.map((n) => (
                        <p key={n} className="mt-1 text-[#B8A896]">{n}</p>
                      ))}
                    </div>
                  )}
                  {configMsg && (
                    <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-xs text-green-400">
                      <p>{configMsg}</p>
                      {configNotes.map((n) => (
                        <p key={n} className="mt-1 text-[#B8A896]">{n}</p>
                      ))}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={savingKey || (!secretInput.trim() && !selectedProvider?.has_key)}
                    className="w-full rounded-full bg-[#C99A3D] py-2.5 text-xs font-semibold text-[#1C1410] transition hover:bg-[#DBAE55] disabled:opacity-50"
                  >
                    {savingKey ? 'Memverifikasi ke gateway...' : secretInput.trim() ? 'Simpan & Uji Key' : 'Simpan Pengaturan'}
                  </button>
                </form>

                {/* Webhook */}
                <div className="border-t border-[#3A2A1E] pt-4">
                  <p className="font-medium text-[#F0E6D8]">Webhook URL</p>
                  <p className="mt-0.5 text-[11px] text-[#8A7A68]">
                    Daftarkan di dashboard gateway. Opsional: aplikasi juga mengecek status langsung ke gateway,
                    jadi pembeli tetap sampai ke layar &ldquo;Berhasil&rdquo; walau webhook belum terdaftar.
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3 py-2">
                    <span className="truncate font-mono text-[11px] text-[#F0E6D8]">{webhookUrl}</span>
                    <button
                      type="button"
                      onClick={handleCopyWebhook}
                      className="flex shrink-0 items-center gap-1 rounded border border-[#3A2A1E] bg-[#221812] px-2.5 py-1 text-[10px] text-[#C99A3D] hover:border-[#C99A3D]"
                    >
                      {copiedWebhook ? <Check size={11} /> : <Copy size={11} />}
                      {copiedWebhook ? 'Tersalin' : 'Salin'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
