import { ChatRole, ModerationDecision, ModerationTarget } from "@prisma/client";
import ApiError from "../../middlewares/classes/ApiError";
import prisma from "../../utils/prisma";
import { askAiForJson, isAiConfigured } from "../../ai/ai.client";
import { communityContextFrom } from "../agent/agent.service";
import { moderationPrompt } from "./moderation.prompts";

/**
 * Above this, content is removed without asking anyone.
 * Below [FLAG_AT] it is published untouched.
 * Between the two it is published but queued for an admin to look at, because
 * holding back a maybe-fine post is worse than showing it for an hour.
 */
const REMOVE_AT = 0.85;
const FLAG_AT = 0.5;

/** Suspension lengths, in hours, by how many posts this member has had removed. */
const SUSPENSION_LADDER = [0, 0, 8, 24, 42];

/** How long the classifier gets before we give up and publish. */
const CLASSIFY_TIMEOUT_MS = 12_000;

type Verdict = {
  confidence: number;
  categories: string[];
  reason: string;
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ]);

/** The bot account that moderation is attributed to, if one is set. */
const moderatorAuthId = async (groupId: string) => {
  const persona = await prisma.agentPersona.findFirst({
    where: { groupId, isModerator: true },
    select: { authId: true },
  });
  return persona?.authId ?? null;
};

/**
 * Whether this member is currently barred from posting here.
 *
 * Expiry is compared rather than cleared, so a suspension lifts itself and no
 * job has to run to release anyone.
 */
export const activeSuspension = async (authId: string, groupId: string) =>
  prisma.memberSuspension.findFirst({
    where: {
      authId,
      groupId,
      liftedAt: null,
      until: { gt: new Date() },
    },
    orderBy: { until: "desc" },
    select: { id: true, until: true, reason: true },
  });

const suspendFor = async (
  authId: string,
  groupId: string,
  removedCount: number,
  reason: string
) => {
  const hours =
    SUSPENSION_LADDER[Math.min(removedCount, SUSPENSION_LADDER.length - 1)] ?? 0;
  if (!hours) return null;

  const until = new Date(Date.now() + hours * 3_600_000);
  return prisma.memberSuspension.create({
    data: {
      authId,
      groupId,
      until,
      reason,
      issuedBy: await moderatorAuthId(groupId),
    },
    select: { id: true, until: true, reason: true },
  });
};

/**
 * Judges one piece of content before it is published.
 *
 * Fails open: if the AI is unconfigured, slow, or errors, the content is
 * published. A moderation layer that silently eats posts when the provider is
 * down is worse than no moderation layer.
 */
export const screenContent = async (params: {
  groupId: string;
  authorId: string;
  content: string;
  target: ModerationTarget;
}): Promise<{ allowed: boolean; message?: string }> => {
  const { groupId, authorId, content, target } = params;

  // Agents police real members, not each other.
  const author = await prisma.auth.findUnique({
    where: { id: authorId },
    select: { isAgent: true },
  });
  if (author?.isAgent) return { allowed: true };

  if (!isAiConfigured()) return { allowed: true };

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { name: true, description: true },
  });
  if (!group) return { allowed: true };

  const [recent, priorStrikes] = await Promise.all([
    prisma.forumPost.findMany({
      where: { groupId, authorId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { text: true },
    }),
    prisma.moderationVerdict.count({
      where: { groupId, authorId, decision: ModerationDecision.REMOVED },
    }),
  ]);

  const prompt = moderationPrompt(communityContextFrom(group), content, {
    recentTexts: recent.map(r => r.text.slice(0, 160)),
    priorStrikes,
  });

  let verdict: Verdict | null = null;
  try {
    verdict = await withTimeout(
      askAiForJson<Verdict>({
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        maxTokens: 300,
        temperature: 0,
      }),
      CLASSIFY_TIMEOUT_MS
    );
  } catch (error) {
    console.error("Moderation classify failed", error);
  }

  // Unreachable, slow or malformed - publish and move on.
  if (!verdict || typeof verdict.confidence !== "number") {
    return { allowed: true };
  }

  const confidence = Math.max(0, Math.min(1, verdict.confidence));
  const categories = Array.isArray(verdict.categories)
    ? verdict.categories.map(String).slice(0, 8)
    : [];
  const reason = (verdict.reason || "").toString().slice(0, 300);

  const decision =
    confidence >= REMOVE_AT
      ? ModerationDecision.REMOVED
      : confidence >= FLAG_AT
        ? ModerationDecision.FLAGGED
        : ModerationDecision.ALLOWED;

  await prisma.moderationVerdict.create({
    data: {
      groupId,
      authorId,
      target,
      decision,
      categories,
      confidence,
      reason,
      content: content.slice(0, 4000),
    },
  });

  if (decision !== ModerationDecision.REMOVED) return { allowed: true };

  // Removed content counts as a strike; enough strikes buy a suspension.
  const removedCount = priorStrikes + 1;
  const suspension = await suspendFor(authorId, groupId, removedCount, reason);

  return {
    allowed: false,
    message: suspension
      ? `This post was removed: ${reason} You cannot post here until ${suspension.until.toUTCString()}.`
      : `This post was removed: ${reason}`,
  };
};

