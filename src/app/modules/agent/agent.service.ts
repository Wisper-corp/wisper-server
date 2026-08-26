import { ChatRole, UserRole, UserStatus } from "@prisma/client";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import ApiError from "../../middlewares/classes/ApiError";
import prisma from "../../utils/prisma";
import {
  AiNotConfiguredError,
  askAi,
  askAiForJson,
  isAiConfigured,
} from "../../ai/ai.client";
import {
  CommunityContext,
  personaBatchPrompt,
  replyPrompt,
  startDiscussionPrompt,
} from "./agent.prompts";

/**
 * Avatar for an agent.
 *
 * DiceBear renders a deterministic illustrated portrait from a seed, so the
 * same agent keeps the same face forever and no real person's photograph is
 * ever used. Free, no key, no upload step. Swap this one function if you would
 * rather host real images later.
 */
const avatarFor = (name: string) =>
  `https://api.dicebear.com/9.x/notionists/png?seed=${encodeURIComponent(
    name
  )}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf&radius=50&size=256`;

/** Agent accounts get an address that can never collide with a real signup. */
const AGENT_EMAIL_DOMAIN = "agents.wisperonline.internal";

/** How many recent posts an agent reads before writing, to avoid repeating. */
const CONTEXT_POSTS = 8;

/** The model writes personas in batches; small enough to stay coherent. */
const PERSONA_BATCH = 12;

type GeneratedPersona = {
  name: string;
  headline: string;
  expertise: string;
  voice: string;
};

/**
 * Community tags live in the description as
 * "Trade: X | Market: Y | Category: Z" (see the Flutter parser). The agents
 * need that niche or every post reads like generic business filler.
 */
export const communityContextFrom = (group: {
  name: string;
  description: string | null;
}): CommunityContext => {
  const ctx: CommunityContext = { name: group.name };
  for (const part of (group.description ?? "").split("|")) {
    const [rawKey, ...rest] = part.split(":");
    if (!rawKey || !rest.length) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (!value) continue;
    if (key === "trade") ctx.trade = value;
    else if (key === "market") ctx.market = value;
    else if (key === "category") ctx.category = value;
  }
  return ctx;
};

const log = (
  personaId: string,
  groupId: string,
  kind: "POST" | "REPLY" | "SKIPPED" | "FAILED",
  summary: string,
  extra?: { postId?: string; detail?: string }
) =>
  prisma.agentActivity
    .create({
      data: {
        personaId,
        groupId,
        kind,
        summary,
        postId: extra?.postId,
        detail: extra?.detail,
      },
    })
    .catch(() => null);

/**
 * Creates agent members for a community.
 *
 * Only [activeCount] of them ever post; the rest exist so the member count
 * reads like a real community. Quiet accounts cost nothing - the bill follows
 * messages written, not members existing.
 */
