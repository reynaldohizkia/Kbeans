import { useEffect, useState } from 'react';

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

  // ---------- Dashboard transaksi ----------
  return (
    <div className="min-h-screen bg-[#1C1410] p-6 font-sans text-[#F0E6D8]">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl">Kbeans — Panel Admin</h1>
            <p className="text-sm text-[#B8A896]">{orders.length} pesanan tercatat</p>
          </div>
          <div className="flex items-center gap-2">
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
      </div>
    </div>
  );
}
