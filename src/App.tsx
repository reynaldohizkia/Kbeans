import { useEffect, useMemo, useState } from 'react';
import { X, ShoppingBag, Minus, Plus, MapPin, Coffee } from 'lucide-react';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------
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
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'qris' | 'bca_va' | 'credit_card'>('qris');
  const [placingOrder, setPlacingOrder] = useState(false);
  const [order, setOrder] = useState<{ order_id: string; order_number: string; total_amount: number } | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [vaNumber, setVaNumber] = useState('');
  const [chargeError, setChargeError] = useState('');

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
      if (!data.success) return;

      setOrder({ order_id: data.order_id, order_number: data.order_number, total_amount: data.total_amount });

      if (paymentMethod === 'credit_card') {
        // Kartu kredit belum diaktifkan di versi ini -- perlu Midtrans Snap
        // untuk tokenisasi kartu yang aman (lihat catatan keamanan).
        setCheckoutStep('payment');
        return;
      }

      // Panggil Midtrans Core API sungguhan untuk QRIS / Virtual Account
      const chargeRes = await fetch('/api/midtrans/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: data.order_id, payment_method: paymentMethod }),
      });
      const chargeData = await chargeRes.json();

      if (!chargeData.success) {
        setChargeError(chargeData.message || 'Gagal membuat transaksi pembayaran.');
        return;
      }

      if (paymentMethod === 'qris') setQrUrl(chargeData.qr_url);
      if (paymentMethod === 'bca_va') setVaNumber(chargeData.va_number);

      setCheckoutStep('payment');
    } catch (e) {
      console.error(e);
      setChargeError('Terjadi kesalahan jaringan.');
    } finally {
      setPlacingOrder(false);
    }
  };

  // Polling status pembayaran setiap 4 detik selagi menunggu di layar QR/VA,
  // supaya begitu pembeli benar-benar bayar (webhook Midtrans masuk),
  // halaman otomatis pindah ke layar sukses tanpa perlu tombol manual.
  useEffect(() => {
    if (checkoutStep !== 'payment' || !order || paymentMethod === 'credit_card') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${order.order_id}/status`);
        const data = await res.json();
        if (data.payment_status === 'settlement') {
          setCheckoutStep('success');
          clearInterval(interval);
        }
      } catch {
        /* diamkan, coba lagi di interval berikutnya */
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [checkoutStep, order, paymentMethod]);

  // Jalur cadangan sementara selagi menunggu aktivasi channel Midtrans --
  // menandai pesanan lunas secara manual tanpa lewat Midtrans sungguhan.
  const confirmPayment = async () => {
    if (!order) return;
    setConfirmingPayment(true);
    try {
      await fetch('/api/midtrans/simulate-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.order_id }),
      });
      setCheckoutStep('success');
    } catch (e) {
      console.error(e);
    } finally {
      setConfirmingPayment(false);
    }
  };

  const resetCheckout = () => {
    setCart([]);
    setCheckoutStep('cart');
    setCustomerName('');
    setCustomerPhone('');
    setDeliveryAddress('');
    setOrder(null);
    setQrUrl('');
    setVaNumber('');
    setChargeError('');
    setCartOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#1C1410] text-[#F0E6D8] font-sans">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-30 border-b border-[#3A2A1E] bg-[#1C1410]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="font-serif text-2xl tracking-tight text-[#F0E6D8]">
            Kbeans
          </div>
          <button
            onClick={() => setCartOpen(true)}
            className="relative flex items-center gap-2 rounded-full border border-[#3A2A1E] px-4 py-2 text-sm text-[#F0E6D8] transition hover:border-[#C99A3D]"
          >
            <ShoppingBag size={16} />
            Keranjang
            {cartCount > 0 && (
              <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#C99A3D] text-xs font-medium text-[#1C1410]">
                {cartCount}
              </span>
            )}
          </button>
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
                  <p className="mt-8 text-center text-sm text-[#B8A896]">Keranjang masih kosong. Ayo pilih kopi favoritmu.</p>
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
                    <p className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{chargeError}</p>
                  )}

                  {paymentMethod === 'qris' && qrUrl && (
                    <>
                      <div className="rounded-xl bg-white p-3">
                        <img src={qrUrl} alt="QRIS Midtrans" width={200} height={200} />
                      </div>
                      <p className="mt-4 text-xs text-[#B8A896]">Scan QR ini pakai aplikasi e-wallet/mobile banking kamu</p>
                    </>
                  )}

                  {paymentMethod === 'bca_va' && vaNumber && (
                    <div className="w-full rounded-xl border border-[#3A2A1E] bg-[#1C1410] p-5">
                      <p className="text-xs text-[#B8A896]">Nomor Virtual Account BCA</p>
                      <p className="mt-1 font-mono text-xl tracking-wider text-[#F0E6D8]">{vaNumber}</p>
                    </div>
                  )}

                  {paymentMethod === 'credit_card' && (
                    <div className="w-full rounded-xl border border-[#3A2A1E] bg-[#1C1410] p-5">
                      <p className="text-sm text-[#B8A896]">Pembayaran kartu kredit/debit memerlukan integrasi Midtrans Snap tersendiri demi keamanan data kartu. Silakan pilih QRIS atau Virtual Account untuk sekarang.</p>
                    </div>
                  )}

                  {(qrUrl || vaNumber) && (
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
                <div className="flex flex-col items-center pt-8 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#C99A3D]/15">
                    <Coffee size={26} color="#C99A3D" />
                  </div>
                  <h3 className="font-serif text-xl text-[#F0E6D8]">Pembayaran Berhasil!</h3>
                  <p className="mt-2 text-sm text-[#B8A896]">
                    Pesanan <span className="text-[#F0E6D8]">{order.order_number}</span> sedang kami siapkan.
                  </p>
                  <p className="mt-1 text-sm text-[#B8A896]">Terima kasih sudah belanja di Kbeans ☕</p>
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
                <button
                  onClick={confirmPayment}
                  disabled={confirmingPayment}
                  className="w-full rounded-full bg-[#C99A3D] py-3 text-sm font-medium text-[#1C1410] transition hover:bg-[#DBAE55] disabled:opacity-50"
                >
                  {confirmingPayment ? 'Memproses...' : 'Simulasikan Pembayaran Berhasil'}
                </button>
                <p className="text-center text-[11px] text-[#8A7A68]">
                  * Mode cadangan sementara -- dipakai selagi menunggu aktivasi channel Midtrans.
                </p>
              </div>
            )}

            {checkoutStep === 'success' && (
              <div className="border-t border-[#3A2A1E] px-6 py-5">
                <button
                  onClick={resetCheckout}
                  className="w-full rounded-full border border-[#C99A3D] py-3 text-sm font-medium text-[#C99A3D] transition hover:bg-[#C99A3D] hover:text-[#1C1410]"
                >
                  Belanja Lagi
                </button>
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
