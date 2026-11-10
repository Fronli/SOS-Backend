import { sql } from 'drizzle-orm';
import {
  check, index, integer, pgEnum, pgTable, primaryKey, serial,
  text, timestamp, varchar,
} from 'drizzle-orm/pg-core';

// Nama tabel/kolom auth mengikuti schema asli. password harus berisi hash.
// Timestamp auth lama dipertahankan; tabel baru menggunakan timestamptz.
export const user_table = pgTable('user_table', {
  id: serial('id').primaryKey(),
  full_name: varchar('full_name', { length: 255 }).notNull(),
  email: text('email').unique().notNull(),
  password: varchar('password', { length: 255 }).notNull(),
  university: varchar('university', { length: 255 }).notNull(),
  major: varchar('major', { length: 255 }).notNull(),
  // Opsional sesuai desain; migration hanya melepas NOT NULL pada dua kolom ini.
  linkedin_url: varchar('linkedin_url', { length: 255 }),
  website: varchar('website', { length: 255 }),
  email_verified_at: timestamp('email_verified_at', { withTimezone: true }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

export const registration_otp_table = pgTable('registration_otp_table', {
  user_id: integer('user_id').primaryKey()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  otp_hash: varchar('otp_hash', { length: 255 }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  last_sent_at: timestamp('last_sent_at', { withTimezone: true }).defaultNow().notNull(),
});

export const estimated_time_enum = pgEnum('estimated_time_enum', [
  'fast', 'moderate', 'extended',
]);

export const tag_table = pgTable('tag_table', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  slug: varchar('slug', { length: 80 }).unique().notNull(),
});

export const request_table = pgTable('request_table', {
  id: serial('id').primaryKey(),
  requester_id: integer('requester_id').notNull()
    .references(() => user_table.id, { onDelete: 'restrict' }),
  title: varchar('title', { length: 150 }).notNull(),
  description: text('description').notNull(),
  estimated_time: estimated_time_enum('estimated_time').notNull(),
  deadline_at: timestamp('deadline_at', { withTimezone: true }).notNull(),
  // Rupiah bulat, total penawaran untuk request, belum menjadi transaksi.
  // 0 = bantuan gratis; maksimum PostgreSQL integer = 2_147_483_647.
  budget_amount: integer('budget_amount').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  check('request_budget_nonnegative', sql`${t.budget_amount} >= 0`),
  check('request_title_length', sql`char_length(btrim(${t.title})) BETWEEN 5 AND 150`),
  check('request_description_length', sql`char_length(btrim(${t.description})) BETWEEN 10 AND 10000`),
  index('request_feed_idx').on(t.created_at.desc(), t.id.desc()).where(sql`${t.deleted_at} IS NULL`),
  index('request_owner_idx').on(t.requester_id, t.created_at.desc(), t.id.desc()).where(sql`${t.deleted_at} IS NULL`),
]);

export const request_tag_table = pgTable('request_tag_table', {
  request_id: integer('request_id').notNull()
    .references(() => request_table.id, { onDelete: 'cascade' }),
  tag_id: integer('tag_id').notNull()
    .references(() => tag_table.id, { onDelete: 'restrict' }),
}, (t) => [
  primaryKey({ columns: [t.request_id, t.tag_id] }),
  index('request_tag_reverse_idx').on(t.tag_id, t.request_id),
]);

// Struktur untuk beberapa helper per task. Endpoint penugasan belum diaktifkan.
// Ini hanya daftar helper yang sudah ditetapkan, bukan reply/aplikasi lamaran.
// Saat fitur diaktifkan: cek helper != requester dan lock request FOR UPDATE
// dalam transaksi yang sama; tolak request yang dihapus. Lihat README.
export const request_helper_table = pgTable('request_helper_table', {
  request_id: integer('request_id').notNull()
    .references(() => request_table.id, { onDelete: 'cascade' }),
  helper_id: integer('helper_id').notNull()
    .references(() => user_table.id, { onDelete: 'restrict' }),
  assigned_at: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.request_id, t.helper_id] }),
  index('request_helper_reverse_idx').on(t.helper_id, t.request_id),
]);

export type RequestRow = typeof request_table.$inferSelect;
