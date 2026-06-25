/**
 * Seed script: Fetches ALL occupations from ESCO API (no API key needed - free public API)
 * Collects preferred + alternative English labels (~10K+ titles)
 * Run: npx ts-node scripts/seed-job-titles.ts
 */

import prisma from '../src/app/utils/prisma';

const ESCO_BASE = 'https://ec.europa.eu/esco/api';
const BATCH_SIZE = 100;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchBatch(offset: number): Promise<any> {
  const url = `${ESCO_BASE}/search?type=occupation&language=en&limit=${BATCH_SIZE}&offset=${offset}&full=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESCO API error: ${res.status}`);
  return res.json();
}

function capitalize(s: string): string {
  return s.trim().replace(/\b\w/g, c => c.toUpperCase());
}

function addTitle(title: string, set: Set<string>) {
  const cleaned = title.trim();
  if (cleaned.length >= 2 && cleaned.length <= 100 && /[a-zA-Z]/.test(cleaned)) {
    set.add(capitalize(cleaned));
  }
}

function processBatch(results: any[], allTitles: Set<string>) {
  for (const item of results) {
    // 1. Preferred English title
    const enTitle = item.preferredLabel?.en || item.title;
    if (enTitle) addTitle(enTitle, allTitles);

    // 2. EN-US variant
    const enUs = item.preferredLabel?.['en-us'];
    if (enUs) addTitle(enUs, allTitles);

    // 3. All alternative English labels
    const altEn: string[] = item.alternativeLabel?.en || [];
    for (const alt of altEn) {
      addTitle(alt, allTitles);
    }
  }
}

async function main() {
  console.log('🚀 Starting ESCO job titles seed (no API key needed)...\n');

  // Clear existing
  const deleted = await prisma.jobTitle.deleteMany({});
  console.log(`🗑️  Cleared ${deleted.count} existing titles\n`);

  // Get total count
  const first = await fetchBatch(0);
  const total = first.total as number;
  console.log(`📊 Total ESCO occupations: ${total}`);

  const allTitles = new Set<string>();
  processBatch(first._embedded?.results || [], allTitles);
  console.log(`   Batch 1/${Math.ceil(total / BATCH_SIZE)}: ${allTitles.size} titles`);

  const totalBatches = Math.ceil(total / BATCH_SIZE);

  // Fetch all remaining batches
  for (let batch = 1; batch < totalBatches; batch++) {
    const offset = batch * BATCH_SIZE;

    try {
      const data = await fetchBatch(offset);
      const before = allTitles.size;
      processBatch(data._embedded?.results || [], allTitles);
      const added = allTitles.size - before;
      console.log(`   Batch ${batch + 1}/${totalBatches}: +${added} titles (total: ${allTitles.size})`);
    } catch (err) {
      console.error(`\n⚠️  Error on batch ${batch}, retrying in 2s...`);
      await sleep(2000);
      try {
        const data = await fetchBatch(offset);
        processBatch(data._embedded?.results || [], allTitles);
      } catch {
        console.error(`❌ Skipping batch ${batch}`);
      }
    }

    // Small delay every 5 batches
    if (batch % 5 === 0) await sleep(200);
  }

  console.log(`\n✅ Collected ${allTitles.size} unique English job titles\n`);

  // Insert in chunks
  const titlesArray = Array.from(allTitles).sort();
  const chunkSize = 500;
  let totalInserted = 0;

  for (let i = 0; i < titlesArray.length; i += chunkSize) {
    const chunk = titlesArray.slice(i, i + chunkSize);
    await prisma.jobTitle.createMany({
      data: chunk.map(title => ({ title })),
      skipDuplicates: true,
    });
    totalInserted += chunk.length;
    console.log(`💾 Inserted ${Math.min(totalInserted, titlesArray.length)}/${titlesArray.length}`);
  }

  const finalCount = await prisma.jobTitle.count();
  console.log(`\n🎉 Done! ${finalCount} job titles in database.`);
}

main()
  .catch(err => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
