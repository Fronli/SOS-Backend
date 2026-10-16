import { integer, pgTable, serial, text, varchar, timestamp } from 'drizzle-orm/pg-core';

export const user_table = pgTable('user_table',{
    id: serial('id').primaryKey(),
    full_name: varchar('full_name', {length: 255}).notNull(),
    email: text('email').unique().notNull(),
    password: varchar('password', {length: 255}).notNull(),
    university: varchar('university', {length: 255}).notNull(),
    major:varchar('major', {length: 255}).notNull(),
    linkedin_url:varchar('linkedin_url', {length: 255}).notNull(),
    website:varchar('website', {length: 255}).notNull(),
    email_verified_at: timestamp('email_verified_at', { withTimezone: true }),
    created_at: timestamp('created_at').defaultNow().notNull(),
    updated_at: timestamp('updated_at').defaultNow().notNull(),
});

export const registration_otp_table = pgTable('registration_otp_table', {
    user_id: integer('user_id').primaryKey().references(() => user_table.id, { onDelete: 'cascade' }),
    otp_hash: varchar('otp_hash', { length: 255 }).notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    last_sent_at: timestamp('last_sent_at', { withTimezone: true }).defaultNow().notNull(),
});