/** Makes one agent the community's bot moderator. */
const appointModerator = async (groupId: string, personaId?: string) => {
  const persona = personaId
    ? await prisma.agentPersona.findFirst({
        where: { id: personaId, groupId },
        select: { id: true, authId: true },
      })
    : await prisma.agentPersona.findFirst({
        where: { groupId },
        orderBy: { createdAt: "asc" },
        select: { id: true, authId: true },
      });

  if (!persona) throw new ApiError(404, "No agent found in this community.");

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { chat: { select: { id: true } } },
  });
  if (!group?.chat?.id) throw new ApiError(400, "Community has no chat.");

  await prisma.$transaction(async tn => {
    // At most one bot moderator per community.
    await tn.agentPersona.updateMany({
      where: { groupId, isModerator: true },
      data: { isModerator: false },
    });
    await tn.agentPersona.update({
      where: { id: persona.id },
      data: { isModerator: true },
    });
    // The role that actually grants delete rights in the forum.
    await tn.chatParticipant.updateMany({
      where: { chatId: group.chat!.id, authId: persona.authId },
      data: { role: ChatRole.MODERATOR },
    });
  });

  const named = await prisma.agentPersona.findUnique({
    where: { id: persona.id },
    select: {
      id: true,
      headline: true,
      auth: { select: { id: true, person: { select: { name: true } } } },
    },
  });

  return {
    personaId: named?.id,
    authId: named?.auth.id,
    name: named?.auth.person?.name,
    headline: named?.headline,
  };
};

const log = async (groupId: string, limit = 50, decision?: ModerationDecision) =>
  prisma.moderationVerdict.findMany({
    where: { groupId, ...(decision ? { decision } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      target: true,
      decision: true,
      categories: true,
      confidence: true,
      reason: true,
      content: true,
      reviewedAt: true,
      createdAt: true,
      author: {
        select: {
          id: true,
          person: { select: { name: true } },
          business: { select: { name: true } },
        },
      },
    },
  });

const resolveVerdict = async (
  verdictId: string,
  action: "keep" | "remove",
  reviewerId: string
) => {
  const verdict = await prisma.moderationVerdict.findUnique({
    where: { id: verdictId },
    select: { id: true, targetId: true, target: true },
  });
  if (!verdict) throw new ApiError(404, "Verdict not found.");

  if (action === "remove" && verdict.targetId) {
    if (verdict.target === ModerationTarget.POST) {
      await prisma.forumPost.deleteMany({ where: { id: verdict.targetId } });
    } else {
      await prisma.forumReply.deleteMany({ where: { id: verdict.targetId } });
    }
  }

  return prisma.moderationVerdict.update({
    where: { id: verdictId },
    data: {
      reviewedAt: new Date(),
      reviewedBy: reviewerId,
      decision:
        action === "remove"
          ? ModerationDecision.REMOVED
          : ModerationDecision.ALLOWED,
    },
    select: { id: true, decision: true, reviewedAt: true },
  });
};

const suspensions = async (groupId: string) =>
  prisma.memberSuspension.findMany({
    where: { groupId, liftedAt: null, until: { gt: new Date() } },
    orderBy: { until: "desc" },
    select: {
      id: true,
      until: true,
      reason: true,
      createdAt: true,
      auth: {
        select: {
          id: true,
          person: { select: { name: true } },
          business: { select: { name: true } },
        },
      },
    },
  });

const liftSuspension = async (id: string) =>
  prisma.memberSuspension.update({
    where: { id },
    data: { liftedAt: new Date() },
    select: { id: true, liftedAt: true },
  });

export const moderationServices = {
  screenContent,
  activeSuspension,
  appointModerator,
  log,
  resolveVerdict,
  suspensions,
  liftSuspension,
};
