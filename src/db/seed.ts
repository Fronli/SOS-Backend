/**
 * Idempotent seed script for tag_table.
 * Run with: npx tsx src/db/seed.ts
 *
 * Uses ON CONFLICT DO NOTHING on slug to be idempotent.
 */
import 'dotenv/config';
import { db } from './db';
import { tag_table } from './schema';

const SEED_TAGS = [
    { name: 'Design', slug: 'design' },
    { name: 'UI/UX', slug: 'ui-ux' },
    { name: 'Development', slug: 'development' },
    { name: 'Technology', slug: 'technology' },
    { name: 'Startup', slug: 'startup' },
    { name: 'Digital Product', slug: 'digital-product' },
];

async function seed() {
    console.log('Seeding tags...');

    for (const tag of SEED_TAGS) {
        await db
            .insert(tag_table)
            .values(tag)
            .onConflictDoNothing({ target: tag_table.slug });
    }

    const all = await db.select().from(tag_table);
    console.log(`Tags in database: ${all.length}`);
    for (const t of all) {
        console.log(`  [${t.id}] ${t.name} (${t.slug})`);
    }

    console.log('Seed complete.');
    process.exit(0);
}

seed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
});

