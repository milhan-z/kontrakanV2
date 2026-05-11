# KontrakanV2

Aplikasi manajemen keuangan kontrakan berbasis Vercel Serverless Functions dan PostgreSQL.

## Features

- Authentication JWT
- Manajemen penghuni kontrakan
- Pencatatan pengeluaran
- Settlement & balance calculation
- Upload bukti pembayaran
- Push notification
- Progressive Web App (PWA)
- Deploy via Vercel

---

# Installation

## Clone Repository

```bash
git clone https://github.com/milhan-z/kontrakanV2.git
cd kontrakanV2
```

## Install Dependency

```bash
npm install
```

## Environment Variables

Buat file `.env.local`

```env
DATABASE_URL=postgresql://username:password@host:5432/database
JWT_SECRET=

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com
```

`DATABASE_URL` adalah format utama yang dipakai aplikasi. Variabel `SUPABASE_DB_*` masih dibaca sebagai fallback untuk setup lama, tapi sebaiknya tidak dipakai untuk setup baru.

---

# Running Locally

```bash
npm run dev
```

---

# Deploy Vercel

```bash
vercel login
vercel --prod
```

---

# Troubleshooting

## Database Error

Pastikan `DATABASE_URL` valid. Jika masih memakai setup lama, isi `SUPABASE_DB_HOST` dan `SUPABASE_DB_PASSWORD`.

## JWT Error

Pastikan `JWT_SECRET` terisi. Aplikasi sekarang tidak lagi memakai fallback secret bawaan.

## Cloudinary Error

Pastikan config Cloudinary benar.

## Notification Error

Pastikan `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, dan `VAPID_SUBJECT` terisi. Endpoint `/api/push` akan mengembalikan error konfigurasi jika key belum ada.
