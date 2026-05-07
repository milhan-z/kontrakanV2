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
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Expense splits
CREATE TABLE IF NOT EXISTS expense_splits (
    id          SERIAL PRIMARY KEY,
    expense_id  INT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount      DECIMAL(12, 2) NOT NULL,
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

-- =========================================
-- Default Users (password: kontrakan123)
-- Hash dibuat dengan bcrypt cost 10
-- Generate baru: node -e "const b=require('bcryptjs');console.log(b.hashSync('kontrakan123',10))"
-- =========================================
INSERT INTO users (username, password_hash, display_name, role) VALUES
('hilman', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Hilman', 'admin'),
('arkan',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Arkan', 'member'),
('rafli',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Rafli', 'member'),
('rafi',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Rafi', 'member'),
('kahfi',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Kahfi', 'member'),
('alromy', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Al Romy', 'member'),
('lutfan', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Lutfan', 'member')
ON CONFLICT (username) DO NOTHING;
