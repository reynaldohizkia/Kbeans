import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

interface QrCanvasProps {
  /** String EMVCo asli dari payment gateway (Xendit) */
  value: string;
  size?: number;
  onError?: (message: string) => void;
}

/**
 * Merender QRIS dari string EMVCo yang diberikan gateway.
 *
 * Render dilakukan di browser, bukan lewat layanan pihak ketiga, karena
 * string-nya berisi instruksi pembayaran sungguhan. Mengirim string ini ke
 * server gambar eksternal sama dengan membocorkan detail transaksi, dan QR
 * yang dirender ulang dari teks buatan sendiri justru QR palsu yang tidak
 * bisa dibayar.
 */
export default function QrCanvas({ value, size = 220, onError }: QrCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!value || !canvasRef.current) return;

    let cancelled = false;

    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    })
      .then(() => {
        if (!cancelled) setFailed(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFailed(true);
        onError?.(`Gagal membuat kode QR dari data gateway: ${String(err)}`);
      });

    return () => {
      cancelled = true;
    };
  }, [value, size, onError]);

  if (failed) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center rounded-lg bg-white p-3 text-center text-[11px] text-red-500"
      >
        Gagal membuat kode QR. Muat ulang halaman.
      </div>
    );
  }

  return <canvas ref={canvasRef} width={size} height={size} className="rounded-lg" />;
}
