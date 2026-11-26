/**
 * Idempotent seed script for tag_table and the admin account.
 * Run with: npx tsx src/db/seed.ts
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { tag_table, user_table } from './schema';

const SEED_TAGS = [
    { name: 'Design', slug: 'design' },
    { name: 'UI/UX', slug: 'ui-ux' },
    { name: 'Development', slug: 'development' },
    { name: 'Technology', slug: 'technology' },
    { name: 'Startup', slug: 'startup' },
    { name: 'Digital Product', slug: 'digital-product' },
    { name: 'Writing', slug: 'writing' },
    { name: 'Translation', slug: 'translation' },
    { name: 'Data Analysis', slug: 'data-analysis' },
    { name: 'Marketing', slug: 'marketing' },
    { name: 'Video Editing', slug: 'video-editing' },
    { name: 'Research', slug: 'research' },
];

async function seedTags() {
    console.log('Seeding tags...');
    for (const tag of SEED_TAGS) {
        await db.insert(tag_table).values(tag).onConflictDoNothing({ target: tag_table.slug });
    }
    const all = await db.select().from(tag_table).orderBy(tag_table.name);
    console.log(`Tags in database: ${all.length}`);
    return all;
}

async function seedAdmin() {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
        console.log('ADMIN_EMAIL/ADMIN_PASSWORD tidak diisi; admin tidak dibuat.');
        return;
    }

    const normalized = email.trim().toLowerCase();
    const [existing] = await db.select({ id: user_table.id }).from(user_table)
        .where(eq(user_table.email, normalized)).limit(1);

    if (existing) {
        await db.update(user_table).set({ role: 'ADMIN', status: 'ACTIVE' })
            .where(eq(user_table.id, existing.id));
        console.log(`Admin ${normalized} sudah ada; role dipastikan ADMIN.`);
        return;
    }

    const hashed = await bcrypt.hash(password, 10);
    await db.insert(user_table).values({
        full_name: process.env.ADMIN_NAME || 'SOS Admin',
        email: normalized,
        password: hashed,
        university: '',
        major: '',
        email_verified_at: new Date(),
        role: 'ADMIN',
    });
    console.log(`Admin ${normalized} dibuat.`);
}

async function seed() {
    await seedTags();
    await seedAdmin();
    console.log('Seed complete.');
    process.exit(0);
}

seed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
});
