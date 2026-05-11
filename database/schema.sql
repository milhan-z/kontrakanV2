-- =========================================
-- Catatan Kontrakan V2 - PostgreSQL Schema
-- Untuk: Supabase (supabase.com)
-- =========================================
-- Cara pakai:
-- 1. Buka Supabase Dashboard → SQL Editor
-- 2. Copy-paste seluruh isi file ini
-- 3. Klik "Run"
-- =========================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name  VARCHAR(100) NOT NULL,
    phone_wa      VARCHAR(20) DEFAULT NULL,
    role          VARCHAR(10) DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    -- Legacy payment fields
    bank_name     VARCHAR(100) DEFAULT NULL,
    bank_account  VARCHAR(100) DEFAULT NULL,
    ewallet_type  VARCHAR(50) DEFAULT NULL,
    ewallet_number VARCHAR(50) DEFAULT NULL,
    qris_image    VARCHAR(255) DEFAULT NULL,
    -- New multi-method JSON field
    payment_methods JSONB DEFAULT NULL,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id            SERIAL PRIMARY KEY,
    paid_by       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount        DECIMAL(12, 2) NOT NULL,
    description   VARCHAR(255) NOT NULL,
    category      VARCHAR(50) NOT NULL,
    receipt_image VARCHAR(255) DEFAULT NULL, -- Cloudinary URL
    qty           INT NOT NULL DEFAULT 1,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Expense splits
CREATE TABLE IF NOT EXISTS expense_splits (
    id          SERIAL PRIMARY KEY,
    expense_id  INT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount      DECIMAL(12, 2) NOT NULL,
    items       JSONB DEFAULT NULL,
    is_paid     BOOLEAN DEFAULT FALSE
);

-- Settlements
CREATE TABLE IF NOT EXISTS settlements (
    id            SERIAL PRIMARY KEY,
    from_user     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount        DECIMAL(12, 2) NOT NULL,
    receipt_image VARCHAR(255) DEFAULT NULL, -- Cloudinary URL
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id         SERIAL PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      VARCHAR(100) NOT NULL,
    message    TEXT NOT NULL,
    type       VARCHAR(20) DEFAULT 'info' CHECK (type IN ('expense', 'settlement', 'info')),
    related_id INT DEFAULT NULL,
    is_read    BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Info Kontrakan
CREATE TABLE IF NOT EXISTS info_kontrakan (
    id         SERIAL PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      VARCHAR(255) NOT NULL,
    content    TEXT DEFAULT NULL,
    image_path VARCHAR(255) DEFAULT NULL, -- Cloudinary URL
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =========================================
-- Index untuk performa
-- =========================================
CREATE INDEX IF NOT EXISTS idx_expenses_paid_by    ON expenses(paid_by);
CREATE INDEX IF NOT EXISTS idx_expense_splits_exp  ON expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_user ON expense_splits(user_id);
CREATE INDEX IF NOT EXISTS idx_settlements_from    ON settlements(from_user);
CREATE INDEX IF NOT EXISTS idx_settlements_to      ON settlements(to_user);
CREATE INDEX IF NOT EXISTS idx_notifications_user  ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read  ON notifications(user_id, is_read);

-- Jastip / Titip Belanja
CREATE TABLE IF NOT EXISTS jastip_orders (
    id SERIAL PRIMARY KEY,
    opened_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(120) NOT NULL,
    note TEXT DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    closes_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    expense_id INT REFERENCES expenses(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS jastip_items (
    id SERIAL PRIMARY KEY,
    jastip_id INT NOT NULL REFERENCES jastip_orders(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_name VARCHAR(160) NOT NULL,
    requested_qty INT NOT NULL DEFAULT 1,
    note TEXT DEFAULT NULL,
    estimated_price DECIMAL(12,2) DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'requested',
    final_qty INT DEFAULT NULL,
    final_price DECIMAL(12,2) DEFAULT NULL,
    final_note TEXT DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jastip_orders_status ON jastip_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jastip_items_order ON jastip_items(jastip_id);
CREATE INDEX IF NOT EXISTS idx_jastip_items_user ON jastip_items(user_id);

-- Push Notifications Subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    subscription JSONB NOT NULL,
    user_agent TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- App settings / one-time migration flags
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =========================================
-- Default Users
-- Setelah import schema, ganti password tiap user dari admin panel
-- atau set hash milikmu sendiri sebelum dipakai di production.
-- =========================================
INSERT INTO users (username, password_hash, display_name, role, must_change_password) VALUES
('admin', '$2a$10$MN7Wy0PwAT5yCCMVID.b4uOj5EcA90/n7ezHEVBu3t4YUKsiIvmfC', 'Hilman', 'admin', FALSE),
('arkan',  '$2a$10$shj1n0fgpSesySekx7B0ueQPQbcQ5zYuMs81wvy0a1vEusOnGiQk2', 'Arkan', 'member', FALSE),
('rafli',  '$2a$10$shj1n0fgpSesySekx7B0ueQPQbcQ5zYuMs81wvy0a1vEusOnGiQk2', 'Rafli', 'member', FALSE),
('rafi',   '$2a$10$shj1n0fgpSesySekx7B0ueQPQbcQ5zYuMs81wvy0a1vEusOnGiQk2', 'Rafi', 'member', FALSE),
('kahfi',  '$2a$10$shj1n0fgpSesySekx7B0ueQPQbcQ5zYuMs81wvy0a1vEusOnGiQk2', 'Kahfi', 'member', FALSE),
('alromy', '$2a$10$shj1n0fgpSesySekx7B0ueQPQbcQ5zYuMs81wvy0a1vEusOnGiQk2', 'Al Romy', 'member', FALSE),
('lutfan', '$2a$10$shj1n0fgpSesySekx7B0ueQPQbcQ5zYuMs81wvy0a1vEusOnGiQk2', 'Lutfan', 'member', FALSE)
ON CONFLICT (username) DO NOTHING;
