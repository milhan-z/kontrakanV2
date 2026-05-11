# 🚀 Panduan Deploy Kontrakan V2 ke Vercel

## Stack Baru
| Komponen | Lama (PHP) | Baru (Node.js) |
|---|---|---|
| Backend | PHP + Sessions | Node.js Serverless Functions |
| Database | MySQL (XAMPP) | **PostgreSQL (Supabase)** |
| Auth | PHP Sessions | **JWT Token** |
| File Upload | Penyimpanan lokal | **Cloudinary** |
| Hosting | XAMPP lokal | **Vercel** |

---

## 📋 Langkah 1: Setup Supabase (Database)

1. Daftar di **[supabase.com](https://supabase.com)** (gratis, 500MB)
2. Buat project baru → catat nama project
3. Pergi ke **SQL Editor** → paste isi `database/schema.sql` → klik **Run**
4. Pergi ke **Project Settings → Database**:
   - Copy: **Host**, **Port**, **Database name**, **User**, **Password**

---

## 📋 Langkah 2: Setup Cloudinary (Upload Gambar)

1. Daftar di **[cloudinary.com](https://cloudinary.com)** (gratis, 25GB)
2. Di Dashboard, catat: **Cloud Name**, **API Key**, **API Secret**
3. Buat **Unsigned Upload Preset**:
   - Settings → Upload → Upload Presets → Add Upload Preset
   - Signing mode: **Unsigned**
   - Folder: `kontrakan`
   - Catat nama preset (misal: `kontrakan_unsigned`)
4. Update `js/config.js` dengan Cloud Name dan preset name kamu

---

## 📋 Langkah 3: Deploy ke Vercel

### Option A: Via GitHub (Recommended — Auto-deploy)

```bash
# Di folder Kontrakan_V2
git init
git add .
git commit -m "Initial commit - Kontrakan V2 (Vercel)"
git remote add origin https://github.com/milhan-z/kont-v2.git
git push -u origin main
```

1. Buka **[vercel.com](https://vercel.com)** → Login dengan GitHub
2. **New Project** → Import repo `kont-v2`
3. Vercel auto-detect sebagai Node.js project ✅

### Option B: Via Vercel CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

---

## 📋 Langkah 4: Set Environment Variables di Vercel

Di Vercel Dashboard → Project → **Settings → Environment Variables**, tambahkan:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | `postgresql://user:password@host:5432/postgres` |
| `JWT_SECRET` | `random_string_min_32_chars` |
| `CLOUDINARY_CLOUD_NAME` | `your_cloud_name` |
| `CLOUDINARY_API_KEY` | `your_api_key` |
| `CLOUDINARY_API_SECRET` | `your_api_secret` |
| `VAPID_PUBLIC_KEY` | `your_web_push_public_key` |
| `VAPID_PRIVATE_KEY` | `your_web_push_private_key` |
| `VAPID_SUBJECT` | `mailto:admin@example.com` |

> 💡 Generate JWT_SECRET:
> ```bash
> node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
> ```

> Generate VAPID key untuk push notification:
> ```bash
> npx web-push generate-vapid-keys
> ```

---

## ✅ Setelah Deploy

- URL seperti: `https://kont-v2.vercel.app`
- Login admin: `admin` / `adminkont123`
- Login member: username member masing-masing / `kontrakan123`
- Auto-deploy setiap push ke GitHub!

---

## 🆓 Perbandingan Database Gratis

| Platform | DB Type | Storage Gratis | Catatan |
|---|---|---|---|
| **Supabase** | PostgreSQL | **500MB** | ✅ UI bagus, mudah |
| **Neon** | PostgreSQL | **512MB** | ✅ Serverless, cepat |
| **PlanetScale** | MySQL | ~~5GB~~ | ❌ Free tier dihapus 2024 |
| **Turso** | SQLite (libSQL) | **9GB** | Butuh konversi lebih |
| **Aiven** | MySQL/PG | **5GB trial** | Hanya 30 hari |

**Rekomendasi: Supabase** (paling mudah setup + UI database yang bagus)
