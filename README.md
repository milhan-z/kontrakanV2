# KontrakanV2

![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js&logoColor=white)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-supported-5A0FC8)

**KontrakanV2** adalah aplikasi manajemen keuangan kontrakan berbasis **Vercel Serverless Functions** dan **PostgreSQL**.

Project ini membantu penghuni kontrakan, rumah sewa bersama, atau komunitas kecil untuk mencatat pengeluaran, menghitung settlement, mengelola data penghuni, dan menyimpan bukti pembayaran secara lebih rapi dan transparan.

> English: KontrakanV2 is an open-source rental finance management app for shared housing communities, built with Vercel Serverless Functions and PostgreSQL.

---

## Features

- JWT Authentication
- Tenant Management
- Expense Tracking
- Settlement & Balance Calculation
- Payment Proof Uploads
- Push Notifications
- Progressive Web App (PWA)
- Vercel Serverless Deployment

---

## Tech Stack

- Node.js 24.x
- PostgreSQL
- Vercel Serverless Functions
- JSON Web Token (JWT)
- bcryptjs
- Cloudinary
- web-push
- multer

---

## Getting Started

### Clone Repository

```bash
git clone https://github.com/milhan-z/kontrakanV2.git
cd kontrakanV2
```

### Install Dependencies

```bash
npm install
```

### Setup Environment Variables

Create `.env.local` file:

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

### Run Locally

```bash
npm run dev
```

---

## Deployment

```bash
vercel login
vercel --prod
```

---

## Roadmap

- Add screenshots and demo video
- Add API documentation
- Improve automated tests
- Add role-based access control
- Multi-house support
- Export reports

---

## Contributing

Contributions are welcome.

You can help by:

- Reporting bugs
- Suggesting features
- Improving documentation
- Submitting pull requests

---

## License

MIT License