const seedAgents = async (
  groupId: string,
  total: number,
  activeCount: number
) => {
  if (!isAiConfigured()) throw new AiNotConfiguredError();
  if (total < 1 || total > 1000) {
    throw new ApiError(400, "Seed between 1 and 1000 agents at a time.");
  }
  if (activeCount < 0 || activeCount > total) {
    throw new ApiError(400, "activeCount must be between 0 and total.");
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, name: true, description: true, chat: { select: { id: true } } },
  });
  if (!group) throw new ApiError(404, "Community not found.");
  if (!group.chat?.id) throw new ApiError(400, "Community has no chat.");

  const context = communityContextFrom(group);
  const personas: GeneratedPersona[] = [];

  while (personas.length < total) {
    const want = Math.min(PERSONA_BATCH, total - personas.length);
    const prompt = personaBatchPrompt(context, want);
    const batch = await askAiForJson<GeneratedPersona[]>({
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      maxTokens: 2048,
      temperature: 1,
    });
    for (const p of batch) {
      if (!p?.name || !p?.headline) continue;
      // The model repeats names across batches; keep the first of each.
      if (personas.some(x => x.name.toLowerCase() === p.name.toLowerCase())) {
        continue;
      }
      personas.push({
        name: p.name.trim(),
        headline: (p.headline || "").trim().slice(0, 60),
        expertise: (p.expertise || "").trim().slice(0, 160),
        voice: (p.voice || "").trim().slice(0, 160),
      });
      if (personas.length >= total) break;
    }
  }

  // One shared unusable password: these accounts are never logged into.
  const password = await bcrypt.hash(randomUUID(), 10);
  const now = Date.now();
  let created = 0;

  for (let i = 0; i < personas.length; i++) {
    const p = personas[i];
    if (!p) continue;
    const email = `agent-${randomUUID()}@${AGENT_EMAIL_DOMAIN}`;
    // Stagger joins across the past 90 days so they do not all appear at once.
    const joinedAt = new Date(now - Math.floor(Math.random() * 90) * 86_400_000);

    try {
      await prisma.$transaction(async tn => {
        const auth = await tn.auth.create({
          data: {
            email,
            password,
            role: UserRole.PERSON,
            status: UserStatus.ACTIVE,
            isAgent: true,
            allowNotifications: false,
          },
        });
        await tn.person.create({
          data: {
            email,
            name: p.name,
            title: p.headline,
            image: avatarFor(p.name),
          },
        });
        await tn.chatParticipant.create({
          data: {
            chatId: group.chat!.id,
            authId: auth.id,
            role: ChatRole.MEMBER,
            joinedAt,
          },
        });
        await tn.agentPersona.create({
          data: {
            authId: auth.id,
            groupId,
            headline: p.headline,
            expertise: p.expertise,
            voice: p.voice,
            isActive: i < activeCount,
          },
        });
      });
      created++;
    } catch (error) {
      // One bad row must not abandon the whole seed.
      console.error("Failed to create agent", p.name, error);
    }
  }

  return { groupId, requested: total, created, active: Math.min(activeCount, created) };
};

