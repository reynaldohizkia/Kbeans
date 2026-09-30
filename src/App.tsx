import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ShoppingBag, Minus, Plus, MapPin, Coffee, User, LogOut, Shield, Download, Check, Copy, Info } from 'lucide-react';
import QrCanvas from './QrCanvas';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------
interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'customer' | 'admin';
  phone?: string;
}

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  category_id: string;
  price: number;
  unit: string;
  stock_quantity: number;
  image_url: string;
  origin: string;
  roast_level: 'light' | 'medium' | 'dark';
  tasting_notes: string;
  is_featured: number;
}

interface Category {
  id: string;
  name: string;
  slug: string;
}

interface CartItem {
  id: string;
  name: string;
  price: number;
  unit: string;
  quantity: number;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
const formatRupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);

const roastColor: Record<Product['roast_level'], string> = {
  light: '#E3B778',
  medium: '#B87333',
  dark: '#4A2E1E',
};

const roastLabel: Record<Product['roast_level'], string> = {
  light: 'Light Roast',
  medium: 'Medium Roast',
  dark: 'Dark Roast',
};

// ----------------------------------------------------------------
// Main App
// ----------------------------------------------------------------
export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<'cart' | 'form' | 'payment' | 'success'>('cart');
  // Sesi Pengguna (Pelanggan / Admin)
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem('kbeans_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [customerName, setCustomerName] = useState(() => {
    try {
      const saved = localStorage.getItem('kbeans_user');
      return saved ? (JSON.parse(saved)?.name || '') : '';
    } catch {
      return '';
    }
  });
  const [customerPhone, setCustomerPhone] = useState(() => {
    try {
      const saved = localStorage.getItem('kbeans_user');
      return saved ? (JSON.parse(saved)?.phone || '') : '';
    } catch {
      return '';
    }
  });
  const [fulfillmentType, setFulfillmentType] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'qris' | 'bca_va' | 'credit_card'>('qris');
  const [placingOrder, setPlacingOrder] = useState(false);
  const [order, setOrder] = useState<{ order_id: string; order_number: string; total_amount: number } | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [qrLoadError, setQrLoadError] = useState('');
  const [vaNumber, setVaNumber] = useState('');
  const [vaBank, setVaBank] = useState('');
  const [qrString, setQrString] = useState('');
  const [paymentNotes, setPaymentNotes] = useState<string[]>([]);
  const [providerLabel, setProviderLabel] = useState('');
  const [chargeError, setChargeError] = useState('');
  const [chargeHint, setChargeHint] = useState('');
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [downloadingQr, setDownloadingQr] = useState(false);
  const [qrDownloaded, setQrDownloaded] = useState(false);
  const [copiedVa, setCopiedVa] = useState(false);

  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Pesan error mentah dari server, dipakai kalau parsing JSON gagal.
  const lastRequestError = useRef('');

  // Dua sumber QR, tergantung gateway:
  //   qrString -> dirender sendiri di browser (Xendit)
  //   qrUrl    -> gambar resmi dari gateway lewat proxy (Midtrans)
  const hasQr = !!qrString || !!qrUrl;

  // QR yang dirender sendiri di browser bisa langsung diekspor dari canvas,
  // tanpa perlu fetch dan tanpa masalah CORS sama sekali.
  const downloadRenderedQr = (fileName: string) => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return false;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  };

  const downloadQrCode = async () => {
    if (!hasQr || !order) return;
    setDownloadingQr(true);

    const fileName = `QRIS-Kbeans-${order.order_number}.png`;

    if (qrString) {
      if (downloadRenderedQr(fileName)) {
        setDownloadingQr(false);
        setQrDownloaded(true);
        setTimeout(() => setQrDownloaded(false), 3000);
      }
      return;
    }

    try {
      const res = await fetch(qrUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      // QR tidak bisa diunduh sebagai file, buka di tab baru agar bisa
      // disimpan manual lewat tombol simpan gambar di browser.
      window.open(qrUrl, '_blank');
    } finally {
      setDownloadingQr(false);
      setQrDownloaded(true);
      setTimeout(() => setQrDownloaded(false), 3000);
    }
  };

  const handleCopyVa = () => {
    if (!vaNumber) return;
    navigator.clipboard.writeText(vaNumber);
    setCopiedVa(true);
    setTimeout(() => setCopiedVa(false), 2000);
  };

  const handleLogout = () => {
    localStorage.removeItem('kbeans_user');
    localStorage.removeItem('kbeans_admin_key');
    setCurrentUser(null);
    setCustomerName('');
    setCustomerPhone('');
  };

  useEffect(() => {
    Promise.all([
      fetch('/api/products').then((r) => r.json()),
      fetch('/api/categories').then((r) => r.json()),
    ])
      .then(([p, c]) => {
        setProducts(p.data || []);
        setCategories(c.data || []);
      })
      .catch(() => {
        setProducts([]);
        setCategories([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredProducts = useMemo(() => {
    if (activeCategory === 'all') return products;
    return products.filter((p) => p.category_id === activeCategory);
  }, [products, activeCategory]);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.id === product.id ? { ...i, quantity: Math.min(i.quantity + 1, product.stock_quantity) } : i
        );
      }
      return [...prev, { id: product.id, name: product.name, price: product.price, unit: product.unit, quantity: 1 }];
    });
    setCartOpen(true);
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0)
    );
  };

  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const deliveryFee = fulfillmentType === 'delivery' && cartTotal < 150000 ? 15000 : 0;
  const grandTotal = cartTotal + deliveryFee;

  const placeOrder = async () => {
    if (!customerName || !customerPhone) return;
    if (fulfillmentType === 'delivery' && !deliveryAddress) return;

    setPlacingOrder(true);
    setChargeError('');
    setChargeHint('');
    setPaymentFailed(false);
    setQrLoadError('');
    setQrUrl('');
    setVaNumber('');
    setVaBank('');
    lastRequestError.current = '';
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: customerName,
          customer_phone: customerPhone,
          fulfillment_type: fulfillmentType,
          delivery_address: fulfillmentType === 'delivery' ? deliveryAddress : undefined,
          items: cart.map((i) => ({ id: i.id, quantity: i.quantity, price: i.price })),
          payment_method: paymentMethod,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setChargeError(data.message || 'Gagal membuat pesanan.');
        return;
      }

      setOrder({ order_id: data.order_id, order_number: data.order_number, total_amount: data.total_amount });

      if (paymentMethod === 'credit_card') {
        setCheckoutStep('payment');
        return;
      }

      // Minta transaksi sungguhan ke payment gateway yang aktif.
      const chargeRes = await fetch('/api/payments/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: data.order_id, payment_method: paymentMethod }),
      });

      // Baca body sebagai teks dulu supaya error dari server (JSON maupun
      // non-JSON) tetap bisa ditampilkan apa adanya.
      const rawBody = await chargeRes.text();
      let chargeData: any = null;
      try {
        chargeData = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        chargeData = null;
      }

      if (!chargeData) {
        lastRequestError.current =
          `Server membalas HTTP ${chargeRes.status} dengan respons yang tidak bisa dibaca. `
          + (rawBody ? `Isi: ${rawBody.slice(0, 200)}` : 'Respons kosong.');
        throw new Error(lastRequestError.current);
      }

      // Gateway menolak? Tampilkan error aslinya. Jangan pernah menampilkan QR
      // pengganti, karena QR palsu hanya bisa "dipindai" tapi tidak bisa dibayar.
      if (!chargeData.success) {
        setCheckoutStep('payment');
        setChargeError(chargeData.message || 'Gagal memproses pembayaran.');
        setChargeHint(chargeData.hint || '');
        return;
      }

      setCheckoutStep('payment');
      setProviderLabel(chargeData.provider_label || '');
      setPaymentNotes(Array.isArray(chargeData.notes) ? chargeData.notes : []);

      // Xendit mengirim string EMVCo, Midtrans mengirim URL gambar resmi.
      if (chargeData.qr_string) {
        setQrString(chargeData.qr_string);
      }
      if (chargeData.qr_proxy_url) {
        setQrUrl(chargeData.qr_proxy_url);
      }
      if (chargeData.va_number) {
        setVaNumber(chargeData.va_number);
        setVaBank(chargeData.va_bank || chargeData.bank || '');
      }
    } catch (e) {
      // Jangan hanya melaporkan "kesalahan jaringan": kalau server membalas
      // HTML atau teks biasa (mis. 502 dari edge), .json() akan melempar error
      // dan penyebab aslinya ikut hilang. Ambil isi respons apa adanya.
      console.error(e);
      setCheckoutStep('payment');
      setChargeError(lastRequestError.current || 'Tidak bisa menghubungi server. Periksa koneksi internet Anda.');
    } finally {
      setPlacingOrder(false);
    }
  };

  // Polling status pembayaran setiap 4 detik selagi menunggu di layar QR/VA.
  // Backend menanyakan status terbaru ke gateway lalu menyimpannya ke D1, jadi
  // halaman tetap sampai ke layar "Berhasil" walau webhook belum terdaftar.
  useEffect(() => {
    if (checkoutStep !== 'payment' || !order || paymentMethod === 'credit_card' || paymentFailed) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${order.order_id}/status`);
        const data = await res.json();
        if (data.payment_status === 'settlement') {
          setCheckoutStep('success');
          clearInterval(interval);
        } else if (data.payment_status === 'failed') {
          setPaymentFailed(true);
          const raw = String(data.transaction_status || '').toLowerCase();
          setChargeError(
            raw === 'expire' || raw === 'expired'
              ? 'Waktu pembayaran habis (QRIS kedaluwarsa). Silakan buat pesanan baru.'
              : 'Pembayaran dibatalkan atau ditolak oleh payment gateway. Silakan buat pesanan baru.'
          );
          clearInterval(interval);
        }
      } catch {
        /* diamkan, coba lagi di interval berikutnya */
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [checkoutStep, order, paymentMethod, paymentFailed]);

  const resetCheckout = () => {
    setCart([]);
    setCheckoutStep('cart');
    setCustomerName('');
    setCustomerPhone('');
    setDeliveryAddress('');
    setOrder(null);
    setQrUrl('');
    setQrString('');
    setVaNumber('');
    setVaBank('');
    setChargeError('');
    setChargeHint('');
    setPaymentNotes([]);
    setProviderLabel('');
    setPaymentFailed(false);
    setQrLoadError('');
    setCartOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#1C1410] text-[#F0E6D8] font-sans">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-30 border-b border-[#3A2A1E] bg-[#1C1410]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <a href="/" className="flex items-center gap-2 font-serif text-2xl tracking-tight text-[#F0E6D8]">
            <Coffee size={24} className="text-[#C99A3D]" />
            Kbeans
          </a>

          <div className="flex items-center gap-3">
            {currentUser ? (
              <div className="flex items-center gap-2">
                {currentUser.role === 'admin' ? (
                  <a
                    href="/admin"
                    className="flex items-center gap-1.5 rounded-full border border-[#C99A3D]/40 bg-[#C99A3D]/10 px-3 py-1.5 text-xs font-medium text-[#C99A3D] transition hover:bg-[#C99A3D]/20"
                  >
                    <Shield size={13} />
                    Panel Admin
                  </a>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-[#B8A896]">
                    <User size={14} className="text-[#C99A3D]" />
                    <span className="hidden sm:inline">Halo,</span>
                    <strong className="font-medium text-[#F0E6D8]">{currentUser.name.split(' ')[0]}</strong>
                  </span>
                )}
                <button
                  onClick={handleLogout}
                  title="Keluar dari akun"
                  className="flex items-center gap-1 rounded-full border border-[#3A2A1E] px-2.5 py-1.5 text-xs text-[#B8A896] transition hover:border-red-500/40 hover:text-red-400"
                >
                  <LogOut size={13} />
                  <span className="hidden sm:inline">Keluar</span>
                </button>
              </div>
            ) : (
              <a
                href="/login"
                className="flex items-center gap-1.5 rounded-full border border-[#3A2A1E] px-3.5 py-1.5 text-xs text-[#F0E6D8] transition hover:border-[#C99A3D] hover:text-[#C99A3D]"
              >
                <User size={14} />
                Masuk
              </a>
            )}

            <button
              onClick={() => setCartOpen(true)}
              className="relative flex items-center gap-2 rounded-full border border-[#3A2A1E] px-4 py-1.5 text-xs sm:text-sm text-[#F0E6D8] transition hover:border-[#C99A3D]"
            >
              <ShoppingBag size={15} />
              <span className="hidden sm:inline">Keranjang</span>
              {cartCount > 0 && (
                <span className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#C99A3D] text-[11px] font-medium text-[#1C1410]">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-12">
        <p className="mb-3 text-sm text-[#C99A3D]">Roastery kecil, langsung dari kebun Nusantara</p>
        <h1 className="max-w-xl font-serif text-5xl leading-[1.1] text-[#F0E6D8] sm:text-6xl">
          Biji kopi dipanggang untuk diminum, bukan dipajang.
        </h1>
        <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[#B8A896]">
          Setiap batch kami sangrai dalam jumlah kecil, dari Toraja sampai Gayo — dikirim segar dalam hitungan hari, bukan bulan.
        </p>
      </section>

      {/* ---------- Category filter ---------- */}
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-wrap gap-2 border-b border-[#3A2A1E] pb-6">
          <button
            onClick={() => setActiveCategory('all')}
            className={`rounded-full px-4 py-1.5 text-sm transition ${
              activeCategory === 'all'
                ? 'bg-[#C99A3D] text-[#1C1410]'
                : 'border border-[#3A2A1E] text-[#B8A896] hover:border-[#C99A3D]'
            }`}
          >
            Semua
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                activeCategory === c.id
                  ? 'bg-[#C99A3D] text-[#1C1410]'
                  : 'border border-[#3A2A1E] text-[#B8A896] hover:border-[#C99A3D]'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* ---------- Product grid ---------- */}
      <main className="mx-auto max-w-6xl px-6 py-10">
        {loading ? (
          <p className="text-[#B8A896]">Memuat produk...</p>
        ) : filteredProducts.length === 0 ? (
          <p className="text-[#B8A896]">Belum ada produk di kategori ini.</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '1.25rem',
            }}
          >
            {filteredProducts.map((p) => (
              <ProductCard key={p.id} product={p} onAdd={() => addToCart(p)} />
            ))}
          </div>
        )}
      </main>

      {/* ---------- Cart / Checkout drawer ---------- */}
      {cartOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => {
              setCartOpen(false);
              if (checkoutStep === 'success') resetCheckout();
            }}
          />
          <div className="relative flex h-full w-full max-w-sm flex-col bg-[#221812] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#3A2A1E] px-6 py-5">
              <h2 className="font-serif text-xl">
                {checkoutStep === 'cart' && 'Keranjang Kamu'}
                {checkoutStep === 'form' && 'Data Pemesan'}
                {checkoutStep === 'payment' && 'Pembayaran'}
                {checkoutStep === 'success' && 'Pesanan Diterima'}
              </h2>
              <button
                onClick={() => {
                  setCartOpen(false);
                  if (checkoutStep === 'success') resetCheckout();
                }}
                className="text-[#B8A896] hover:text-[#F0E6D8]"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* STEP 1: Cart */}
              {checkoutStep === 'cart' &&
                (cart.length === 0 ? (
                  <div className="mt-12 flex flex-col items-center text-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#3A2A1E]/50">
                      <ShoppingBag size={22} className="text-[#B8A896]" />
                    </div>
                    <p className="text-sm font-medium text-[#F0E6D8]">Keranjang masih kosong</p>
                    <p className="mt-1 text-xs text-[#B8A896]">Pilih kopi favoritmu dari daftar produk di toko.</p>
                    {products.length > 0 && (
                      <button
                        type="button"
                        onClick={() => addToCart(products[0])}
                        className="mt-4 rounded-full border border-[#C99A3D] bg-[#C99A3D]/10 px-4 py-2 text-xs font-medium text-[#C99A3D] transition hover:bg-[#C99A3D] hover:text-[#1C1410]"
                      >
                        + Tambah {products[0].name} (Coba Transaksi)
                      </button>
                    )}
                  </div>
                ) : (
                  <ul className="space-y-4">
                    {cart.map((item) => (
                      <li key={item.id} className="flex items-start justify-between gap-3 border-b border-[#3A2A1E] pb-4">
                        <div>
                          <p className="text-sm text-[#F0E6D8]">{item.name}</p>
                          <p className="text-xs text-[#B8A896]">{item.unit} · {formatRupiah(item.price)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateQuantity(item.id, -1)}
                            className="flex h-6 w-6 items-center justify-center rounded-full border border-[#3A2A1E] text-[#B8A896] hover:border-[#C99A3D]"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="w-4 text-center text-sm">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, 1)}
                            className="flex h-6 w-6 items-center justify-center rounded-full border border-[#3A2A1E] text-[#B8A896] hover:border-[#C99A3D]"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ))}

              {/* STEP 2: Customer form */}
              {checkoutStep === 'form' && (
                <div className="space-y-4">
                  {chargeError && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                      {chargeError}
                    </div>
                  )}
                  <div>
                    <label className="mb-1 block text-xs text-[#B8A896]">Nama Lengkap</label>
                    <input
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Nama kamu"
                      className="w-full rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3 py-2 text-sm text-[#F0E6D8] outline-none focus:border-[#C99A3D]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[#B8A896]">Nomor WhatsApp</label>
                    <input
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="08xxxxxxxxxx"
                      className="w-full rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3 py-2 text-sm text-[#F0E6D8] outline-none focus:border-[#C99A3D]"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-[#B8A896]">Ambil di Toko atau Dikirim?</label>
                    <div className="flex gap-2">
                      {(['pickup', 'delivery'] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setFulfillmentType(t)}
                          className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                            fulfillmentType === t
                              ? 'border-[#C99A3D] bg-[#C99A3D]/10 text-[#F0E6D8]'
                              : 'border-[#3A2A1E] text-[#B8A896]'
                          }`}
                        >
                          {t === 'pickup' ? 'Ambil di Toko' : 'Dikirim'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {fulfillmentType === 'delivery' && (
                    <div>
                      <label className="mb-1 block text-xs text-[#B8A896]">Alamat Pengiriman</label>
                      <textarea
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        placeholder="Jl. Contoh No. 123, Manado"
                        rows={3}
                        className="w-full resize-none rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3 py-2 text-sm text-[#F0E6D8] outline-none focus:border-[#C99A3D]"
                      />
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-xs text-[#B8A896]">Metode Pembayaran</label>
                    <div className="space-y-2">
                      {[
                        { id: 'qris', label: 'QRIS' },
                        { id: 'bca_va', label: 'Virtual Account BCA' },
                        { id: 'credit_card', label: 'Kartu Kredit/Debit' },
                      ].map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setPaymentMethod(m.id as typeof paymentMethod)}
                          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
                            paymentMethod === m.id
                              ? 'border-[#C99A3D] bg-[#C99A3D]/10 text-[#F0E6D8]'
                              : 'border-[#3A2A1E] text-[#B8A896]'
                          }`}
                        >
                          {m.label}
                          {paymentMethod === m.id && <span className="h-2 w-2 rounded-full bg-[#C99A3D]" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: Payment (QR / VA asli dari Midtrans) */}
              {checkoutStep === 'payment' && order && (
                <div className="flex flex-col items-center text-center">
                  <p className="mb-1 text-xs text-[#B8A896]">Nomor Pesanan</p>
                  <p className="mb-6 font-serif text-lg text-[#F0E6D8]">{order.order_number}</p>

                  {chargeError && (
                    <div className="mb-4 w-full rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-left text-xs text-red-400">
                      <p className="font-semibold">Pembayaran tidak dapat diproses</p>
                      <p className="mt-0.5 break-words">{chargeError}</p>
                      {chargeHint && <p className="mt-1 text-[#B8A896]">{chargeHint}</p>}
                    </div>
                  )}

                  {paymentNotes.length > 0 && !paymentFailed && (
                    <div className="mb-4 w-full rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-left text-xs text-amber-300">
                      <span className="mb-0.5 flex items-center gap-1.5 font-semibold">
                        <Info size={13} />
                        Mode {providerLabel || 'Test'}
                      </span>
                      {paymentNotes.map((note) => (
                        <span key={note} className="block">{note}</span>
                      ))}
                    </div>
                  )}

                  {paymentMethod === 'qris' && !paymentFailed && (
                    <div className="flex flex-col items-center">
                      {hasQr && !qrLoadError ? (
                        <>
                          <div className="rounded-2xl bg-white p-3.5 shadow-lg">
                            {qrString ? (
                              <div ref={(el) => { qrCanvasRef.current = el?.querySelector('canvas') ?? null; }}>
                                <QrCanvas value={qrString} size={220} onError={setQrLoadError} />
                              </div>
                            ) : (
                              <img
                                src={qrUrl}
                                alt="QRIS Pembayaran"
                                width={220}
                                height={220}
                                className="rounded-lg"
                                onError={() =>
                                  setQrLoadError('Gambar QRIS gagal dimuat dari payment gateway. Muat ulang halaman untuk mencoba lagi.')
                                }
                              />
                            )}
                          </div>

                          {/* Tombol Unduh / Download QR */}
                          <div className="mt-4 flex flex-col items-center gap-2">
                            <button
                              type="button"
                              onClick={downloadQrCode}
                              disabled={downloadingQr}
                              className="flex items-center gap-2 rounded-full border border-[#C99A3D] bg-[#C99A3D]/15 px-5 py-2.5 text-xs font-semibold text-[#C99A3D] shadow transition hover:bg-[#C99A3D] hover:text-[#1C1410] disabled:opacity-50"
                            >
                              {qrDownloaded ? (
                                <>
                                  <Check size={15} className="text-emerald-400" />
                                  <span className="text-emerald-400">QRIS Berhasil Diunduh!</span>
                                </>
                              ) : (
                                <>
                                  <Download size={15} />
                                  <span>{downloadingQr ? 'Mengunduh...' : 'Unduh QRIS (Simpan ke Galeri)'}</span>
                                </>
                              )}
                            </button>
                            <p className="max-w-[270px] text-center text-[11px] text-[#B8A896]">
                              Simpan ke galeri untuk bayar lewat fitur scan foto di GoPay, OVO, DANA, ShopeePay, atau m-banking apa pun.
                            </p>
                          </div>
                        </>
                      ) : (
                        <div className="flex h-56 w-56 flex-col items-center justify-center rounded-xl border border-dashed border-[#3A2A1E] bg-[#1C1410] p-4 text-center">
                          {qrLoadError ? (
                            <>
                              <p className="text-xs text-red-400">{qrLoadError}</p>
                              <button
                                type="button"
                                onClick={() => window.location.reload()}
                                className="mt-3 rounded-full border border-[#C99A3D] px-4 py-1.5 text-[11px] text-[#C99A3D]"
                              >
                                Muat Ulang
                              </button>
                            </>
                          ) : (
                            <>
                              <div className="mb-2 h-6 w-6 animate-spin rounded-full border-2 border-[#C99A3D] border-t-transparent" />
                              <p className="text-xs text-[#B8A896]">Menyiapkan kode QRIS...</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {paymentMethod === 'bca_va' && !paymentFailed && (
                    <div className="w-full">
                      {vaNumber ? (
                        <div className="w-full rounded-xl border border-[#3A2A1E] bg-[#1C1410] p-5 text-center">
                          <p className="text-xs text-[#B8A896]">
                            Nomor Virtual Account{vaBank ? ` ${vaBank.toUpperCase()}` : ''}
                          </p>
                          <p className="mt-1 font-mono text-xl font-bold tracking-wider text-[#F0E6D8]">{vaNumber}</p>
                          <button
                            type="button"
                            onClick={handleCopyVa}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#C99A3D] bg-[#C99A3D]/10 px-4 py-1.5 text-xs font-medium text-[#C99A3D] transition hover:bg-[#C99A3D] hover:text-[#1C1410]"
                          >
                            {copiedVa ? <Check size={13} /> : <Copy size={13} />}
                            {copiedVa ? 'Nomor VA Tersalin!' : 'Salin Nomor VA'}
                          </button>
                        </div>
                      ) : (
                        <div className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-[#3A2A1E] bg-[#1C1410] p-5">
                          <div className="mb-2 h-6 w-6 animate-spin rounded-full border-2 border-[#C99A3D] border-t-transparent" />
                          <p className="text-xs text-[#B8A896]">Menyiapkan nomor Virtual Account...</p>
                        </div>
                      )}
                    </div>
                  )}

                  {paymentMethod === 'credit_card' && (
                    <div className="w-full rounded-xl border border-[#3A2A1E] bg-[#1C1410] p-5">
                      <p className="text-sm text-[#B8A896]">Pembayaran kartu kredit/debit memerlukan integrasi Midtrans Snap tersendiri demi keamanan data kartu. Silakan pilih QRIS atau Virtual Account untuk sekarang.</p>
                    </div>
                  )}

                  {(hasQr || vaNumber) && !paymentFailed && (
                    <div className="mt-6 flex items-center gap-2 text-xs text-[#B8A896]">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-[#C99A3D]" />
                      Menunggu pembayaran kamu secara otomatis...
                    </div>
                  )}

                  <div className="mt-6 w-full rounded-lg bg-[#1C1410] p-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-[#B8A896]">Total Bayar</span>
                      <span className="font-medium text-[#F0E6D8]">{formatRupiah(order.total_amount)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 4: Success */}
              {checkoutStep === 'success' && order && (
                <div className="flex flex-col items-center pt-6 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#C99A3D]/15">
                    <Coffee size={28} color="#C99A3D" />
                  </div>
                  <h3 className="font-serif text-xl text-[#F0E6D8]">Pembayaran Berhasil!</h3>
                  <p className="mt-1.5 text-xs text-[#B8A896]">
                    Pesanan <span className="font-mono font-semibold text-[#F0E6D8]">{order.order_number}</span> sudah kami terima.
                  </p>

                  <div className="mt-5 w-full rounded-xl border border-[#3A2A1E] bg-[#1C1410] p-4 text-left text-xs text-[#B8A896]">
                    <div className="flex justify-between py-1 border-b border-[#3A2A1E]/50">
                      <span>No. Pesanan</span>
                      <span className="font-mono text-[#F0E6D8]">{order.order_number}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-[#3A2A1E]/50">
                      <span>Metode Pembayaran</span>
                      <span className="capitalize text-[#F0E6D8]">
                        {paymentMethod === 'qris' ? 'QRIS' : paymentMethod === 'bca_va' ? 'Virtual Account BCA' : 'Kartu'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-[#3A2A1E]/50">
                      <span>Status Pembayaran</span>
                      <span className="font-semibold text-emerald-400">Lunas (Settlement)</span>
                    </div>
                    <div className="flex justify-between py-1.5 pt-2">
                      <span>Total Transaksi</span>
                      <span className="font-semibold text-[#F0E6D8]">{formatRupiah(order.total_amount)}</span>
                    </div>
                  </div>

                  <p className="mt-4 text-xs text-[#8A7A68]">
                    Terima kasih telah berbelanja di Kbeans. Tim roaster kami segera menyiapkan biji kopi segar pesanan Anda! ☕
                  </p>
                </div>
              )}
            </div>

            {/* ---------- Footer actions per step ---------- */}
            {checkoutStep === 'cart' && cart.length > 0 && (
              <div className="border-t border-[#3A2A1E] px-6 py-5">
                <div className="mb-4 flex items-center justify-between text-sm">
                  <span className="text-[#B8A896]">Subtotal</span>
                  <span className="font-medium text-[#F0E6D8]">{formatRupiah(cartTotal)}</span>
                </div>
                <button
                  onClick={() => setCheckoutStep('form')}
                  className="w-full rounded-full bg-[#C99A3D] py-3 text-sm font-medium text-[#1C1410] transition hover:bg-[#DBAE55]"
                >
                  Lanjut ke Checkout
                </button>
              </div>
            )}

            {checkoutStep === 'form' && (
              <div className="border-t border-[#3A2A1E] px-6 py-5">
                <div className="mb-4 flex items-center justify-between text-sm">
                  <span className="text-[#B8A896]">Total {fulfillmentType === 'delivery' ? '(+ongkir)' : ''}</span>
                  <span className="font-medium text-[#F0E6D8]">{formatRupiah(grandTotal)}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCheckoutStep('cart')}
                    className="rounded-full border border-[#3A2A1E] px-4 py-3 text-sm text-[#B8A896] hover:border-[#C99A3D]"
                  >
                    Kembali
                  </button>
                  <button
                    onClick={placeOrder}
                    disabled={placingOrder || !customerName || !customerPhone || (fulfillmentType === 'delivery' && !deliveryAddress)}
                    className="flex-1 rounded-full bg-[#C99A3D] py-3 text-sm font-medium text-[#1C1410] transition hover:bg-[#DBAE55] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {placingOrder ? 'Memproses...' : 'Buat Pesanan'}
                  </button>
                </div>
              </div>
            )}

            {checkoutStep === 'payment' && paymentMethod === 'credit_card' && (
              <div className="border-t border-[#3A2A1E] px-6 py-5">
                <button
                  onClick={() => setCheckoutStep('form')}
                  className="w-full rounded-full border border-[#3A2A1E] py-3 text-sm text-[#B8A896] hover:border-[#C99A3D]"
                >
                  Ganti Metode Pembayaran
                </button>
              </div>
            )}

            {checkoutStep === 'payment' && paymentMethod !== 'credit_card' && (
              <div className="space-y-3 border-t border-[#3A2A1E] px-6 py-5">
                {paymentFailed ? (
                  <button
                    onClick={resetCheckout}
                    className="w-full rounded-full bg-[#C99A3D] py-3 text-sm font-medium text-[#1C1410] transition hover:bg-[#DBAE55]"
                  >
                    Buat Pesanan Baru
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setCheckoutStep('form')}
                      className="w-full rounded-full border border-[#3A2A1E] py-3 text-sm text-[#B8A896] transition hover:border-[#C99A3D] hover:text-[#C99A3D]"
                    >
                      Ganti Metode Pembayaran
                    </button>
                    <p className="text-center text-[11px] text-[#8A7A68]">
                      Status pembayaran dicek langsung ke Midtrans. Jangan tutup halaman ini sebelum pembayaran selesai.
                    </p>
                  </>
                )}
              </div>
            )}

            {checkoutStep === 'success' && (
              <div className="space-y-2.5 border-t border-[#3A2A1E] px-6 py-5">
                <button
                  onClick={resetCheckout}
                  className="w-full rounded-full bg-[#C99A3D] py-3 text-sm font-semibold text-[#1C1410] transition hover:bg-[#DBAE55]"
                >
                  Belanja Lagi
                </button>
                {currentUser?.role === 'admin' && (
                  <a
                    href="/admin"
                    className="block w-full rounded-full border border-[#3A2A1E] py-2.5 text-center text-xs font-medium text-[#C99A3D] transition hover:border-[#C99A3D]"
                  >
                    Buka Dashboard Admin
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Product card
// ----------------------------------------------------------------
function ProductCard({ product, onAdd }: { product: Product; onAdd: () => void }) {
  const outOfStock = product.stock_quantity <= 0;
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-[#3A2A1E] bg-[#221812] transition hover:border-[#C99A3D]/50">
      <div className="relative aspect-[4/3] overflow-hidden bg-[#2E2018]">
        {!imgFailed ? (
          <img
            src={product.image_url}
            alt={product.name}
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          // Fallback otomatis kalau foto belum ada / gagal dimuat
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              background: `radial-gradient(circle at 30% 30%, ${roastColor[product.roast_level]}55, #1C1410 75%)`,
            }}
          >
            <Coffee size={56} strokeWidth={1.2} color={roastColor[product.roast_level]} opacity={0.85} />
          </div>
        )}
        <div
          title={roastLabel[product.roast_level]}
          className="absolute right-3 top-3 h-4 w-4 rounded-full border border-[#1C1410]/40"
          style={{ backgroundColor: roastColor[product.roast_level] }}
        />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-serif text-lg leading-snug text-[#F0E6D8]">{product.name}</h3>

        <div className="flex items-center gap-1 text-xs text-[#B8A896]">
          <MapPin size={12} />
          {product.origin}
        </div>

        <p className="text-xs leading-relaxed text-[#B8A896] line-clamp-2">{product.tasting_notes}</p>

        <div className="mt-auto flex items-center justify-between pt-3">
          <div>
            <p className="text-sm font-medium text-[#F0E6D8]">{formatRupiah(product.price)}</p>
            <p className="text-[11px] text-[#8A7A68]">{product.unit}</p>
          </div>
          <button
            onClick={onAdd}
            disabled={outOfStock}
            className="rounded-full border border-[#C99A3D] px-4 py-1.5 text-xs font-medium text-[#C99A3D] transition hover:bg-[#C99A3D] hover:text-[#1C1410] disabled:cursor-not-allowed disabled:border-[#3A2A1E] disabled:text-[#5A4A3E]"
          >
            {outOfStock ? 'Stok Habis' : 'Tambah'}
          </button>
        </div>
      </div>
    </div>
  );
}
