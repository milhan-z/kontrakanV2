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
DATABASE_URL=
JWT_SECRET=

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

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

Pastikan DATABASE_URL valid.

## JWT Error

Pastikan JWT_SECRET terisi.

## Cloudinary Error

Pastikan config Cloudinary benar.

## Notification Error

Pastikan VAPID key valid.
