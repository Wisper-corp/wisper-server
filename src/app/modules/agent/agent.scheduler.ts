import { schedule, type ScheduledTask } from "node-cron";
import prisma from "../../utils/prisma";
import { isAiConfigured } from "../../ai/ai.client";
import { agentServices } from "./agent.service";

/**
 * Drives agent activity on a schedule.
 *
 * Two deliberate choices about how it behaves:
 *
 * - It runs hourly but only acts *sometimes*, so posts land at irregular times
 *   rather than on the hour every hour, which reads as automated.
 * - It answers real members before it starts new discussions. A member whose
 *   question is sitting unanswered is the reason communities die; a new bot
 *   post does not fix that.
 */

/** Quiet hours, server time. Nobody posts at 4am. */
const ACTIVE_HOURS = { from: 7, to: 23 };

/** Chance of acting in any given hour, so cadence looks human. */
const ACT_PROBABILITY = 0.45;

/** Never exceed this many agent items per community per day. */
const DAILY_CAP = 6;

const usedToday = async (groupId: string) => {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  return prisma.agentActivity.count({
    where: { groupId, createdAt: { gte: since }, kind: { in: ["POST", "REPLY"] } },
  });
};

export const runAgentTick = async (): Promise<void> => {
  if (!isAiConfigured()) return;

  const hour = new Date().getHours();
  if (hour < ACTIVE_HOURS.from || hour >= ACTIVE_HOURS.to) return;

  const groups = await prisma.agentPersona.groupBy({
    by: ["groupId"],
    where: { isActive: true, isPaused: false },
  });

  for (const { groupId } of groups) {
    try {
      if ((await usedToday(groupId)) >= DAILY_CAP) continue;
      if (Math.random() > ACT_PROBABILITY) continue;

      // Answering a real member always beats another bot monologue.
      const replied = await agentServices.runReplyToUnanswered(groupId);
      if (!("skipped" in replied)) continue;

      await agentServices.runStartDiscussion(groupId);
    } catch (error) {
      // One community's failure must not stop the others.
      console.error(`Agent tick failed for group ${groupId}`, error);
    }
  }
};

let task: ScheduledTask | null = null;

export const startAgentScheduler = (): void => {
  if (task) return;
  if (!isAiConfigured()) {
    console.log("[agents] No AI provider configured - scheduler not started.");
    return;
  }
  // Every hour, on the hour. The probability gate inside decides whether this
  // particular hour produces anything.
  task = schedule("0 * * * *", () => {
    void runAgentTick();
  });
  console.log("[agents] Scheduler started (hourly).");
};

export const stopAgentScheduler = (): void => {
  task?.stop();
  task = null;
};
