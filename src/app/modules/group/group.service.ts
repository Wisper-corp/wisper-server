import { ChatRole, ChatType, Prisma } from "@prisma/client";
import ApiError from "../../middlewares/classes/ApiError";
import prisma from "../../utils/prisma";
import { TCreateGroup, TUpdateGroupData } from "./group.validation";
import { TFile } from "../../interface/file.interface";
import { deleteFromS3, uploadToS3 } from "../../utils/awss3";
import {
  calculatePagination,
  TPaginationOptions,
} from "../../utils/paginationCalculation";

const createGroup = async (payload: TCreateGroup, authId: string) => {
  const { members, ...groupPayload } = payload;
  const result = await prisma.$transaction(async tn => {
    const newGroup = await tn.group.create({
      data: groupPayload,
    });

    const chatPayload = {
      type: ChatType.GROUP,
      groupId: newGroup.id,
    };
    const newChat = await tn.chat.create({
      data: chatPayload,
    });

    const memberPayloads = [];
    for (const memberId of members) {
      const member = await prisma.auth.findUnique({
        where: {
          id: memberId,
        },
      });
      if (!member) throw new ApiError(400, `Invalid member id!: ${memberId}`);

      memberPayloads.push({
        chatId: newChat.id,
        authId: memberId,
        role: ChatRole.MEMBER,
      });
    }
    memberPayloads.push({
      chatId: newChat.id,
      authId,
      role: ChatRole.ADMIN,
    });

    await tn.chatParticipant.createMany({
      data: memberPayloads,
    });

    return newGroup;
  });

  return result;
};

