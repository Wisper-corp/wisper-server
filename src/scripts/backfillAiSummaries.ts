import prisma from "../app/utils/prisma";
import { generateServiceSummary } from "../app/utils/aiSummary";

/**
 * Backfill AI summaries for existing posts that don't have one.
 * 
 * Usage:
 * npx ts-node src/scripts/backfillAiSummaries.ts
 * 
 * Or add to package.json scripts:
 * "backfill:summaries": "ts-node src/scripts/backfillAiSummaries.ts"
 */

async function backfillAiSummaries() {
  console.log("Starting AI summary backfill...\n");

  try {
    // Find all active posts without AI summaries
    const postsNeedingSummaries = await prisma.post.findMany({
      where: {
        status: "ACTIVE",
        caption: { not: null },
        OR: [
          { aiSummary: null },
          { aiSummary: "" },
        ],
      },
      select: {
        id: true,
        caption: true,
      },
      orderBy: {
        createdAt: "desc", // Process newest first
      },
    });

    console.log(`Found ${postsNeedingSummaries.length} posts needing summaries.\n`);

    if (postsNeedingSummaries.length === 0) {
      console.log("✅ No posts need summaries. All done!");
      return;
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const post of postsNeedingSummaries) {
      processed++;
      
      try {
        const summary = generateServiceSummary(post.caption);
        
        if (summary) {
          await prisma.post.update({
            where: { id: post.id },
            data: { aiSummary: summary },
          });
          succeeded++;
          console.log(`✓ [${processed}/${postsNeedingSummaries.length}] Generated summary for post ${post.id}`);
          console.log(`  Original (${post.caption?.length} chars): ${post.caption?.slice(0, 100)}${(post.caption?.length ?? 0) > 100 ? "..." : ""}`);
          console.log(`  Summary (${summary.length} chars): ${summary}\n`);
        } else {
          skipped++;
          console.log(`⊘ [${processed}/${postsNeedingSummaries.length}] Skipped post ${post.id} (no caption or already short)\n`);
        }
      } catch (error) {
        failed++;
        console.error(`✗ [${processed}/${postsNeedingSummaries.length}] Failed to generate summary for post ${post.id}:`, error);
        console.log("");
      }

      // Progress update every 10 posts
      if (processed % 10 === 0) {
        console.log(`--- Progress: ${processed}/${postsNeedingSummaries.length} (${Math.round((processed / postsNeedingSummaries.length) * 100)}%) ---\n`);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("Backfill complete!");
    console.log("=".repeat(60));
    console.log(`Total processed: ${processed}`);
    console.log(`✓ Succeeded: ${succeeded}`);
    console.log(`⊘ Skipped: ${skipped}`);
    console.log(`✗ Failed: ${failed}`);
    console.log("=".repeat(60) + "\n");

  } catch (error) {
    console.error("\n❌ Fatal error during backfill:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if executed directly
if (require.main === module) {
  backfillAiSummaries()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export default backfillAiSummaries;
