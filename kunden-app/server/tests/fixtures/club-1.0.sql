-- Datenbank im Stand von Version 1.0 (Tabellen ohne Präfix), erzeugt mit dem alten Code.
-- __NOW__ ersetzt der Test durch die aktuelle Zeit. Admin: marius@example.de / geheim-12345
CREATE TABLE admins (id VARCHAR(36) NOT NULL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(190) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at BIGINT NOT NULL,
                last_login_at BIGINT NULL);
CREATE TABLE attempts (id VARCHAR(36) NOT NULL PRIMARY KEY,
                bucket VARCHAR(200) NOT NULL,
                created_at BIGINT NOT NULL);
CREATE TABLE club_orders (order_id VARCHAR(64) NOT NULL PRIMARY KEY,
                member_id VARCHAR(36) NOT NULL,
                name VARCHAR(40) NOT NULL,
                ordered_at BIGINT NOT NULL,
                amount_cents INTEGER NOT NULL DEFAULT 0,
                points INTEGER NOT NULL DEFAULT 0,
                status VARCHAR(12) NOT NULL,
                reason VARCHAR(20) NULL,
                shipped_at BIGINT NULL,
                available_at BIGINT NULL,
                updated_at BIGINT NOT NULL);
CREATE TABLE codes (id VARCHAR(36) NOT NULL PRIMARY KEY,
                member_id VARCHAR(36) NOT NULL,
                code VARCHAR(40) NOT NULL,
                discount_id VARCHAR(80) NULL,
                points INTEGER NOT NULL,
                value_cents INTEGER NOT NULL,
                min_cents INTEGER NOT NULL DEFAULT 0,
                status VARCHAR(12) NOT NULL,
                created_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL,
                used_at BIGINT NULL,
                order_name VARCHAR(40) NULL,
                updated_at BIGINT NOT NULL);
CREATE TABLE ledger (id VARCHAR(36) NOT NULL PRIMARY KEY,
                member_id VARCHAR(36) NOT NULL,
                kind VARCHAR(20) NOT NULL,
                points INTEGER NOT NULL,
                note VARCHAR(255) NULL,
                ref VARCHAR(64) NULL,
                created_by VARCHAR(36) NULL,
                created_at BIGINT NOT NULL);
CREATE TABLE login_codes (id VARCHAR(36) NOT NULL PRIMARY KEY,
                email VARCHAR(190) NOT NULL,
                code_hash VARCHAR(64) NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL);
CREATE TABLE members (id VARCHAR(36) NOT NULL PRIMARY KEY,
                shopify_id VARCHAR(64) NOT NULL,
                email VARCHAR(190) NOT NULL,
                first_name VARCHAR(100) NULL,
                last_name VARCHAR(100) NULL,
                joined_at BIGINT NULL,
                last_seen_at BIGINT NULL,
                orders_synced_at BIGINT NULL,
                meta_dirty SMALLINT NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL);
CREATE TABLE oauth_states (id VARCHAR(64) NOT NULL PRIMARY KEY,
                verifier VARCHAR(128) NULL,
                nonce VARCHAR(64) NOT NULL,
                next_path VARCHAR(200) NULL,
                created_at BIGINT NOT NULL);
CREATE TABLE order_cache (member_id VARCHAR(36) NOT NULL PRIMARY KEY,
                data TEXT NOT NULL,
                fetched_at BIGINT NOT NULL);
CREATE TABLE sessions (id VARCHAR(64) NOT NULL PRIMARY KEY,
                kind VARCHAR(10) NOT NULL,
                subject_id VARCHAR(36) NOT NULL,
                id_token TEXT NULL,
                user_agent VARCHAR(255) NULL,
                created_at BIGINT NOT NULL,
                last_seen_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL);
CREATE TABLE settings (k VARCHAR(100) NOT NULL PRIMARY KEY,
                v TEXT NULL,
                updated_at BIGINT NOT NULL);
CREATE UNIQUE INDEX admins_email ON admins (email);
CREATE INDEX attempts_bucket ON attempts (bucket);
CREATE INDEX club_orders_member ON club_orders (member_id);
CREATE UNIQUE INDEX codes_code ON codes (code);
CREATE INDEX codes_member ON codes (member_id);
CREATE INDEX codes_status ON codes (status);
CREATE INDEX ledger_member ON ledger (member_id);
CREATE INDEX login_codes_email ON login_codes (email);
CREATE INDEX members_email ON members (email);
CREATE UNIQUE INDEX members_shopify ON members (shopify_id);
CREATE INDEX sessions_subject ON sessions (subject_id);
INSERT INTO settings (k, v, updated_at) VALUES ('jobs_lock', 0, (__NOW__ - 4));
INSERT INTO settings (k, v, updated_at) VALUES ('program', '{"name":"Perfume Cloud Club","earn_per_euro":1,"redeem_points":100,"redeem_cents":500,"max_cents":2000,"code_days":90,"wait_days":14,"welcome_points":50,"retro_days":30,"active":true}', (__NOW__ - 0));
INSERT INTO admins (id, name, email, password_hash, created_at, last_login_at) VALUES ('4092f88d-a75c-46de-b770-6ffb895ef9e6', 'Marius', 'marius@example.de', '$2y$10$eYX86lHT.KU0/UM5k8seaeWOvpBkpJejfT1uKcwdrPijKx9QWkjRy', (__NOW__ - 2), (__NOW__ - 2));
INSERT INTO members (id, shopify_id, email, first_name, last_name, joined_at, last_seen_at, orders_synced_at, meta_dirty, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', 'gid://shopify/Customer/1', 'anna@example.de', 'Anna', 'Berg', (__NOW__ - 3456000000), (__NOW__ - 0), (__NOW__ - 0), 0, (__NOW__ - 3456000000), (__NOW__ - 0));
INSERT INTO club_orders (order_id, member_id, name, ordered_at, amount_cents, points, status, reason, shipped_at, available_at, updated_at) VALUES ('gid://shopify/Order/1001', '11111111-1111-4111-8111-111111111111', '#1001', (__NOW__ - 2592000000), 12990, 129, 'available', NULL, (__NOW__ - 2505600000), (__NOW__ - 1296000000), (__NOW__ - 1296000000));
INSERT INTO ledger (id, member_id, kind, points, note, ref, created_by, created_at) VALUES ('6fa988dc-8357-4aa1-bb17-712d535b0aae', '11111111-1111-4111-8111-111111111111', 'welcome', 50, NULL, NULL, NULL, (__NOW__ - 3456000000));
