import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable,
  primaryKey, serial, text, timestamp, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core';

// Nama tabel/kolom auth mengikuti schema asli. password harus berisi hash.
// Timestamp auth lama dipertahankan; tabel baru menggunakan timestamptz.

export const user_role_enum = pgEnum('user_role_enum', ['USER', 'ADMIN']);
export const account_status_enum = pgEnum('account_status_enum', ['ACTIVE', 'SUSPENDED']);

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
  role: user_role_enum('role').default('USER').notNull(),
  status: account_status_enum('status').default('ACTIVE').notNull(),
  suspended_until: timestamp('suspended_until', { withTimezone: true }),
  suspended_reason: varchar('suspended_reason', { length: 255 }),
  student_verified_at: timestamp('student_verified_at', { withTimezone: true }),
  avatar_file_key: varchar('avatar_file_key', { length: 128 }),
  last_login_at: timestamp('last_login_at', { withTimezone: true }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('user_role_idx').on(t.role),
  index('user_status_idx').on(t.status),
]);

export const registration_otp_table = pgTable('registration_otp_table', {
  user_id: integer('user_id').primaryKey()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  otp_hash: varchar('otp_hash', { length: 255 }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  last_sent_at: timestamp('last_sent_at', { withTimezone: true }).defaultNow().notNull(),
});

export const password_reset_otp_table = pgTable('password_reset_otp_table', {
  user_id: integer('user_id').primaryKey()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  otp_hash: varchar('otp_hash', { length: 255 }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  last_sent_at: timestamp('last_sent_at', { withTimezone: true }).defaultNow().notNull(),
});

export const refresh_token_table = pgTable('refresh_token_table', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  family_id: uuid('family_id').notNull(),
  token_hash: varchar('token_hash', { length: 64 }).unique().notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  replaced_by_id: integer('replaced_by_id'),
  user_agent: varchar('user_agent', { length: 255 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('refresh_token_user_idx').on(t.user_id),
  index('refresh_token_family_idx').on(t.family_id),
]);

export const estimated_time_enum = pgEnum('estimated_time_enum', [
  'fast', 'moderate', 'extended',
]);

export const tag_table = pgTable('tag_table', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  slug: varchar('slug', { length: 80 }).unique().notNull(),
});

export const user_interest_table = pgTable('user_interest_table', {
  user_id: integer('user_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  tag_id: integer('tag_id').notNull()
    .references(() => tag_table.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.user_id, t.tag_id] }),
  index('user_interest_tag_idx').on(t.tag_id, t.user_id),
]);

export const user_skill_table = pgTable('user_skill_table', {
  user_id: integer('user_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  tag_id: integer('tag_id').notNull()
    .references(() => tag_table.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.user_id, t.tag_id] }),
  index('user_skill_tag_idx').on(t.tag_id, t.user_id),
]);

export const file_purpose_enum = pgEnum('file_purpose_enum', [
  'AVATAR', 'PORTFOLIO', 'STUDENT_ID', 'REQUEST_ATTACHMENT', 'CHAT_ATTACHMENT', 'DISPUTE_EVIDENCE',
]);
export const file_status_enum = pgEnum('file_status_enum', ['PENDING', 'UPLOADED']);

export const file_table = pgTable('file_table', {
  id: serial('id').primaryKey(),
  owner_id: integer('owner_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 128 }).unique().notNull(),
  purpose: file_purpose_enum('purpose').notNull(),
  mime: varchar('mime', { length: 128 }).notNull(),
  byte_size: integer('byte_size').notNull(),
  original_name: varchar('original_name', { length: 255 }),
  status: file_status_enum('status').default('PENDING').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  uploaded_at: timestamp('uploaded_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('file_owner_idx').on(t.owner_id, t.created_at.desc()),
  check('file_byte_size_positive', sql`${t.byte_size} > 0`),
]);

export const portfolio_table = pgTable('portfolio_table', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 150 }).notNull(),
  description: text('description'),
  url: varchar('url', { length: 255 }),
  file_key: varchar('file_key', { length: 128 }),
  sort_order: integer('sort_order').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('portfolio_owner_idx').on(t.user_id, t.sort_order),
]);

export const student_verification_status_enum = pgEnum('student_verification_status_enum', [
  'PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED',
]);

