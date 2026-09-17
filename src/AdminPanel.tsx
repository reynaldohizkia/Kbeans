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
  const [inputKey, setInputKey] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadOrders = async (key: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/orders', { headers: { 'x-admin-key': key } });
      if (res.status === 401) {
        setError('Admin key salah.');
        localStorage.removeItem('kbeans_admin_key');
        setAdminKey('');
        return;
      }
      const data = await res.json();
      setOrders(data.data || []);
      localStorage.setItem('kbeans_admin_key', key);
      setAdminKey(key);
    } catch {
      setError('Gagal memuat data. Cek koneksi internet kamu.');
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

  // ---------- Layar login admin ----------
  if (!adminKey) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#1C1410] px-4 font-sans text-[#F0E6D8]">
        <div className="w-full max-w-sm rounded-2xl border border-[#3A2A1E] bg-[#221812] p-6">
          <h1 className="mb-1 font-serif text-2xl">Kbeans Admin</h1>
          <p className="mb-4 text-sm text-[#B8A896]">Masukkan admin key untuk melihat transaksi.</p>
          <input
            type="password"
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadOrders(inputKey)}
            placeholder="Admin key"
            className="mb-3 w-full rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3 py-2 text-sm outline-none focus:border-[#C99A3D]"
          />
          {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
          <button
            onClick={() => loadOrders(inputKey)}
            disabled={loading}
            className="w-full rounded-full bg-[#C99A3D] py-2 text-sm font-medium text-[#1C1410] disabled:opacity-50"
          >
            {loading ? 'Memeriksa...' : 'Masuk'}
          </button>
        </div>
      </div>
    );
  }

  // ---------- Dashboard transaksi ----------
  return (
    <div className="min-h-screen bg-[#1C1410] p-6 font-sans text-[#F0E6D8]">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl">Kbeans — Daftar Transaksi</h1>
            <p className="text-sm text-[#B8A896]">{orders.length} pesanan tercatat</p>
          </div>
          <button
            onClick={() => loadOrders(adminKey)}
            className="rounded-full border border-[#3A2A1E] px-4 py-1.5 text-sm hover:border-[#C99A3D]"
          >
            {loading ? 'Memuat...' : 'Refresh'}
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#3A2A1E]">
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
