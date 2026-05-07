/**
 * js/api-helper.js
 * Helper untuk fetch API dengan JWT token otomatis
 * Include file ini di semua halaman HTML sebelum script lainnya
 */

const API = {
  // ── Token Management ───────────────────────────────────────
  getToken() {
    return localStorage.getItem('kontrakan_token');
  },
  setToken(token) {
    localStorage.setItem('kontrakan_token', token);
  },
  removeToken() {
    localStorage.removeItem('kontrakan_token');
    localStorage.removeItem('kontrakan_user');
  },
  getUser() {
    try {
      return JSON.parse(localStorage.getItem('kontrakan_user') || 'null');
    } catch { return null; }
  },
  setUser(user) {
    localStorage.setItem('kontrakan_user', JSON.stringify(user));
  },

  // ── Core Fetch with JWT ────────────────────────────────────
  async fetch(url, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };

    const response = await fetch(url, { ...options, headers });

    // Auto redirect ke login jika 401
    if (response.status === 401) {
      this.removeToken();
      if (!window.location.pathname.includes('login')) {
        window.location.href = '/login.html';
      }
      return null;
    }

    return response;
  },

  // ── Auth ───────────────────────────────────────────────────
  async login(username, password) {
    const res = await fetch('/api/auth?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.token) {
      this.setToken(data.token);
      this.setUser(data.user);
    }
    return data;
  },

  async logout() {
    await this.fetch('/api/auth?action=logout', { method: 'POST' });
    this.removeToken();
    window.location.href = '/login.html';
  },

  async me() {
    const res = await this.fetch('/api/auth?action=me');
    if (!res) return null;
    return res.json();
  },

  // ── Check Auth (panggil di setiap halaman protected) ──────
  checkAuth() {
    const token = this.getToken();
    const user = this.getUser();
    if (!token || !user) {
      window.location.href = '/login.html';
      return null;
    }
    return user;
  },

  // ── Cloudinary Upload Helper ───────────────────────────────
  async uploadToCloudinary(file) {
    const cloudName = window.CLOUDINARY_CLOUD_NAME || '';
    const uploadPreset = window.CLOUDINARY_UPLOAD_PRESET || 'kontrakan_unsigned';

    if (!cloudName) {
      console.error('CLOUDINARY_CLOUD_NAME tidak di-set di config.js');
      return null;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', 'kontrakan/receipts');

    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    return data.secure_url || null;
  },
};

// Expose globally
window.API = API;
