/**
 * api/upload.js — Upload API via Cloudinary (Pengganti upload.php)
 * POST → Upload image ke Cloudinary, return URL
 *
 * NOTE: Karena Vercel Serverless tidak support file system permanen,
 *       semua upload gambar dikirim ke Cloudinary (gratis 25GB).
 *       Frontend upload langsung ke Cloudinary pakai unsigned preset,
 *       lalu kirim URL ke API ini untuk validasi & simpan ke DB.
 *
 *       Alternatif: Frontend upload langsung ke Cloudinary Widget
 *       tanpa melewati serverless function ini.
 */

const { v2: cloudinary } = require('cloudinary');
const { setCors, jsonResponse, requireAuth, handleOptions } = require('../lib/db');

cloudinary.config({
  cloud_name:  process.env.CLOUDINARY_CLOUD_NAME,
  api_key:     process.env.CLOUDINARY_API_KEY,
  api_secret:  process.env.CLOUDINARY_API_SECRET,
});

// Vercel config untuk handle body sebagai raw buffer
export const config = {
  api: {
    bodyParser: false, // Disable default body parser untuk handle multipart
  },
};

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  const user = requireAuth(req, res);
  if (!user) return;

  // Terima URL dari frontend (setelah upload langsung ke Cloudinary)
  // Atau terima base64 image
  let body = '';
  await new Promise((resolve) => {
    req.on('data', chunk => body += chunk.toString());
    req.on('end', resolve);
  });

  let input;
  try { input = JSON.parse(body); }
  catch { return jsonResponse(res, { error: 'Invalid JSON' }, 400); }

  // Jika frontend kirim base64
  if (input.data) {
    try {
      const result = await cloudinary.uploader.upload(input.data, {
        folder: 'kontrakan/receipts',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        max_bytes: 5 * 1024 * 1024,
      });
      return jsonResponse(res, {
        success: true,
        url: result.secure_url,
        public_id: result.public_id,
        path: result.secure_url,
      });
    } catch (err) {
      return jsonResponse(res, { error: 'Upload failed: ' + err.message }, 500);
    }
  }

  // Jika frontend sudah upload langsung ke Cloudinary dan kirim URL
  if (input.url) {
    return jsonResponse(res, { success: true, url: input.url, path: input.url });
  }

  return jsonResponse(res, { error: 'No image data provided. Send base64 in "data" field or URL in "url" field.' }, 400);
};