export const student_verification_table = pgTable('student_verification_table', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  file_key: varchar('file_key', { length: 128 }).notNull(),
  status: student_verification_status_enum('status').default('PENDING').notNull(),
  note: text('note'),
  reviewer_id: integer('reviewer_id')
    .references(() => user_table.id, { onDelete: 'set null' }),
  claimed_at: timestamp('claimed_at', { withTimezone: true }),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('student_verification_status_idx').on(t.status, t.created_at),
  uniqueIndex('student_verification_active_uniq').on(t.user_id)
    .where(sql`${t.status} IN ('PENDING', 'IN_REVIEW')`),
]);

export const request_status_enum = pgEnum('request_status_enum', [
  'OPEN', 'CANCELLED', 'COMPLETED', 'HIDDEN', 'REMOVED',
]);

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
  status: request_status_enum('status').default('OPEN').notNull(),
  hidden_at: timestamp('hidden_at', { withTimezone: true }),
  hidden_by: integer('hidden_by').references(() => user_table.id, { onDelete: 'set null' }),
  moderation_reason: varchar('moderation_reason', { length: 255 }),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  check('request_budget_nonnegative', sql`${t.budget_amount} >= 0`),
  check('request_title_length', sql`char_length(btrim(${t.title})) BETWEEN 5 AND 150`),
  check('request_description_length', sql`char_length(btrim(${t.description})) BETWEEN 10 AND 10000`),
  index('request_feed_idx').on(t.created_at.desc(), t.id.desc()).where(sql`${t.deleted_at} IS NULL`),
  index('request_owner_idx').on(t.requester_id, t.created_at.desc(), t.id.desc()).where(sql`${t.deleted_at} IS NULL`),
  index('request_status_idx').on(t.status, t.created_at.desc()).where(sql`${t.deleted_at} IS NULL`),
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

// Legacy: daftar helper per request. Alur saat ini memakai assignment_table.
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

export const request_attachment_table = pgTable('request_attachment_table', {
  request_id: integer('request_id').notNull()
    .references(() => request_table.id, { onDelete: 'cascade' }),
  file_id: integer('file_id').notNull()
    .references(() => file_table.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.request_id, t.file_id] }),
]);

