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
  order_status: string;
  created_at: string;
}

const formatRupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);

export default function AdminPanel() {
  const [adminKey, setAdminKey] = useState(localStorage.getItem('kbeans_admin_key') || '');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  // State Modal Pengaturan Midtrans
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [midtransConfig, setMidtransConfig] = useState<{ has_key: boolean; masked_key: string; source: string } | null>(null);
  const [serverKeyInput, setServerKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [configMsg, setConfigMsg] = useState('');
  const [configErr, setConfigErr] = useState('');
  const [copiedWebhook, setCopiedWebhook] = useState(false);

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
  const userStr = localStorage.getItem('kbeans_user');
  const userObj = userStr ? (() => { try { return JSON.parse(userStr); } catch { return null; } })() : null;

  // Jika adminKey tidak ada (belum login lewat halaman login baru),
  // tapi user di localStorage adalah admin, maka gunakan token demo
  useEffect(() => {
    if (!adminKey && userObj?.role === 'admin') {
      const demoToken = 'kbeans_admin_token';
      localStorage.setItem('kbeans_admin_key', demoToken);
      setAdminKey(demoToken);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Redirect ke /login jika belum login ----------
  if (!adminKey && userObj?.role !== 'admin') {
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

  const loadMidtransConfig = async () => {
    try {
      const res = await fetch('/api/admin/midtrans/config', { headers: { 'x-admin-key': adminKey } });
      const data = await res.json();
      if (data.success) {
        setMidtransConfig(data);
      }
    } catch {}
  };

  const handleOpenConfigModal = () => {
    setShowConfigModal(true);
    setConfigMsg('');
    setConfigErr('');
    loadMidtransConfig();
  };

  const handleSaveMidtransKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverKeyInput.trim()) return;
    setSavingKey(true);
    setConfigMsg('');
    setConfigErr('');
    try {
      const res = await fetch('/api/admin/midtrans/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ server_key: serverKeyInput }),
      });
      const data = await res.json();
      if (!data.success) {
        setConfigErr(data.message || 'Gagal menyimpan Server Key.');
        return;
      }
      setConfigMsg(data.message || 'Berhasil disimpan!');
      setServerKeyInput('');
      loadMidtransConfig();
    } catch {
      setConfigErr('Koneksi gagal saat menghubungi server.');
    } finally {
      setSavingKey(false);
    }
  };

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/midtrans/notification` : '';
  const handleCopyWebhook = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
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
              Pengaturan Midtrans
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
                        className={`rounded-full px-2 py-1 text-xs ${
                          o.payment_status === 'settlement'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}
                      >
                        {o.payment_status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
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

        {/* Modal Pengaturan Midtrans */}
        {showConfigModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/75 backdrop-blur-xs" onClick={() => setShowConfigModal(false)} />
            <div className="relative w-full max-w-lg rounded-2xl border border-[#3A2A1E] bg-[#221812] p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#3A2A1E] pb-4">
                <div className="flex items-center gap-2">
                  <Key size={18} className="text-[#C99A3D]" />
                  <h2 className="font-serif text-lg text-[#F0E6D8]">Integrasi Midtrans (Sandbox)</h2>
                </div>
                <button onClick={() => setShowConfigModal(false)} className="text-[#B8A896] hover:text-[#F0E6D8]">
                  <X size={18} />
                </button>
              </div>

              <div className="mt-4 space-y-4 text-xs text-[#B8A896]">
                {/* Status Box */}
                <div className="rounded-xl border border-[#3A2A1E] bg-[#1C1410] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8A7A68]">Status Koneksi</p>
                  {midtransConfig?.has_key ? (
                    <div className="mt-2 flex items-start gap-2 text-emerald-400">
                      <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium text-emerald-300">Terhubung ke Midtrans Sandbox</p>
                        <p className="text-[11px] text-[#B8A896]">
                          Server Key: <code className="font-mono text-[#F0E6D8]">{midtransConfig.masked_key}</code> ({midtransConfig.source})
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-start gap-2 text-amber-400">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium text-amber-300">Belum Terhubung (Mode Demo Simulasi)</p>
                        <p className="text-[11px] text-[#B8A896]">
                          Masukkan Server Key Midtrans di bawah ini untuk mengaktifkan QRIS dan VA Midtrans nyata.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Form Input Server Key */}
                <form onSubmit={handleSaveMidtransKey} className="space-y-3">
                  <div>
                    <label className="mb-1 block font-medium text-[#F0E6D8]">
                      Midtrans Server Key
                    </label>
                    <input
                      type="text"
                      value={serverKeyInput}
                      onChange={(e) => setServerKeyInput(e.target.value)}
                      placeholder="Contoh: SB-Mid-server-xxxxxxxxxxxx"
                      className="w-full rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3.5 py-2.5 font-mono text-xs text-[#F0E6D8] outline-none transition focus:border-[#C99A3D]"
                    />
                    <p className="mt-1 text-[11px] text-[#8A7A68]">
                      Salin dari Dashboard Midtrans &gt; <strong>Settings &gt; Access Keys &gt; Server Key</strong>
                    </p>
                  </div>

                  {configErr && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                      {configErr}
                    </div>
                  )}
                  {configMsg && (
                    <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-xs text-green-400">
                      {configMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={savingKey || !serverKeyInput.trim()}
                    className="w-full rounded-full bg-[#C99A3D] py-2.5 text-xs font-semibold text-[#1C1410] transition hover:bg-[#DBAE55] disabled:opacity-50"
                  >
                    {savingKey ? 'Memverifikasi ke Midtrans...' : 'Simpan & Uji Server Key'}
                  </button>
                </form>

                {/* Webhook Configuration Guide */}
                <div className="border-t border-[#3A2A1E] pt-4">
                  <p className="font-medium text-[#F0E6D8]">Payment Notification URL (Webhook Midtrans)</p>
                  <p className="mt-0.5 text-[11px] text-[#8A7A68]">
                    Daftarkan URL ini di Midtrans Dashboard &gt; <strong>Settings &gt; Configuration &gt; Payment Notification URL</strong>:
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3 py-2">
                    <span className="font-mono text-[11px] text-[#F0E6D8] truncate">{webhookUrl}</span>
                    <button
                      type="button"
                      onClick={handleCopyWebhook}
                      className="shrink-0 flex items-center gap-1 rounded border border-[#3A2A1E] bg-[#221812] px-2.5 py-1 text-[10px] text-[#C99A3D] hover:border-[#C99A3D]"
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
