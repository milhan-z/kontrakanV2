# Rencana Implementasi Kontrakan V2

Dokumen ini jadi catatan kerja agar pengembangan tidak loncat-loncat dan tetap aman untuk Vercel Hobby.

## Status Terakhir

- Push notification sudah diperbaiki dan statusnya lebih jelas di Profil.
- Jastip sudah punya flow open, nitip banyak item, owner checklist, reopen, close, complete, delete history.
- Riwayat transaksi sudah menyatukan transaksi biasa dan jastip.
- Riwayat transaksi bisa diexport ke CSV sesuai filter aktif.
- Riwayat pembayaran bisa diexport ke CSV sesuai filter user dan tanggal.
- Detail transaksi sudah menampilkan rincian item split bill/jastip.
- Halaman Bayar/Tagih sudah lebih aman dari error inline handler dan punya shortcut chat WA.
- Serverless function tetap 12 file, masih aman untuk batas Vercel Hobby.

## Prioritas Berikutnya

### 1. Backup dan Audit Data

Tujuan: kalau ada selisih tagihan, data bisa dicek tanpa buka database.

- Export riwayat transaksi sesuai filter ke CSV.
- Export pembayaran ke CSV. (selesai)
- Ringkasan bulanan: total per kategori, total per user, jastip selesai.
- Admin audit log untuk aksi penting: reset password, edit user, hapus transaksi, hapus jastip, reset data.

### 2. Admin Panel Lebih Aman

Tujuan: admin bisa beresin masalah tanpa takut salah hapus.

- Tambahkan tab/log aktivitas admin.
- Konfirmasi delete yang lebih spesifik per objek.
- Detail jastip di admin: item, penitip, status, harga final.
- Filter admin yang lebih cepat: aktif, ditutup, selesai, batal.

### 3. Bayar dan Tagih V2

Tujuan: pembayaran makin jelas untuk semua penghuni.

- Tombol chat WA untuk bayar dan tagih dengan template yang rapi.
- Bukti transfer tampil di timeline detail pembayaran.
- Status pembayaran parsial/lunas lebih eksplisit.
- Empty/error state di halaman `settle.html` dibuat sekonsisten Dashboard/Riwayat.

### 4. Notifikasi In-App

Tujuan: notif tidak cuma badge, tapi bisa dipahami sebagai inbox.

- Kelompokkan notif: Jastip, Tagihan, Pembayaran, Info.
- Mark read per item.
- Link notif langsung ke detail terkait.
- Badge per kategori bila perlu.

### 5. Onboarding Final

Tujuan: user baru cepat paham tanpa harus dijelaskan manual.

- Tour bisa pindah halaman dan highlight elemen yang tepat.
- Tambahkan tombol aksi di step tour: buka Jastip, isi Profil, aktifkan Notif.
- Tambahkan reset tour di Profil.
- Mini tips hanya muncul saat user belum pernah memakai fitur tersebut.

## Paket Implementasi Berurutan

1. Export CSV riwayat transaksi. (selesai)
2. Export CSV riwayat pembayaran. (selesai)
3. Admin audit log dasar.
4. Detail jastip admin.
5. Notifikasi inbox grouping.
6. Onboarding action tour.

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
