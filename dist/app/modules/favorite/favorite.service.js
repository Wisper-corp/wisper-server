"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.favoriteJobService = void 0;
const prisma_1 = __importDefault(require("../../utils/prisma"));
const addOrRemoveFavoriteJob = async (authId, jobId) => {
    await prisma_1.default.job.findUniqueOrThrow({ where: { id: jobId } });
    const existingFavorite = await prisma_1.default.favoriteJob.findFirst({
        where: {
            jobId,
            authId,
        },
    });
    if (existingFavorite) {
        const result = await prisma_1.default.favoriteJob.delete({
            where: {
                id: existingFavorite.id,
            },
        });
        const message = "Job removed from favorite list successfully!";
        return { result, message };
    }
    else {
        const result = await prisma_1.default.favoriteJob.create({
            data: { jobId, authId },
        });
        const message = "Job added to favorite successfully!";
        return { result, message };
    }
};
const myFavoriteList = async (authId) => {
    console.log("userId, ", authId);
    const result = await prisma_1.default.favoriteJob.findMany({
        where: {
            authId,
        },
        include: {
            job: {
                include: {
                    author: {
                        select: {
                            id: true,
                            business: {
                                select: {
                                    id: true,
                                    name: true,
                                    image: true,
                                },
                            },
                            person: {
                                select: {
                                    id: true,
                                    name: true,
                                    title: true,
                                    image: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    });
    return result;
};
exports.favoriteJobService = {
    addOrRemoveFavoriteJob,
    myFavoriteList,
};
//# sourceMappingURL=favorite.service.js.map