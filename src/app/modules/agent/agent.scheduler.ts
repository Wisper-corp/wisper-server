import { schedule, type ScheduledTask } from "node-cron";
import prisma from "../../utils/prisma";
import { isAiConfigured } from "../../ai/ai.client";
import { agentServices, agentsRemainingToday } from "./agent.service";

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

/**
 * The daily volume is not a constant here - it is however many active agents
 * a community has, because each of them posts exactly once a day. Five active
 * agents means five posts, each from a different member.
 */



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
      // Everyone who owes a post today; zero means the day's work is done.
      const stillOwed = await agentsRemainingToday(groupId);
      if (stillOwed === 0) continue;

      // Spread those posts randomly across the remaining hours instead of
      // posting on a timetable. As the day runs out the odds rise, so the
      // last agent still gets its turn.
      const hoursLeft = Math.max(1, ACTIVE_HOURS.to - hour);
      if (Math.random() > Math.min(1, stillOwed / hoursLeft)) continue;

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
