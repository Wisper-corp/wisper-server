"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostService = void 0;
const client_1 = require("@prisma/client");
const awss3_1 = require("../../utils/awss3");
const paginationCalculation_1 = require("../../utils/paginationCalculation");
const prisma_1 = __importDefault(require("../../utils/prisma"));
const ApiError_1 = __importDefault(require("../../middlewares/classes/ApiError"));
const ensureGroupMembership = async (groupId, userId) => {
    const group = await prisma_1.default.group.findUniqueOrThrow({
        where: {
            id: groupId,
        },
        select: {
            chat: {
                select: {
                    participants: {
                        where: {
                            authId: userId,
                        },
                        select: {
                            id: true,
                        },
                    },
                },
            },
        },
    });
    if (!(group.chat?.participants.length || 0)) {
        throw new ApiError_1.default(403, "You are not a member of this group!");
    }
};
const create = async (id, payload, files) => {
    payload.authorId = id;
    if (payload.groupId) {
        await ensureGroupMembership(payload.groupId, id);
    }
    if (files && files.length) {
        const images = [];
        for (const file of files) {
            const url = await (0, awss3_1.uploadToS3)(file);
            images.push(url);
        }
        payload.images = images;
    }
    const result = await prisma_1.default.post.create({
        data: payload,
    });
    return result;
};
const getFeedPosts = async (userId, options) => {
    const andConditions = [];
    andConditions.push({
        status: client_1.PostStatus.ACTIVE,
    });
    const currentAuth = await prisma_1.default.auth.findUnique({
        where: {
            id: userId,
        },
        select: {
            id: true,
            business: {
                select: {
                    industry: true,
                },
            },
        },
    });
    const connections = await prisma_1.default.connection.findMany({
        where: {
            OR: [
                {
                    requesterId: userId,
                },
                {
                    receiverId: userId,
                },
            ],
            status: client_1.ConnectionStatus.ACCEPTED,
        },
        select: {
            id: true,
            requesterId: true,
            receiverId: true,
        },
    });
    const authorIds = connections.map(connection => connection.receiverId === userId
        ? connection.requesterId
        : connection.receiverId);
    authorIds.push(userId);
    if (authorIds.length > 1) {
        andConditions.push({
            authorId: {
                in: authorIds,
            },
        });
    }
    else if (currentAuth?.business?.industry) {
        andConditions.push({
            author: {
                business: {
                    industry: {
                        contains: currentAuth.business.industry,
                        mode: "insensitive",
                    },
                },
            },
        });
    }
    const whereConditions = andConditions.length > 0 ? { AND: andConditions } : {};
    const { page, take, skip, sortBy, orderBy } = (0, paginationCalculation_1.calculatePagination)(options);
    const orderByClause = sortBy && orderBy
        ? { [sortBy]: orderBy }
        : { createdAt: client_1.Prisma.SortOrder.desc };
    const postSelect = {
        id: true,
        caption: true,
        groupId: true,
        images: true,
        views: true,
        price: true,
        deliveryTime: true,
        createdAt: true,
        commentAccess: true,
        author: {
            select: {
                id: true,
                person: {
                    select: {
                        id: true,
                        name: true,
                        title: true,
                        image: true,
                    },
                },
                business: {
                    select: {
                        id: true,
                        name: true,
                        industry: true,
                        image: true,
                    },
                },
            },
        },
        group: {
            select: {
                id: true,
                name: true,
                image: true,
            },
        },
        _count: {
            select: {
                comment: true,
            },
        },
    };
    const industry = currentAuth?.business?.industry || "";
    const boostTargetFilter = industry
        ? {
            OR: [
                {
                    targetIndustry: {
                        contains: industry,
                        mode: "insensitive",
                    },
                },
                {
                    targetIndustry: {
                        equals: "ALL",
                        mode: "insensitive",
                    },
                },
            ],
        }
        : null;
    let boostedPosts = [];
    let boostedTotal = 0;
    if (boostTargetFilter) {
        const boostAudienceFilter = {
            status: client_1.BoostStatus.ACTIVE,
            AND: [boostTargetFilter],
        };
        const boostedWhere = {
            status: client_1.PostStatus.ACTIVE,
            boosts: {
                some: boostAudienceFilter,
            },
        };
        boostedTotal = await prisma_1.default.post.count({ where: boostedWhere });
        const boostedSkip = Math.min(skip, boostedTotal);
        const boostedTake = Math.max(0, Math.min(take, boostedTotal - boostedSkip));
        if (boostedTake > 0) {
            boostedPosts = await prisma_1.default.post.findMany({
                where: boostedWhere,
                select: postSelect,
                skip: boostedSkip,
                take: boostedTake,
                orderBy: orderByClause,
            });
        }
    }
    const normalSkip = boostTargetFilter
        ? Math.max(0, skip - boostedTotal)
        : skip;
    const normalTake = take - boostedPosts.length;
    const normalWhere = boostTargetFilter
        ? {
            AND: andConditions,
            NOT: {
                boosts: {
                    some: {
                        status: client_1.BoostStatus.ACTIVE,
                        AND: [boostTargetFilter],
                    },
                },
            },
        }
        : whereConditions;
    const normalPosts = normalTake > 0
        ? await prisma_1.default.post.findMany({
            where: normalWhere,
            select: postSelect,
            skip: normalSkip,
            take: normalTake,
            orderBy: orderByClause,
        })
        : [];
    // Preserve existing behavior: shuffle normal posts only, keep boosted on top.
    normalPosts.sort(() => Math.random() - 0.5);
    const posts = [...boostedPosts, ...normalPosts];
    const normalTotal = await prisma_1.default.post.count({
        where: normalWhere,
    });
    const total = boostedTotal + normalTotal;
    // Attach avgRating and ratingCount for each post's author
    const postsWithRatings = await Promise.all(posts.map(async (post) => {
        const authorId = post.author?.id;
        if (!authorId)
            return { ...post, avgRating: 0, ratingCount: 0 };
        const agg = await prisma_1.default.recommendation.aggregate({
            where: { receiverId: authorId },
            _avg: { rating: true },
            _count: { rating: true },
        });
        return {
            ...post,
            avgRating: agg._avg.rating ?? 0,
            ratingCount: agg._count.rating ?? 0,
        };
    }));
    const meta = {
        page,
        limit: take,
        total,
    };
    return { meta, posts: postsWithRatings };
};
const getSingle = async (id) => {
    const result = await prisma_1.default.post.findUnique({
        where: {
            id,
        },
        include: {
            author: {
                select: {
                    id: true,
                    role: true,
                    person: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            image: true,
                            phone: true,
                            title: true,
                            address: true,
                        },
                    },
                    business: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            image: true,
                            phone: true,
                            industry: true,
                            address: true,
                        },
                    },
                },
            },
            group: {
                select: {
                    id: true,
                    name: true,
                    image: true,
                },
            },
        },
    });
    return result;
};
const getGroupPosts = async (groupId, options, query) => {
    const andConditions = [
        { groupId },
        { status: client_1.PostStatus.ACTIVE },
    ];
    if (query?.searchTerm) {
        andConditions.push({
            caption: { contains: query.searchTerm, mode: "insensitive" },
        });
    }
    const whereConditions = { AND: andConditions };
    const { page, take, skip, sortBy, orderBy } = (0, paginationCalculation_1.calculatePagination)(options);
    const posts = await prisma_1.default.post.findMany({
        where: whereConditions,
        include: {
            author: {
                select: {
                    id: true,
                    role: true,
                    person: {
                        select: {
                            id: true,
                            name: true,
                            image: true,
                            title: true,
                        },
                    },
                    business: {
                        select: {
                            id: true,
                            name: true,
                            image: true,
                            industry: true,
                        },
                    },
                },
            },
            group: {
                select: {
                    id: true,
                    name: true,
                    image: true,
                },
            },
            _count: {
                select: {
                    comment: true,
                },
            },
        },
        skip,
        take,
        orderBy: sortBy && orderBy ? { [sortBy]: orderBy } : { createdAt: "desc" },
    });
    const total = await prisma_1.default.post.count({
        where: whereConditions,
    });
    const meta = {
        page,
        limit: take,
        total,
    };
    return { meta, posts };
};
const allPosts = async (options, query) => {
    const andConditions = [];
    andConditions.push({
        status: client_1.PostStatus.ACTIVE,
    });
    let postStatus = client_1.PostStatus.ACTIVE;
    if (query?.status)
        postStatus = query.status;
    andConditions.push({
        status: postStatus,
    });
    if (query?.authorId) {
        andConditions.push({
            authorId: query.authorId,
        });
    }
    const whereConditions = andConditions.length > 0 ? { AND: andConditions } : {};
    const { page, take, skip, sortBy, orderBy } = (0, paginationCalculation_1.calculatePagination)(options);
    const posts = await prisma_1.default.post.findMany({
        where: whereConditions,
        include: {
            author: {
                select: {
                    id: true,
                    role: true,
                    person: {
                        select: {
                            id: true,
                            name: true,
                            image: true,
                            title: true,
                        },
                    },
                    business: {
                        select: {
                            id: true,
                            name: true,
                            image: true,
                        },
                    },
                },
            },
            group: {
                select: {
                    id: true,
                    name: true,
                    image: true,
                },
            },
        },
        skip,
        take,
        orderBy: sortBy && orderBy ? { [sortBy]: orderBy } : { createdAt: "desc" },
    });
    const total = await prisma_1.default.post.count({
        where: whereConditions,
    });
    const meta = {
        page,
        limit: take,
        total,
    };
    return { meta, posts };
};
const update = async (userId, id, payload, files) => {
    const post = await prisma_1.default.post.findUniqueOrThrow({
        where: {
            id,
            status: client_1.PostStatus.ACTIVE,
        },
    });
    if (post.authorId !== userId)
        throw new ApiError_1.default(401, "Unauthorized");
    if (payload.groupId) {
        await ensureGroupMembership(payload.groupId, userId);
    }
    if (files && files.length) {
        const images = post.images || [];
        for (const file of files) {
            const url = await (0, awss3_1.uploadToS3)(file);
            images.push(url);
        }
        payload.images = images;
    }
    const result = await prisma_1.default.post.update({
        where: {
            id,
        },
        data: payload,
    });
    return result;
};
const removeImage = async (userId, id, url) => {
    const post = await prisma_1.default.post.findUniqueOrThrow({
        where: {
            id,
        },
    });
    if (post.authorId !== userId)
        throw new ApiError_1.default(401, "Unauthorized");
    const images = post.images.filter(image => image !== url);
    const result = await prisma_1.default.post.update({
        where: {
            id,
        },
        data: {
            images,
        },
    });
    await (0, awss3_1.deleteFromS3)(url);
    return result;
};
const updateCommentAccess = async (userId, id, commentAccess) => {
    const post = await prisma_1.default.post.findUniqueOrThrow({
        where: {
            id,
        },
    });
    if (post.authorId !== userId)
        throw new ApiError_1.default(401, "Unauthorized");
    const result = await prisma_1.default.post.update({
        where: {
            id,
        },
        data: {
            commentAccess,
        },
    });
    return result;
};
const changePostStatus = async (userId, userRole, id, status) => {
    console.log("status, ", status);
    const post = await prisma_1.default.post.findUniqueOrThrow({
        where: {
            id,
        },
    });
    if (userRole !== client_1.UserRole.ADMIN && post.authorId !== userId)
        throw new ApiError_1.default(401, "Unauthorized");
    const result = await prisma_1.default.post.update({
        where: {
            id,
        },
        data: {
            status,
        },
    });
    let message = "";
    if (result.status === client_1.PostStatus.ACTIVE) {
        message = "Post restored successfully!";
    }
    else if (result.status === client_1.PostStatus.DELETED) {
        message = "Post deleted successfully!";
    }
    else if (result.status === client_1.PostStatus.TRASHED) {
        message = "Post trashed successfully!";
    }
    return { result, message };
};
const deletePost = async (id, userId) => {
    const post = await prisma_1.default.post.findUniqueOrThrow({
        where: {
            id,
        },
    });
    if (post.authorId !== userId)
        throw new ApiError_1.default(401, "Unauthorized");
    const result = await prisma_1.default.$transaction(async (tn) => {
        const result = await tn.post.delete({
            where: {
                id,
            },
        });
        await tn.comment.deleteMany({
            where: {
                postId: id,
            },
        });
        await tn.reaction.deleteMany({
            where: {
                postId: id,
            },
        });
        await tn.boost.deleteMany({
            where: {
                postId: id,
            },
        });
        await tn.complaint.deleteMany({
            where: {
                postId: id,
            },
        });
        return result;
    });
    return result;
};
const incrementView = async (postId, userId) => {
    const post = await prisma_1.default.post.findUnique({
        where: { id: postId },
        select: { authorId: true, views: true },
    });
    if (!post)
        throw new ApiError_1.default(404, "Post not found");
    // Don't count views from the post owner
    if (post.authorId === userId) {
        return { views: post.views };
    }
    const updated = await prisma_1.default.post.update({
        where: { id: postId },
        data: { views: { increment: 1 } },
        select: { views: true },
    });
    return { views: updated.views };
};
// Search Gig Market posts by job title (author's title) or caption
const searchGigMarket = async (_userId, searchQuery, country, options) => {
    const { page, take, skip } = (0, paginationCalculation_1.calculatePagination)(options);
    const andConditions = [
        { status: client_1.PostStatus.ACTIVE },
        { images: { isEmpty: false } },
    ];
    // Country filter — match author's address field
    if (country) {
        andConditions.push({
            author: {
                OR: [
                    { person: { address: { contains: country, mode: 'insensitive' } } },
                    { business: { address: { contains: country, mode: 'insensitive' } } },
                ],
            },
        });
    }
    // Search query filter
    if (searchQuery) {
        andConditions.push({
            OR: [
                { caption: { contains: searchQuery, mode: 'insensitive' } },
                { author: { person: { title: { contains: searchQuery, mode: 'insensitive' } } } },
                { author: { business: { industry: { contains: searchQuery, mode: 'insensitive' } } } },
            ],
        });
    }
    const whereConditions = { AND: andConditions };
    const [rawPosts, total] = await Promise.all([
        prisma_1.default.post.findMany({
            where: whereConditions,
            select: {
                id: true,
                caption: true,
                images: true,
                views: true,
                price: true,
                deliveryTime: true,
                currency: true,
                createdAt: true,
                commentAccess: true,
                author: {
                    select: {
                        id: true,
                        person: {
                            select: { id: true, name: true, title: true, image: true },
                        },
                        business: {
                            select: { id: true, name: true, industry: true, image: true },
                        },
                    },
                },
            },
            skip,
            take,
            orderBy: { createdAt: 'desc' },
        }),
        prisma_1.default.post.count({ where: whereConditions }),
    ]);
    // Attach avgRating and ratingCount for each post's author
    const posts = await Promise.all(rawPosts.map(async (post) => {
        const authorId = post.author?.id;
        if (!authorId)
            return { ...post, avgRating: 0, ratingCount: 0 };
        const agg = await prisma_1.default.recommendation.aggregate({
            where: { receiverId: authorId },
            _avg: { rating: true },
            _count: { rating: true },
        });
        return {
            ...post,
            avgRating: agg._avg.rating ?? 0,
            ratingCount: agg._count.rating ?? 0,
        };
    }));
    return { meta: { page, limit: take, total }, posts };
};
exports.PostService = {
    create,
    getFeedPosts,
    getGroupPosts,
    getSingle,
    allPosts,
    update,
    removeImage,
    updateCommentAccess,
    changePostStatus,
    deletePost,
    incrementView,
    searchGigMarket,
};
//# sourceMappingURL=post.service.js.map