const getAllGroups = async (
  options: TPaginationOptions,
  query: Record<string, any>,
  authId: string
) => {
  const andConditions: Prisma.GroupWhereInput[] = [];

  if (query.searchTerm) {
    andConditions.push({
      OR: [{ name: { contains: query.searchTerm, mode: "insensitive" } }],
    });
  }

  andConditions.push({
    NOT: {
      chat: {
        is: {
          participants: {
            some: {
              authId,
            },
          },
        },
      },
    },
  });
  // Query params arrive as strings, so the raw value ("false") is truthy and
  // would be handed to a Prisma Boolean field — which throws a validation
  // error. Only filter on an explicit true/false; anything else (absent, empty
  // or malformed) means "no isPrivate filter".
  if (query.isPrivate === true || query.isPrivate === "true") {
    andConditions.push({ isPrivate: true });
  } else if (query.isPrivate === false || query.isPrivate === "false") {
    andConditions.push({ isPrivate: false });
  }
  const whereConditions: Prisma.GroupWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};
  const { page, take, skip, sortBy, orderBy } = calculatePagination(options);

  const groups = await prisma.group.findMany({
    where: whereConditions,
    select: {
      id: true,
      name: true,
      image: true,
      createdAt: true,
      chat: {
        select: {
          id: true,
          _count: {
            select: {
              participants: true,
            },
          },
          participants: {
            take: 3,
            select: {
              auth: {
                select: {
                  person: { select: { name: true, image: true } },
                  business: { select: { name: true, image: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: sortBy && orderBy ? { [sortBy]: orderBy } : { createdAt: "desc" },
    skip,
    take,
  });

  const total = await prisma.group.count({
    where: whereConditions,
  });

  const meta = {
    page,
    limit: take,
    total,
  };
  return { meta, groups };
};

/// Counts what the caller has done inside each of the given groups, and when
/// they last did it.
///
/// Three separate reads rather than one clever query: messages hang off the
/// group's chat, forum posts off the group, and forum replies off a post, so
/// there is no single join that covers all three without a union.
const ENGAGEMENT_WINDOW_DAYS = 30;

const measureEngagement = async (authId: string, groupIds: string[]) => {
  const tally = new Map<string, { count: number; lastAt: Date }>();
  if (!groupIds.length) return tally;

  const since = new Date(
    Date.now() - ENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  const record = (groupId: string | null | undefined, at: Date) => {
    if (!groupId) return;
    const existing = tally.get(groupId);
    if (!existing) {
      tally.set(groupId, { count: 1, lastAt: at });
      return;
    }
    existing.count += 1;
    if (at > existing.lastAt) existing.lastAt = at;
  };

  try {
    const [messages, posts, replies] = await Promise.all([
      prisma.message.findMany({
        where: {
          senderId: authId,
          createdAt: { gte: since },
          chat: { groupId: { in: groupIds } },
        },
        select: { createdAt: true, chat: { select: { groupId: true } } },
      }),
      prisma.forumPost.findMany({
        where: {
          authorId: authId,
          createdAt: { gte: since },
          groupId: { in: groupIds },
        },
        select: { createdAt: true, groupId: true },
      }),
      prisma.forumReply.findMany({
        where: {
          authorId: authId,
          createdAt: { gte: since },
          post: { groupId: { in: groupIds } },
        },
        select: { createdAt: true, post: { select: { groupId: true } } },
      }),
    ]);

    for (const m of messages) record(m.chat?.groupId, m.createdAt);
    for (const p of posts) record(p.groupId, p.createdAt);
    for (const r of replies) record(r.post?.groupId, r.createdAt);
  } catch (error) {
    // Ordering is a nicety; the list itself is not. An unranked Home beats a
    // Home that fails to load.
    console.error("Failed to measure community engagement", error);
  }

  return tally;
};

const getPublicGroups = async (
  options: TPaginationOptions,
  query: Record<string, any>,
  authId: string
) => {
  // Home is "the communities I belong to", so a group the caller has joined
  // belongs in this list even when it is private — otherwise a joined private
  // community is reachable from nowhere in the app. Explore and search still
  // only surface public groups, because a private group the caller is *not* a
  // member of never satisfies either branch.
  const andConditions: Prisma.GroupWhereInput[] = [
    {
      OR: [
        { isPrivate: false },
        {
          chat: {
            is: {
              participants: {
                some: {
                  authId,
                },
              },
            },
          },
        },
      ],
    },
  ];

  if (query.searchTerm) {
    andConditions.push({
      name: {
        contains: query.searchTerm,
        mode: "insensitive",
      },
    });
  }

  const whereConditions: Prisma.GroupWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const { page, take, skip, sortBy, orderBy } = calculatePagination(options);

  const groups = await prisma.group.findMany({
    where: whereConditions,
    select: {
      id: true,
      name: true,
      description: true,
      image: true,
      createdAt: true,
      isFeatured: true,
      chat: {
        select: {
          id: true,
          _count: {
            select: {
              participants: true,
            },
          },
          participants: {
            take: 3,
            orderBy: {
              joinedAt: "desc",
            },
            select: {
              auth: {
                select: {
                  id: true,
                  person: {
                    select: {
                      image: true,
                    },
                  },
                  business: {
                    select: {
                      image: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: sortBy && orderBy ? { [sortBy]: orderBy } : { createdAt: "desc" },
    skip,
    take,
  });

  const joinedGroupIds = new Set(
    (
      await prisma.chatParticipant.findMany({
        where: {
          authId,
          chat: {
            groupId: {
              in: groups.map(group => group.id),
            },
          },
        },
        select: {
          chat: {
            select: {
              groupId: true,
            },
          },
        },
      })
    )
      .map(participant => participant.chat.groupId)
      .filter((groupId): groupId is string => Boolean(groupId))
  );

  const total = await prisma.group.count({
    where: whereConditions,
  });

  // How engaged the caller is with each community they belong to, so Home can
  // lead with the one they actually use. Engagement means the things a person
  // does in a community: messages in its chat, forum posts, forum replies.
  // Counted over a rolling window so a community that was busy months ago does
  // not hold the top spot forever.
  const engagement = await measureEngagement(authId, [...joinedGroupIds]);

  const refinedGroups = groups.map(group => ({
    id: group.id,
    name: group.name,
    // Community tag pills are encoded in the description
    // ("Trade: X | Market: Y | Category: Z | Suffix: S") and parsed client-side.
    description: group.description,
    image: group.image,
    createdAt: group.createdAt,
    // Hand-picked for Explore: shown regardless of member count.
    isFeatured: group.isFeatured,
    chatId: group.chat?.id || null,
    isJoined: joinedGroupIds.has(group.id),
    memberCount: group.chat?._count.participants || 0,
    members: (group.chat?.participants || []).map(participant => ({
      id: participant.auth.id,
      image:
        participant.auth.person?.image ||
        participant.auth.business?.image ||
        null,
    })),
    // Zero for a group the caller has not joined - they cannot have engaged.
    myActivityCount: engagement.get(group.id)?.count ?? 0,
    myLastActivityAt: engagement.get(group.id)?.lastAt ?? null,
  }));

  const meta = {
    page,
    limit: take,
    total,
  };

  return { meta, groups: refinedGroups };
};

const getSingleGroup = async (id: string) => {
  const result = await prisma.group.findUnique({
    where: {
      id,
    },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      image: true,
      isPrivate: true,
      allowInvitation: true,
      chat: {
        select: {
          _count: {
            select: {
              participants: true,
            },
          },
        },
      },
    },
  });
  return result;
};

const getGroupMembers = async (
  id: string,
  options: TPaginationOptions,
  query: Record<string, any>
) => {
  const andConditions: Prisma.ChatParticipantWhereInput[] = [];

  andConditions.push({
    chat: {
      OR: [{ groupId: id }, { classId: id }],
    },
  });

  if (query.searchTerm) {
    andConditions.push({
      auth: {
        OR: [
          {
            person: {
              name: { contains: query.searchTerm, mode: "insensitive" },
            },
          },
          {
            business: {
              name: { contains: query.searchTerm, mode: "insensitive" },
            },
          },
        ],
      },
    });
  }

  const whereConditions: Prisma.ChatParticipantWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};
  const { page, take, skip, sortBy, orderBy } = calculatePagination(options);
  const members = await prisma.chatParticipant.findMany({
    where: whereConditions,
    select: {
      id: true,
      role: true,
      auth: {
        select: {
          id: true,
          person: {
            select: {
              name: true,
              email: true,
              image: true,
              title: true,
            },
          },
          business: {
            select: {
              name: true,
              email: true,
              image: true,
              industry: true,
            },
          },
        },
      },
    },
    orderBy: sortBy && orderBy ? { [sortBy]: orderBy } : { joinedAt: "desc" },
    skip,
    take,
  });

  const total = await prisma.chatParticipant.count({
    where: whereConditions,
  });

  let community = null;

  community = await prisma.group.findUnique({
    where: {
      id,
    },
    select: {
      id: true,
      name: true,
      image: true,
      chat: {
        select: {
          _count: {
            select: {
              participants: true,
            },
          },
        },
      },
    },
  });

  if (!community) {
    community = await prisma.class.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        name: true,
        image: true,
        chat: {
          select: {
            _count: {
              select: {
                participants: true,
              },
            },
          },
        },
      },
    });
  }

  const meta = {
    page,
    limit: take,
    total,
  };
  return { meta, community, members };
};

const addGroupMember = async (
  groupId: string,
  memberId: string,
  authId: string
) => {
  const group = await prisma.group.findUniqueOrThrow({
    where: {
      id: groupId,
    },
    select: {
      allowInvitation: true,
      chat: {
        select: {
          id: true,
          participants: {
            select: {
              authId: true,
              role: true,
            },
          },
        },
      },
    },
  });

  const isAdmin = group.chat?.participants.find(
    p => p.authId === authId && p.role === ChatRole.ADMIN
  );

  if (!group.allowInvitation && !isAdmin)
    throw new ApiError(403, "Group is not open to invitation!");

  const isExist = group.chat?.participants.find(p => p.authId === memberId);
  if (isExist) throw new ApiError(400, "Member already exist!");

  const memberPayload = {
    chatId: group.chat?.id as string,
    authId: memberId,
    role: ChatRole.MEMBER,
  };

  const result = await prisma.chatParticipant.create({
    data: memberPayload,
  });

  return result;
};

const joinGroup = async (groupId: string, authId: string) => {
  const group = await prisma.group.findUniqueOrThrow({
    where: {
      id: groupId,
    },
    select: {
      chat: {
        select: {
          id: true,
          participants: {
            where: {
              authId,
            },
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  const isAlreadyJoined = (group.chat?.participants.length || 0) > 0;
  if (isAlreadyJoined) throw new ApiError(400, "Member already exist!");

  if (!group.chat?.id) throw new ApiError(400, "Group chat not found!");

  const result = await prisma.chatParticipant.create({
    data: {
      chatId: group.chat.id,
      authId,
      role: ChatRole.MEMBER,
    },
  });

  return result;
};

const changeGroupImage = async (groupId: string, file: TFile) => {
  if (!file) throw new ApiError(400, "File is required!");
  const group = await prisma.group.findUniqueOrThrow({
    where: {
      id: groupId,
    },
  });

  const image = await uploadToS3(file);
  const result = await prisma.group.update({
    where: {
      id: groupId,
    },
    data: {
      image,
    },
  });

  if (result && group.image) await deleteFromS3(group.image);
  return result;
};

const updateGroupData = async (groupId: string, data: TUpdateGroupData) => {
  const result = await prisma.group.update({
    where: {
      id: groupId,
    },
    data,
  });
  return result;
};

const toggleGroupVisibility = async (groupId: string) => {
  const group = await prisma.group.findUniqueOrThrow({
    where: {
      id: groupId,
    },
  });

  const result = await prisma.group.update({
    where: {
      id: groupId,
    },
    data: {
      isPrivate: !group.isPrivate,
    },
  });
  return result;
};

const toggleGroupInvitationAccess = async (groupId: string) => {
  const group = await prisma.group.findUniqueOrThrow({
    where: {
      id: groupId,
    },
  });

  const result = await prisma.group.update({
    where: {
      id: groupId,
    },
    data: {
      allowInvitation: !group.allowInvitation,
    },
  });
  return result;
};

export const groupServices = {
  createGroup,
  getSingleGroup,
  addGroupMember,
  joinGroup,
  changeGroupImage,
  updateGroupData,
  toggleGroupVisibility,
  toggleGroupInvitationAccess,
  getAllGroups,
  getPublicGroups,
  getGroupMembers,
};