export const reply_table = pgTable('reply_table', {
  id: serial('id').primaryKey(),
  request_id: integer('request_id').notNull()
    .references(() => request_table.id, { onDelete: 'cascade' }),
  helper_id: integer('helper_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  message: text('message').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('reply_request_idx').on(t.request_id, t.created_at.desc()),
  check('reply_message_length', sql`char_length(btrim(${t.message})) BETWEEN 1 AND 2000`),
]);

export const conversation_status_enum = pgEnum('conversation_status_enum', [
  'ACTIVE', 'DECLINED', 'CLOSED',
]);

export const conversation_table = pgTable('conversation_table', {
  id: serial('id').primaryKey(),
  request_id: integer('request_id').notNull()
    .references(() => request_table.id, { onDelete: 'cascade' }),
  requester_id: integer('requester_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  helper_id: integer('helper_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  status: conversation_status_enum('status').default('ACTIVE').notNull(),
  last_message_at: timestamp('last_message_at', { withTimezone: true }),
  last_message_preview: varchar('last_message_preview', { length: 160 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('conversation_request_helper_uniq').on(t.request_id, t.helper_id),
  index('conversation_requester_idx').on(t.requester_id, t.last_message_at.desc()),
  index('conversation_helper_idx').on(t.helper_id, t.last_message_at.desc()),
  check('conversation_participants_differ', sql`${t.requester_id} <> ${t.helper_id}`),
]);

export const message_table = pgTable('message_table', {
  id: serial('id').primaryKey(),
  conversation_id: integer('conversation_id').notNull()
    .references(() => conversation_table.id, { onDelete: 'cascade' }),
  sender_id: integer('sender_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  body: text('body'),
  file_id: integer('file_id').references(() => file_table.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('message_conversation_idx').on(t.conversation_id, t.id.desc()),
  check('message_content_present', sql`${t.body} IS NOT NULL OR ${t.file_id} IS NOT NULL`),
]);

export const conversation_read_table = pgTable('conversation_read_table', {
  conversation_id: integer('conversation_id').notNull()
    .references(() => conversation_table.id, { onDelete: 'cascade' }),
  user_id: integer('user_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  last_read_message_id: integer('last_read_message_id'),
  last_read_at: timestamp('last_read_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.conversation_id, t.user_id] }),
]);

export const assignment_status_enum = pgEnum('assignment_status_enum', [
  'PENDING_AGREEMENT', 'ON_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED',
]);

export const assignment_table = pgTable('assignment_table', {
  id: serial('id').primaryKey(),
  request_id: integer('request_id').notNull()
    .references(() => request_table.id, { onDelete: 'restrict' }),
  requester_id: integer('requester_id').notNull()
    .references(() => user_table.id, { onDelete: 'restrict' }),
  helper_id: integer('helper_id').notNull()
    .references(() => user_table.id, { onDelete: 'restrict' }),
  status: assignment_status_enum('status').default('PENDING_AGREEMENT').notNull(),
  amount: integer('amount').notNull(),
  deadline_at: timestamp('deadline_at', { withTimezone: true }).notNull(),
  terms: text('terms').notNull(),
  requester_approved_at: timestamp('requester_approved_at', { withTimezone: true }),
  helper_approved_at: timestamp('helper_approved_at', { withTimezone: true }),
  funded_at: timestamp('funded_at', { withTimezone: true }),
  started_at: timestamp('started_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check('assignment_amount_nonnegative', sql`${t.amount} >= 0`),
  check('assignment_participants_differ', sql`${t.requester_id} <> ${t.helper_id}`),
  index('assignment_request_idx').on(t.request_id, t.status),
  index('assignment_requester_idx').on(t.requester_id, t.created_at.desc()),
  index('assignment_helper_idx').on(t.helper_id, t.created_at.desc()),
]);

export const assignment_request_kind_enum = pgEnum('assignment_request_kind_enum', [
  'COMPLETION', 'CANCELLATION',
]);
export const assignment_request_status_enum = pgEnum('assignment_request_status_enum', [
  'PENDING', 'CONFIRMED', 'REJECTED',
]);

export const assignment_request_table = pgTable('assignment_request_table', {
  id: serial('id').primaryKey(),
  assignment_id: integer('assignment_id').notNull()
    .references(() => assignment_table.id, { onDelete: 'cascade' }),
  kind: assignment_request_kind_enum('kind').notNull(),
  requested_by: integer('requested_by').notNull()
    .references(() => user_table.id, { onDelete: 'restrict' }),
  reason: text('reason'),
  status: assignment_request_status_enum('status').default('PENDING').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  resolved_by: integer('resolved_by').references(() => user_table.id, { onDelete: 'set null' }),
}, (t) => [
  index('assignment_request_pending_idx').on(t.assignment_id, t.kind, t.status),
]);

export const review_table = pgTable('review_table', {
  id: serial('id').primaryKey(),
  assignment_id: integer('assignment_id').notNull().unique()
    .references(() => assignment_table.id, { onDelete: 'cascade' }),
  requester_id: integer('requester_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  helper_id: integer('helper_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check('review_rating_range', sql`${t.rating} BETWEEN 1 AND 5`),
  index('review_helper_idx').on(t.helper_id, t.created_at.desc()),
]);

export const dispute_status_enum = pgEnum('dispute_status_enum', [
  'OPEN', 'IN_REVIEW', 'RESOLVED',
]);
export const dispute_decision_enum = pgEnum('dispute_decision_enum', [
  'FULL_REFUND', 'PARTIAL_REFUND', 'RELEASE',
]);

export const dispute_table = pgTable('dispute_table', {
  id: serial('id').primaryKey(),
  assignment_id: integer('assignment_id').notNull()
    .references(() => assignment_table.id, { onDelete: 'cascade' }),
  raised_by: integer('raised_by').notNull()
    .references(() => user_table.id, { onDelete: 'restrict' }),
  reason: text('reason').notNull(),
  status: dispute_status_enum('status').default('OPEN').notNull(),
  decision: dispute_decision_enum('decision'),
  refund_amount: integer('refund_amount'),
  basis: text('basis'),
  claimed_by: integer('claimed_by').references(() => user_table.id, { onDelete: 'set null' }),
  claimed_at: timestamp('claimed_at', { withTimezone: true }),
  resolved_by: integer('resolved_by').references(() => user_table.id, { onDelete: 'set null' }),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('dispute_status_idx').on(t.status, t.created_at),
  index('dispute_assignment_idx').on(t.assignment_id),
  check('dispute_refund_nonnegative', sql`${t.refund_amount} IS NULL OR ${t.refund_amount} >= 0`),
]);

export const dispute_evidence_table = pgTable('dispute_evidence_table', {
  dispute_id: integer('dispute_id').notNull()
    .references(() => dispute_table.id, { onDelete: 'cascade' }),
  file_id: integer('file_id').notNull()
    .references(() => file_table.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.dispute_id, t.file_id] }),
]);

export const wallet_table = pgTable('wallet_table', {
  user_id: integer('user_id').primaryKey()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  balance: bigint('balance', { mode: 'number' }).default(0).notNull(),
  held: bigint('held', { mode: 'number' }).default(0).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check('wallet_balance_nonnegative', sql`${t.balance} >= 0`),
  check('wallet_held_nonnegative', sql`${t.held} >= 0`),
]);

export const wallet_transaction_type_enum = pgEnum('wallet_transaction_type_enum', [
  'TOPUP', 'WITHDRAWAL', 'HOLD', 'RELEASE', 'REFUND', 'FEE', 'ADJUSTMENT',
]);
export const wallet_transaction_status_enum = pgEnum('wallet_transaction_status_enum', [
  'PENDING', 'SUCCESS', 'FAILED',
]);

export const wallet_transaction_table = pgTable('wallet_transaction_table', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  type: wallet_transaction_type_enum('type').notNull(),
  status: wallet_transaction_status_enum('status').default('SUCCESS').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  balance_after: bigint('balance_after', { mode: 'number' }).notNull(),
  held_after: bigint('held_after', { mode: 'number' }).notNull(),
  reference_type: varchar('reference_type', { length: 40 }).notNull(),
  reference_id: integer('reference_id'),
  note: varchar('note', { length: 255 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('wallet_transaction_user_idx').on(t.user_id, t.created_at.desc()),
  index('wallet_transaction_ref_idx').on(t.reference_type, t.reference_id),
  index('wallet_transaction_created_idx').on(t.created_at.desc()),
]);

export const bank_account_table = pgTable('bank_account_table', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  bank_code: varchar('bank_code', { length: 20 }).notNull(),
  account_number_masked: varchar('account_number_masked', { length: 40 }).notNull(),
  account_name: varchar('account_name', { length: 255 }).notNull(),
  provider_token: varchar('provider_token', { length: 255 }),
  is_primary: boolean('is_primary').default(false).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('bank_account_user_idx').on(t.user_id),
]);

export const notification_table = pgTable('notification_table', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 60 }).notNull(),
  title: varchar('title', { length: 150 }).notNull(),
  body: text('body').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>(),
  read_at: timestamp('read_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('notification_user_idx').on(t.user_id, t.created_at.desc()),
]);

export const device_token_table = pgTable('device_token_table', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 255 }).unique().notNull(),
  platform: varchar('platform', { length: 20 }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('device_token_user_idx').on(t.user_id),
]);

export const report_target_type_enum = pgEnum('report_target_type_enum', ['REQUEST', 'USER']);
export const report_status_enum = pgEnum('report_status_enum', [
  'OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED',
]);

export const report_table = pgTable('report_table', {
  id: serial('id').primaryKey(),
  reporter_id: integer('reporter_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  target_type: report_target_type_enum('target_type').notNull(),
  target_id: integer('target_id').notNull(),
  reason: text('reason').notNull(),
  status: report_status_enum('status').default('OPEN').notNull(),
  claimed_by: integer('claimed_by').references(() => user_table.id, { onDelete: 'set null' }),
  claimed_at: timestamp('claimed_at', { withTimezone: true }),
  resolution_action: varchar('resolution_action', { length: 40 }),
  resolution_reason: text('resolution_reason'),
  resolved_by: integer('resolved_by').references(() => user_table.id, { onDelete: 'set null' }),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('report_status_idx').on(t.status, t.created_at),
  index('report_target_idx').on(t.target_type, t.target_id),
  index('report_reporter_idx').on(t.reporter_id),
]);

export const block_table = pgTable('block_table', {
  blocker_id: integer('blocker_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  blocked_id: integer('blocked_id').notNull()
    .references(() => user_table.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.blocker_id, t.blocked_id] }),
  index('block_blocked_idx').on(t.blocked_id),
  check('block_self_forbidden', sql`${t.blocker_id} <> ${t.blocked_id}`),
]);

export const audit_log_table = pgTable('audit_log_table', {
  id: serial('id').primaryKey(),
  actor_id: integer('actor_id').references(() => user_table.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 80 }).notNull(),
  entity_type: varchar('entity_type', { length: 40 }).notNull(),
  entity_id: integer('entity_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('audit_log_entity_idx').on(t.entity_type, t.entity_id),
  index('audit_log_created_idx').on(t.created_at.desc()),
]);

export type RequestRow = typeof request_table.$inferSelect;
export type UserRow = typeof user_table.$inferSelect;
export type AssignmentRow = typeof assignment_table.$inferSelect;
export type WalletTransactionRow = typeof wallet_transaction_table.$inferSelect;
