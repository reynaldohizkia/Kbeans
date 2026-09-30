import { useState } from 'react';
import { Coffee, Shield, User, ArrowLeft } from 'lucide-react';

export default function LoginPage() {
  const [roleTab, setRoleTab] = useState<'customer' | 'admin'>('customer');
  const [isRegister, setIsRegister] = useState(false);
  const [isChangePassword, setIsChangePassword] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    try {
      if (isChangePassword) {
        if (newPassword !== confirmPassword) {
          setError('Konfirmasi password baru tidak sama.');
          return;
        }
        if (newPassword.length < 8) {
          setError('Password baru minimal 8 karakter.');
          return;
        }

        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, current_password: password, new_password: newPassword }),
        });
        const data = await res.json();
        if (!data.success) {
          setError(data.message || 'Gagal mengganti password.');
          return;
        }

        setSuccessMsg('Password berhasil diganti. Silakan masuk dengan password baru.');
        setPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setIsChangePassword(false);
        return;
      }

      if (roleTab === 'customer' && isRegister) {
        // Daftar pelanggan baru
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, phone, password }),
        });
        const data = await res.json();
        if (!data.success) {
          setError(data.message || 'Gagal mendaftar');
          return;
        }

        // Simpan sesi login
        localStorage.setItem('kbeans_user', JSON.stringify(data.user));
        setSuccessMsg('Pendaftaran berhasil! Mengalihkan ke toko...');
        setTimeout(() => {
          window.location.href = '/';
        }, 1000);
      } else {
        // Login (pelanggan atau admin)
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!data.success) {
          setError(data.message || 'Email atau password salah');
          return;
        }

        localStorage.setItem('kbeans_user', JSON.stringify(data.user));

        if (data.user.role === 'admin') {
          localStorage.setItem('kbeans_admin_key', data.token);
          setSuccessMsg('Login Admin berhasil! Membuka Dashboard Admin...');
          setTimeout(() => {
            window.location.href = '/admin';
          }, 800);
        } else {
          setSuccessMsg(`Selamat datang kembali, ${data.user.name}!`);
          setTimeout(() => {
            window.location.href = '/';
          }, 800);
        }
      }
    } catch {
      setError('Terjadi gangguan koneksi internet.');
    } finally {
      setLoading(false);
    }
  };

  // Quick Demo Fill
  const fillDemoAdmin = () => {
    setRoleTab('admin');
    setIsRegister(false);
    setIsChangePassword(false);
    setEmail('admin@kbeans.com');
    setPassword('admin123');
    setError('');
  };

  const fillDemoCustomer = () => {
    setRoleTab('customer');
    setIsRegister(false);
    setEmail('pelanggan@gmail.com');
    setPassword('pelanggan123');
    setError('');
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#1C1410] font-sans text-[#F0E6D8]">
      {/* Header */}
      <header className="border-b border-[#3A2A1E] px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <a href="/" className="flex items-center gap-2 font-serif text-2xl text-[#F0E6D8]">
            <Coffee size={24} className="text-[#C99A3D]" />
            Kbeans
          </a>
          <a
            href="/"
            className="flex items-center gap-1.5 rounded-full border border-[#3A2A1E] px-3.5 py-1.5 text-xs text-[#B8A896] transition hover:border-[#C99A3D] hover:text-[#F0E6D8]"
          >
            <ArrowLeft size={14} />
            Kembali ke Toko
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-[#3A2A1E] bg-[#221812] p-8 shadow-2xl">
            <div className="mb-6 text-center">
              <h1 className="font-serif text-2xl font-normal text-[#F0E6D8]">Masuk ke Akun</h1>
              <p className="mt-1 text-xs text-[#B8A896]">
                Pilih peran Anda untuk melanjutkan ke platform Kbeans
              </p>
            </div>

            {/* Role Tabs */}
            <div className="mb-6 flex rounded-xl border border-[#3A2A1E] bg-[#1C1410] p-1">
              <button
                type="button"
                onClick={() => {
                  setRoleTab('customer');
                  setError('');
                }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-medium transition ${
                  roleTab === 'customer'
                    ? 'bg-[#C99A3D] text-[#1C1410] shadow'
                    : 'text-[#B8A896] hover:text-[#F0E6D8]'
                }`}
              >
                <User size={14} />
                Pelanggan
              </button>
              <button
                type="button"
                onClick={() => {
                  setRoleTab('admin');
                  setIsRegister(false);
                  setIsChangePassword(false);
                  setError('');
                }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-medium transition ${
                  roleTab === 'admin'
                    ? 'bg-[#C99A3D] text-[#1C1410] shadow'
                    : 'text-[#B8A896] hover:text-[#F0E6D8]'
                }`}
              >
                <Shield size={14} />
                Admin
              </button>
            </div>

            {/* Sub-toggle Admin (Masuk / Ganti Password) */}
            {roleTab === 'admin' && (
              <div className="mb-5 flex justify-center gap-4 border-b border-[#3A2A1E]/60 pb-3 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setIsChangePassword(false);
                    setError('');
                  }}
                  className={`pb-1 transition ${
                    !isChangePassword
                      ? 'border-b-2 border-[#C99A3D] font-medium text-[#F0E6D8]'
                      : 'text-[#B8A896] hover:text-[#F0E6D8]'
                  }`}
                >
                  Masuk
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsChangePassword(true);
                    setError('');
                    setPassword('');
                  }}
                  className={`pb-1 transition ${
                    isChangePassword
                      ? 'border-b-2 border-[#C99A3D] font-medium text-[#F0E6D8]'
                      : 'text-[#B8A896] hover:text-[#F0E6D8]'
                  }`}
                >
                  Ganti Password
                </button>
              </div>
            )}

            {/* Sub-toggle Pelanggan (Masuk / Daftar) */}
            {roleTab === 'customer' && (
              <div className="mb-5 flex justify-center gap-4 border-b border-[#3A2A1E]/60 pb-3 text-xs">
                <button
                  type="button"
                  onClick={() => setIsRegister(false)}
                  className={`pb-1 transition ${
                    !isRegister
                      ? 'border-b-2 border-[#C99A3D] font-medium text-[#F0E6D8]'
                      : 'text-[#B8A896] hover:text-[#F0E6D8]'
                  }`}
                >
                  Sudah Punya Akun
                </button>
                <button
                  type="button"
                  onClick={() => setIsRegister(true)}
                  className={`pb-1 transition ${
                    isRegister
                      ? 'border-b-2 border-[#C99A3D] font-medium text-[#F0E6D8]'
                      : 'text-[#B8A896] hover:text-[#F0E6D8]'
                  }`}
                >
                  Daftar Akun Baru
                </button>
              </div>
            )}

            {/* Error & Success Messages */}
            {error && (
              <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                {error}
              </div>
            )}
            {successMsg && (
              <div className="mb-4 rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-xs text-green-400">
                {successMsg}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {roleTab === 'customer' && isRegister && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-[#B8A896]">Nama Lengkap</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Nama Anda"
                      className="w-full rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3.5 py-2.5 text-sm text-[#F0E6D8] outline-none transition focus:border-[#C99A3D]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[#B8A896]">Nomor WhatsApp</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="08xxxxxxxxxx"
                      className="w-full rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3.5 py-2.5 text-sm text-[#F0E6D8] outline-none transition focus:border-[#C99A3D]"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="mb-1 block text-xs text-[#B8A896]">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={roleTab === 'admin' ? 'admin@kbeans.com' : 'email@contoh.com'}
                  className="w-full rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3.5 py-2.5 text-sm text-[#F0E6D8] outline-none transition focus:border-[#C99A3D]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[#B8A896]">
                  {isChangePassword ? 'Password Lama' : 'Password'}
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3.5 py-2.5 text-sm text-[#F0E6D8] outline-none transition focus:border-[#C99A3D]"
                />
              </div>

              {isChangePassword && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-[#B8A896]">Password Baru</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimal 8 karakter"
                      className="w-full rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3.5 py-2.5 text-sm text-[#F0E6D8] outline-none transition focus:border-[#C99A3D]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[#B8A896]">Ulangi Password Baru</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Ulangi password baru"
                      className="w-full rounded-lg border border-[#3A2A1E] bg-[#1C1410] px-3.5 py-2.5 text-sm text-[#F0E6D8] outline-none transition focus:border-[#C99A3D]"
                    />
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full rounded-full bg-[#C99A3D] py-3 text-sm font-medium text-[#1C1410] transition hover:bg-[#DBAE55] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? 'Memproses...'
                  : isChangePassword
                  ? 'Simpan Password Baru'
                  : roleTab === 'admin'
                  ? 'Masuk ke Dashboard Admin'
                  : isRegister
                  ? 'Daftar Sebagai Pelanggan'
                  : 'Masuk Sebagai Pelanggan'}
              </button>
            </form>

            {/* Quick Demo Buttons for Assessment */}
            <div className="mt-6 border-t border-[#3A2A1E] pt-5">
              <p className="mb-2.5 text-center text-[11px] font-medium text-[#B8A896]">
                ⚡ Uji Coba Cepat (Khusus Penilaian / Demo Tugas):
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={fillDemoCustomer}
                  className="rounded-lg border border-[#3A2A1E] bg-[#1C1410] p-2 text-left text-[11px] transition hover:border-[#C99A3D]"
                >
                  <span className="block font-semibold text-[#C99A3D]">Demo Pelanggan</span>
                  <span className="text-[10px] text-[#B8A896]">pelanggan@gmail.com</span>
                </button>
                <button
                  type="button"
                  onClick={fillDemoAdmin}
                  className="rounded-lg border border-[#3A2A1E] bg-[#1C1410] p-2 text-left text-[11px] transition hover:border-[#C99A3D]"
                >
                  <span className="block font-semibold text-[#C99A3D]">Demo Admin</span>
                  <span className="text-[10px] text-[#B8A896]">admin@kbeans.com</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
