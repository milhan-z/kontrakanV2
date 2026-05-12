# Rencana Implementasi Kontrakan V2

Dokumen ini jadi catatan kerja agar pengembangan tidak loncat-loncat dan tetap aman untuk Vercel Hobby.

## Status Terakhir

- Push notification sudah diperbaiki dan statusnya lebih jelas di Profil.
- Info kontrakan baru mengirim notifikasi in-app dan push ke penghuni lain.
- Jastip sudah punya flow open, nitip banyak item, owner checklist, reopen, close, complete, delete history.
- Riwayat transaksi sudah menyatukan transaksi biasa dan jastip.
- Filter Riwayat member memakai bottom sheet model GoPay untuk tanggal, kategori, dan pencarian.
- Export CSV dipusatkan di Admin untuk transaksi dan pembayaran.
- Detail transaksi sudah menampilkan rincian item split bill/jastip.
- Halaman Bayar/Tagih sudah lebih aman dari error inline handler dan punya shortcut chat WA.
- Halaman Bayar/Tagih kini memuat patch detail hutang/piutang aktif, status pembayaran lebih eksplisit, dan empty/error state lebih jelas.
- Admin panel punya audit log dasar untuk aksi penting admin.
- Admin panel bisa membuka detail jastip: daftar item, status hasil belanja, total final, dan rekap penitip.
- Admin dashboard punya ringkasan bulan ini dan filter cepat Jastip.
- Konfirmasi hapus/reset admin dibuat lebih spesifik untuk transaksi, pembayaran, info, dan jastip.
- Notifikasi in-app sudah jadi inbox berkategori dengan mark read per item dan link ke halaman terkait.
- Onboarding tour bisa pindah halaman, punya tombol aksi fitur, dan bisa direset dari Profil.
- Mini tips fitur muncul setelah tour selesai dan berhenti muncul setelah ditutup/dipakai.
- Serverless function tetap 12 file, masih aman untuk batas Vercel Hobby.

## Prioritas Berikutnya

### 1. Backup dan Audit Data

Tujuan: kalau ada selisih tagihan, data bisa dicek tanpa buka database.

- Export riwayat transaksi sesuai filter ke CSV di Admin. (selesai)
- Export pembayaran ke CSV di Admin. (selesai)
- Ringkasan bulanan: total per kategori, total per user, jastip selesai. (selesai)
- Admin audit log untuk aksi penting: reset password, edit user, hapus user, hapus jastip, reset data. (dasar selesai)

### 2. Admin Panel Lebih Aman

Tujuan: admin bisa beresin masalah tanpa takut salah hapus.

- Tambahkan tab/log aktivitas admin. (selesai)
- Konfirmasi delete yang lebih spesifik per objek. (selesai)
- Detail jastip di admin: item, penitip, status, harga final. (selesai)
- Filter admin yang lebih cepat: aktif, ditutup, selesai, batal. (selesai untuk Jastip)

### 3. Bayar dan Tagih V2

Tujuan: pembayaran makin jelas untuk semua penghuni.

- Tombol chat WA untuk bayar dan tagih dengan template yang rapi.
- Bukti transfer tampil di detail pembayaran dan bisa dibuka dari riwayat/detail. (selesai)
- Status pembayaran parsial/lunas lebih eksplisit. (selesai)
- Empty/error state di halaman `settle.html` dibuat sekonsisten Dashboard/Riwayat. (selesai)

### 4. Notifikasi In-App

Tujuan: notif tidak cuma badge, tapi bisa dipahami sebagai inbox.

- Kelompokkan notif: Jastip, Tagihan, Pembayaran, Info. (selesai)
- Mark read per item. (selesai)
- Link notif langsung ke halaman terkait. (selesai)
- Badge per kategori. (selesai)

### 5. Onboarding Final

Tujuan: user baru cepat paham tanpa harus dijelaskan manual.

- Tour bisa pindah halaman dan highlight elemen yang tepat. (selesai)
- Tambahkan tombol aksi di step tour: buka Jastip, isi Profil, aktifkan Notif. (selesai)
- Tambahkan reset tour di Profil. (selesai)
- Mini tips hanya muncul saat user belum pernah memakai fitur tersebut. (selesai)

## Paket Implementasi Berurutan

1. Export CSV riwayat transaksi. (selesai)
2. Export CSV riwayat pembayaran. (selesai)
3. Admin audit log dasar. (selesai)
4. Detail jastip admin. (selesai)
5. Notifikasi inbox grouping. (selesai)
6. Onboarding action tour. (selesai)

## Catatan Teknis

- Jangan menambah file baru di folder `api` kecuali sangat perlu.
- Jika butuh endpoint baru, gabungkan ke endpoint yang sudah ada lewat `action`.
- Setelah perubahan frontend penting, bump `CACHE_NAME` di `sw.js`.
- Minimal check sebelum push:
  - `node --check js/app.js`
  - inline script check untuk HTML yang berubah
  - `npm.cmd run check`
  - `git diff --check`
  - count `api/*.js` tetap `<= 12`