/** Recent posts, so an agent does not repeat what is already there. */
const recentPostTexts = async (groupId: string) => {
  const posts = await prisma.forumPost.findMany({
    where: { groupId },
    orderBy: { createdAt: "desc" },
    take: CONTEXT_POSTS,
    select: { text: true },
  });
  return posts.map(p => p.text.replace(/\s+/g, " ").slice(0, 160));
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Picks an agent that has not posted yet today.
 *
 * One post per active agent per day, chosen at random from whoever is still
 * owed a turn. With five active agents that gives exactly five posts a day,
 * each from a different member - which is what makes it read as a community
 * rather than one account talking to itself.
 */
const pickPersona = async (groupId: string) => {
  const candidates = await prisma.agentPersona.findMany({
    where: {
      groupId,
      isActive: true,
      isPaused: false,
      // Nobody speaks twice in a day.
      activities: {
        none: {
          createdAt: { gte: startOfToday() },
          kind: { in: ["POST", "REPLY"] },
        },
      },
    },
    select: {
      id: true,
      headline: true,
      expertise: true,
      voice: true,
      auth: { select: { id: true, person: { select: { name: true } } } },
    },
  });
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
};

/** How many active agents still owe a post today. */
export const agentsRemainingToday = async (groupId: string) =>
  prisma.agentPersona.count({
    where: {
      groupId,
      isActive: true,
      isPaused: false,
      activities: {
        none: {
          createdAt: { gte: startOfToday() },
          kind: { in: ["POST", "REPLY"] },
        },
      },
    },
  });

/** One agent writes a new discussion post. */
const runStartDiscussion = async (groupId: string) => {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { name: true, description: true },
  });
  if (!group) throw new ApiError(404, "Community not found.");

  const persona = await pickPersona(groupId);
  if (!persona) return { skipped: "No active agent available." };

  const context = communityContextFrom(group);
  const recent = await recentPostTexts(groupId);
  const prompt = startDiscussionPrompt(
    context,
    {
      name: persona.auth.person?.name ?? "A member",
      headline: persona.headline,
      expertise: persona.expertise,
      voice: persona.voice,
    },
    recent
  );

  try {
    const text = (
      await askAi({
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        maxTokens: 300,
        temperature: 1,
      })
    ).replace(/^["']|["']$/g, "");

    const post = await prisma.forumPost.create({
      data: { groupId, authorId: persona.auth.id, text, images: [] },
      select: { id: true, text: true },
    });
    await prisma.agentPersona.update({
      where: { id: persona.id },
      data: { lastPostedAt: new Date() },
    });
    await log(persona.id, groupId, "POST", text.slice(0, 200), {
      postId: post.id,
    });
    return { postId: post.id, text: post.text };
  } catch (error) {
    await log(persona.id, groupId, "FAILED", "Could not write a post", {
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/**
 * One agent replies to a real member's post that nobody has answered.
 *
 * Agents never reply to each other: two bots talking is the fastest way for a
 * community to read as fake.
 */
const runReplyToUnanswered = async (groupId: string) => {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { name: true, description: true },
  });
  if (!group) throw new ApiError(404, "Community not found.");

  const target = await prisma.forumPost.findFirst({
    where: {
      groupId,
      author: { isAgent: false },
      replies: { none: {} },
      createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      text: true,
      author: {
        select: { person: { select: { name: true } }, business: { select: { name: true } } },
      },
    },
  });
  if (!target) return { skipped: "No unanswered member post to reply to." };

  const persona = await pickPersona(groupId);
  if (!persona) return { skipped: "No active agent available." };

  const context = communityContextFrom(group);
  const prompt = replyPrompt(
    context,
    {
      name: persona.auth.person?.name ?? "A member",
      headline: persona.headline,
      expertise: persona.expertise,
      voice: persona.voice,
    },
    {
      author:
        target.author?.person?.name || target.author?.business?.name || "A member",
      text: target.text,
    },
    []
  );

  try {
    const text = (
      await askAi({
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        maxTokens: 300,
        temperature: 0.9,
      })
    ).replace(/^["']|["']$/g, "");

    const reply = await prisma.forumReply.create({
      data: { postId: target.id, authorId: persona.auth.id, text },
      select: { id: true },
    });
    await prisma.agentPersona.update({
      where: { id: persona.id },
      data: { lastPostedAt: new Date() },
    });
    await log(persona.id, groupId, "REPLY", text.slice(0, 200), {
      postId: target.id,
    });
    return { replyId: reply.id, postId: target.id, text };
  } catch (error) {
    await log(persona.id, groupId, "FAILED", "Could not write a reply", {
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

const listAgents = async (groupId: string) => {
  const personas = await prisma.agentPersona.findMany({
    where: { groupId },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      headline: true,
      expertise: true,
      voice: true,
      isActive: true,
      isPaused: true,
      lastPostedAt: true,
      auth: { select: { id: true, person: { select: { name: true } } } },
    },
  });
  return personas.map(p => ({
    id: p.id,
    authId: p.auth.id,
    name: p.auth.person?.name ?? "Unknown",
    headline: p.headline,
    expertise: p.expertise,
    voice: p.voice,
    isActive: p.isActive,
    isPaused: p.isPaused,
    lastPostedAt: p.lastPostedAt,
  }));
};

const setAgentPaused = async (personaId: string, isPaused: boolean) => {
  const persona = await prisma.agentPersona.update({
    where: { id: personaId },
    data: { isPaused },
    select: { id: true, isPaused: true },
  });
  return persona;
};

const activityLog = async (groupId: string, limit = 50) =>
  prisma.agentActivity.findMany({
    where: { groupId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      kind: true,
      summary: true,
      detail: true,
      postId: true,
      createdAt: true,
      persona: { select: { auth: { select: { person: { select: { name: true } } } } } },
    },
  });

/** Removes every agent in a community - accounts, personas and their posts. */
const removeAgents = async (groupId: string) => {
  const personas = await prisma.agentPersona.findMany({
    where: { groupId },
    select: { authId: true },
  });
  const authIds = personas.map(p => p.authId);
  if (!authIds.length) return { removed: 0 };

  await prisma.$transaction(async tn => {
    await tn.forumReply.deleteMany({ where: { authorId: { in: authIds } } });
    await tn.forumPost.deleteMany({ where: { authorId: { in: authIds } } });
    await tn.chatParticipant.deleteMany({ where: { authId: { in: authIds } } });
    await tn.person.deleteMany({
      where: { auth: { id: { in: authIds } } },
    });
    await tn.auth.deleteMany({ where: { id: { in: authIds } } });
  });

  return { removed: authIds.length };
};

export const agentServices = {
  seedAgents,
  runStartDiscussion,
  runReplyToUnanswered,
  listAgents,
  setAgentPaused,
  activityLog,
  removeAgents,
  communityContextFrom,
};
