"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobServices = void 0;
const prisma_1 = __importDefault(require("../../utils/prisma"));
const paginationCalculation_1 = require("../../utils/paginationCalculation");
const job_constant_1 = require("./job.constant");
const ApiError_1 = __importDefault(require("../../middlewares/classes/ApiError"));
const sendNotification_1 = require("../../utils/sendNotification");
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
const createJob = async (userId, payload) => {
    payload.authorId = userId;
    // Default industry if not provided
    if (!payload.industry)
        payload.industry = "General";
    // Strip fields not yet in Prisma client (added via raw SQL migration)
    const { currency, applicationEmail, ...cleanPayload } = payload;
    // Ensure group membership
    if (cleanPayload.groupId) {
        await ensureGroupMembership(cleanPayload.groupId, userId);
    }
    const result = await prisma_1.default.job.create({ data: cleanPayload });
    if (payload.industry) {
        const recipients = await prisma_1.default.auth.findMany({
            where: {
                id: {
                    not: userId,
                },
                OR: [
                    {
                        person: {
                            industry: {
                                contains: payload.industry,
                                mode: "insensitive",
                            },
                        },
                    },
                    {
                        business: {
                            industry: {
                                contains: payload.industry,
                                mode: "insensitive",
                            },
                        },
                    },
                ],
            },
            select: {
                id: true,
            },
        });
        await Promise.all(recipients.map(recipient => (0, sendNotification_1.sendNotificationToUser)(recipient.id, "New job posted", "A new job was posted in your industry.")));
    }
    return result;
};
const getAllJobs = async (options, query) => {
    const { searchTerm, maxSalary, minSalary, postedAfter } = query;
    const andConditions = [];
    // add search
    if (searchTerm) {
        andConditions.push({
            OR: job_constant_1.jobSearchableFields.map(field => ({
                [field]: {
                    contains: searchTerm,
                    mode: "insensitive",
                },
            })),
        });
    }
    job_constant_1.jobFilterableFields.forEach(field => andConditions.push({
        [field]: query[field],
    }));
    if (maxSalary && minSalary) {
        andConditions.push({
            salary: {
                gte: Number(minSalary),
                lte: Number(maxSalary),
            },
        });
    }
    if (postedAfter) {
        andConditions.push({
            createdAt: {
                gte: postedAfter,
            },
        });
    }
    const whereConditions = andConditions.length > 0 ? { AND: andConditions } : {};
    // Filter scraped jobs to English titles only
    // Non-English chars: exclude jobs with common non-ASCII characters (German, French, etc.)
    const finalWhereConditions = {
        AND: [
            whereConditions,
            {
                OR: [
                    // User-posted jobs — always show
                    { isScraped: false },
                    // Scraped jobs — only show if they have a company logo AND title has no non-Latin characters
                    {
                        isScraped: true,
                        companyLogo: { not: null },
                        NOT: {
                            OR: [
                                { companyLogo: '' },
                                { title: { contains: 'ü' } },
                                { title: { contains: 'ö' } },
                                { title: { contains: 'ä' } },
                                { title: { contains: 'ß' } },
                                { title: { contains: 'é' } },
                                { title: { contains: 'è' } },
                                { title: { contains: 'ê' } },
                                { title: { contains: 'ñ' } },
                                { title: { contains: 'ç' } },
                                { title: { contains: 'm/w/d' } },
                                { title: { contains: '(m/f/d)' } },
                                { title: { contains: '(f/m/d)' } },
                                { description: { contains: 'wir suchen' } },
                                { description: { contains: 'Auftrag' } },
                                { description: { contains: 'München' } },
                            ],
                        },
                    },
                ],
            },
        ],
    };
    const { page, take, skip, sortBy, orderBy } = (0, paginationCalculation_1.calculatePagination)(options);
    const jobs = await prisma_1.default.job.findMany({
        where: finalWhereConditions,
        skip,
        take,
        orderBy: sortBy && orderBy ? { [sortBy]: orderBy } : { createdAt: "desc" },
        select: {
            id: true,
            author: {
                select: {
                    id: true,
                    person: {
                        select: { id: true, name: true, title: true, image: true },
                    },
                    business: {
                        select: {
                            id: true,
                            name: true,
                            industry: true,
                            address: true,
                            image: true,
                        },
                    },
                },
            },
            title: true,
            description: true,
            salary: true,
            compensationType: true,
            experienceLevel: true,
            qualification: true,
            responsibilities: true,
            requirements: true,
            applicationType: true,
            locationType: true,
            isScraped: true,
            companyLogo: true,
            companyName: true,
            location: true,
            type: true,
            createdAt: true,
        },
    });
    const total = await prisma_1.default.job.count({
        where: finalWhereConditions,
    });
    const meta = {
        page,
        limit: take,
        total,
    };
    return { meta, jobs };
};
const getGroupJobs = async (groupId, options) => {
    const whereConditions = {
        groupId,
    };
    const { page, take, skip, sortBy, orderBy } = (0, paginationCalculation_1.calculatePagination)(options);
    const jobs = await prisma_1.default.job.findMany({
        where: whereConditions,
        skip,
        take,
        orderBy: sortBy && orderBy ? { [sortBy]: orderBy } : { createdAt: "desc" },
        select: {
            id: true,
            groupId: true,
            author: {
                select: {
                    id: true,
                    person: {
                        select: { id: true, name: true, title: true, image: true },
                    },
                    business: {
                        select: { id: true, name: true, industry: true, address: true, image: true },
                    },
                },
            },
            group: {
                select: { id: true, name: true, image: true },
            },
            title: true,
            description: true,
            salary: true,
            compensationType: true,
            experienceLevel: true,
            qualification: true,
            responsibilities: true,
            requirements: true,
            applicationType: true,
            locationType: true,
            isScraped: true,
            companyLogo: true,
            companyName: true,
            location: true,
            type: true,
            createdAt: true,
        },
    });
    const total = await prisma_1.default.job.count({
        where: whereConditions,
    });
    const meta = {
        page,
        limit: take,
        total,
    };
    return { meta, jobs };
};
const getSingleJob = async (id, userId) => {
    const job = await prisma_1.default.job.findFirstOrThrow({
        where: {
            id,
        },
        include: {
            author: {
                select: {
                    id: true,
                    person: {
                        select: { id: true, name: true, title: true, image: true },
                    },
                    business: {
                        select: {
                            id: true,
                            name: true,
                            industry: true,
                            address: true,
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
    });
    const favoriteJob = await prisma_1.default.favoriteJob.findFirst({
        where: {
            jobId: id,
            authId: userId,
        },
    });
    return { ...job, isFavorite: favoriteJob ? true : false };
};
const updateJob = async (id, userId, payload) => {
    const job = await prisma_1.default.job.findUniqueOrThrow({
        where: {
            id,
        },
    });
    if (job.authorId !== userId)
        throw new ApiError_1.default(401, "Unauthorized!");
    if (payload.groupId) {
        await ensureGroupMembership(payload.groupId, userId);
    }
    const result = await prisma_1.default.job.update({
        where: {
            id,
        },
        data: payload,
    });
    return result;
};
const deleteJob = async (id, userId) => {
    const job = await prisma_1.default.job.findUniqueOrThrow({
        where: {
            id,
        },
    });
    if (job.authorId !== userId)
        throw new ApiError_1.default(401, "Unauthorized!");
    const result = await prisma_1.default.job.delete({
        where: {
            id,
        },
    });
    return result;
};
exports.jobServices = {
    createJob,
    getAllJobs,
    getGroupJobs,
    getSingleJob,
    updateJob,
    deleteJob,
};
//# sourceMappingURL=job.service.js.map