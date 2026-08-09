"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatService = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../../utils/prisma"));
const ApiError_1 = __importDefault(require("../../middlewares/classes/ApiError"));
const paginationCalculation_1 = require("../../utils/paginationCalculation");
const onlineUsers_1 = __importDefault(require("../../socket/utils/onlineUsers"));
const config_1 = __importDefault(require("../../config"));
const createChat = async (authId, payload) => {
    if (authId == payload.participantId)
        throw new ApiError_1.default(400, "You cannot create a chat with yourself!");
    const participantIds = [authId, payload.participantId];
    const existingChat = await prisma_1.default.chat.findFirst({
        where: {
            type: client_1.ChatType.INDIVIDUAL,
            AND: participantIds.map(id => ({
                participants: { some: { authId: id } },
            })),
        },
    });
    if (existingChat) {
        const existingChatDeletion = await prisma_1.default.chatDeletion.findFirst({
            where: {
                chatId: existingChat.id,
                authId: authId,
            },
        });
        if (existingChatDeletion) {
            await prisma_1.default.chatDeletion.delete({
                where: {
                    id: existingChatDeletion.id,
                },
            });
        }
        return existingChat;
    }
    const chatPayload = {
        type: client_1.ChatType.INDIVIDUAL,
    };
    const result = await prisma_1.default.$transaction(async (tn) => {
        const newChat = await tn.chat.create({
            data: chatPayload,
        });
        const participantPayloads = participantIds.map(id => ({
            chatId: newChat.id,
            authId: id,
            role: client_1.ChatRole.MEMBER,
        }));
        await tn.chatParticipant.createMany({ data: participantPayloads });
        return newChat;
    });
    return result;
};
const getMyChats = async (authId, options, query) => {
    const { searchTerm } = query;
    const andConditions = [];
    andConditions.push({ participants: { some: { authId } } });
    // filter out deleted chat
    andConditions.push({
        chatDeletions: {
            none: {
                authId,
            },
        },
        NOT: {
            id: config_1.default.generalChatId,
        },
    });
    if (searchTerm) {
        andConditions.push({
            OR: [
                { group: { name: { contains: searchTerm, mode: "insensitive" } } },
                { class: { name: { contains: searchTerm, mode: "insensitive" } } },
                {
                    participants: {
                        some: {
                            auth: {
                                OR: [
                                    {
                                        person: {
                                            name: { contains: searchTerm, mode: "insensitive" },
                                        },
                                    },
                                    {
                                        business: {
                                            name: { contains: searchTerm, mode: "insensitive" },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            ],
        });
    }
    const whereConditions = andConditions.length > 0 ? { AND: andConditions } : {};
    const { page, take, skip, sortBy, orderBy } = (0, paginationCalculation_1.calculatePagination)(options);
    const chats = await prisma_1.default.chat.findMany({
        where: whereConditions,
        select: {
            id: true,
            type: true,
            latestMessageAt: true,
            groupId: true,
            classId: true,
            participants: {
                select: {
                    id: true,
                    auth: {
                        select: {
                            id: true,
                            person: { select: { name: true, image: true } },
                            business: { select: { name: true, image: true } },
                        },
                    },
                },
            },
            group: { select: { image: true, name: true } },
            class: { select: { image: true, name: true } },
            messages: {
                select: {
                    id: true,
                    text: true,
                    file: true,
                    fileType: true,
                    sender: {
                        select: {
                            id: true,
                            person: { select: { name: true } },
                            business: { select: { name: true } },
                        },
                    },
                },
                take: 1,
                orderBy: { createdAt: "desc" },
            },
            _count: {
                select: {
                    messages: {
                        where: {
                            NOT: {
                                messagesSeen: {
                                    some: { participant: { authId } },
                                },
                            },
                            senderId: { not: authId },
                        },
                    },
                },
            },
        },
        skip,
        take,
        orderBy: sortBy && orderBy ? { [sortBy]: orderBy } : { latestMessageAt: "desc" },
    });
    const total = await prisma_1.default.chat.count({ where: whereConditions });
    const meta = { page, limit: take, total };
    const refinedChats = chats.map(chat => ({
        ...chat,
        participants: chat.participants.map(p => ({
            ...p,
            isOnline: Boolean(onlineUsers_1.default[p.auth.id]),
        })),
    }));
    return { meta, chats: refinedChats };
};
const getChatLinks = async (authId, chatId) => {
    await prisma_1.default.chat.findUniqueOrThrow({
        where: {
            id: chatId,
            participants: {
                some: { authId },
            },
        },
    });
    const links = await prisma_1.default.message.findMany({
        where: {
            chatId,
            link: {
                not: null,
            },
        },
        select: {
            id: true,
            link: true,
        },
    });
    return links;
};
const getChatFiles = async (authId, chatId, query) => {
    const { type } = query;
    await prisma_1.default.chat.findUniqueOrThrow({
        where: {
            id: chatId,
            participants: {
                some: { authId },
            },
        },
    });
    const links = await prisma_1.default.message.findMany({
        where: {
            chatId,
            file: {
                not: null,
            },
            fileType: type ? type : { not: client_1.FileType.DOC },
        },
        select: {
            id: true,
            file: true,
            fileType: true,
        },
    });
    return links;
};
const getChatMuteInfo = async (chatId) => {
    const muteInfos = await prisma_1.default.chatMute.findUnique({
        where: {
            chatId,
        },
        select: {
            authId: true,
            muteFor: true,
            mutedAt: true,
        },
    });
    return muteInfos;
};
const muteChat = async (authId, payload) => {
    await prisma_1.default.chat.findUniqueOrThrow({
        where: {
            id: payload.chatId,
        },
    });
    payload.mutedAt = new Date();
    payload.authId = authId;
    const result = await prisma_1.default.chatMute.upsert({
        where: {
            authId_chatId: {
                authId,
                chatId: payload.chatId,
            },
        },
        create: payload,
        update: payload,
    });
    return result;
};
const unmuteChat = async (authId, chatId) => {
    await prisma_1.default.chat.findUniqueOrThrow({
        where: {
            id: chatId,
        },
    });
    const result = await prisma_1.default.chatMute.delete({
        where: {
            authId_chatId: {
                authId,
                chatId,
            },
        },
    });
    return result;
};
const removeParticipant = async (authId, payload) => {
    await prisma_1.default.chat.findUniqueOrThrow({
        where: {
            id: payload.chatId,
            OR: [{ type: client_1.ChatType.GROUP }, { type: client_1.ChatType.CLASS }],
        },
    });
    const targetParticipant = await prisma_1.default.chatParticipant.findUniqueOrThrow({
        where: {
            id: payload.participantId,
        },
        select: { authId: true },
    });
    const myParticipant = await prisma_1.default.chatParticipant.findFirst({
        where: {
            chatId: payload.chatId,
            authId,
        },
        select: {
            role: true,
            chat: {
                select: {
                    type: true,
                },
            },
        },
    });
    if (myParticipant?.chat.type !== client_1.ChatType.GROUP &&
        myParticipant?.chat.type !== client_1.ChatType.CLASS)
        throw new ApiError_1.default(400, "You can only remove participants from groups & classes!");
    // Allow if leaving yourself OR if you are admin
    const isSelfLeave = targetParticipant.authId === authId;
    if (!isSelfLeave && myParticipant?.role !== client_1.ChatRole.ADMIN)
        throw new ApiError_1.default(403, "You are not an admin of this chat!");
    // Delete related message_seen records first to avoid FK constraint
    await prisma_1.default.messageSeen.deleteMany({
        where: { participantId: payload.participantId },
    });
    const result = await prisma_1.default.chatParticipant.delete({
        where: {
            id: payload.participantId,
        },
    });
    return result;
};
const blockChatParticipant = async (authId, payload) => {
    await prisma_1.default.chat.findUniqueOrThrow({
        where: {
            id: payload.chatId,
        },
    });
    await prisma_1.default.auth.findUniqueOrThrow({
        where: {
            id: payload.authId,
        },
    });
    if (authId === payload.authId)
        throw new ApiError_1.default(400, "You cannot block yourself!");
    const myParticipant = await prisma_1.default.chatParticipant.findFirst({
        where: {
            chatId: payload.chatId,
            authId,
        },
        select: {
            role: true,
            chat: {
                select: {
                    type: true,
                },
            },
        },
    });
    if (myParticipant?.chat.type === client_1.ChatType.GROUP ||
        myParticipant?.chat.type === client_1.ChatType.CLASS) {
        if (myParticipant?.role !== client_1.ChatRole.ADMIN)
            throw new ApiError_1.default(403, "Only admin can block a participant!");
    }
    const alreadyBlocked = await prisma_1.default.blockedChatParticipant.findFirst({
        where: {
            authId: payload.authId,
            chatId: payload.chatId,
        },
    });
    if (alreadyBlocked)
        throw new ApiError_1.default(400, "Chat participant is already blocked!");
    const result = await prisma_1.default.blockedChatParticipant.create({
        data: {
            authId: payload.authId,
            chatId: payload.chatId,
        },
    });
    return result;
};
const unBlockChatParticipant = async (authId, payload) => {
    const blockedChatParticipant = await prisma_1.default.blockedChatParticipant.findFirstOrThrow({
        where: {
            authId: payload.authId,
            chatId: payload.chatId,
        },
    });
    const myParticipant = await prisma_1.default.chatParticipant.findFirst({
        where: {
            chatId: blockedChatParticipant.chatId,
            authId,
        },
        select: {
            role: true,
            chat: {
                select: {
                    type: true,
                },
            },
        },
    });
    if (myParticipant?.chat.type === client_1.ChatType.GROUP ||
        myParticipant?.chat.type === client_1.ChatType.CLASS) {
        if (myParticipant?.role !== client_1.ChatRole.ADMIN)
            throw new ApiError_1.default(403, "Only admin can unblock a participant!");
    }
    const result = await prisma_1.default.blockedChatParticipant.delete({
        where: {
            id: blockedChatParticipant.id,
        },
    });
    return result;
};
const deleteChat = async (authId, chatId) => {
    await prisma_1.default.chat.findUniqueOrThrow({
        where: {
            id: chatId,
        },
    });
    const existingDeletion = await prisma_1.default.chatDeletion.findFirst({
        where: {
            authId,
            chatId,
        },
    });
    if (existingDeletion) {
        throw new ApiError_1.default(400, "You have already deleted this chat!");
    }
    const result = await prisma_1.default.chatDeletion.create({
        data: {
            authId,
            chatId,
        },
    });
    return result;
};
const updateParticipantRole = async (authId, payload) => {
    // Verify caller is ADMIN
    const myParticipant = await prisma_1.default.chatParticipant.findFirst({
        where: { chatId: payload.chatId, authId },
        select: { role: true },
    });
    if (myParticipant?.role !== client_1.ChatRole.ADMIN)
        throw new ApiError_1.default(403, "Only admins can assign roles!");
    // Validate role
    const validRoles = ["ADMIN", "MODERATOR", "MEMBER"];
    if (!validRoles.includes(payload.role))
        throw new ApiError_1.default(400, `Invalid role. Must be one of: ${validRoles.join(", ")}`);
    const result = await prisma_1.default.chatParticipant.update({
        where: { id: payload.participantId },
        data: { role: payload.role },
        select: { id: true, role: true, authId: true },
    });
    return result;
};
exports.chatService = {
    createChat,
    getMyChats,
    getChatLinks,
    getChatFiles,
    getChatMuteInfo,
    muteChat,
    unmuteChat,
    removeParticipant,
    blockChatParticipant,
    unBlockChatParticipant,
    deleteChat,
    updateParticipantRole,
};
//# sourceMappingURL=chat.service.js.map