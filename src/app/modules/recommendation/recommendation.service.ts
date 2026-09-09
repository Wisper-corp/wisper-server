import { Recommendation, UserRole } from "@prisma/client";
import ApiError from "../../middlewares/classes/ApiError";
import prisma from "../../utils/prisma";
import { sendNotificationToUser } from "../../utils/sendNotification";

const giveRecommendation = async (payload: Recommendation, authId: string) => {
  if (payload.receiverId) {
    await prisma.auth.findUniqueOrThrow({
      where: {
        id: payload.receiverId,
        role: UserRole.PERSON,
      },
    });
  } else if (payload.classReceiverId) {
    await prisma.class.findUniqueOrThrow({
      where: {
        id: payload.classReceiverId,
      },
    });
  }
  payload.giverId = authId;

  // You cannot review the same person twice: a second review from the same
  // account replaces the first. Without this one account could file five
  // reviews for one profile, and the job board's five-review gate would mean
  // nothing. Submitting still succeeds either way, so nothing that already
  // posts a recommendation breaks -- it just stops stacking duplicates.
  if (payload.receiverId) {
    if (payload.receiverId === authId)
      throw new ApiError(400, "You cannot review your own profile!");

    const existing = await prisma.recommendation.findFirst({
      where: { giverId: authId, receiverId: payload.receiverId },
      select: { id: true },
    });

    if (existing) {
      return prisma.recommendation.update({
        where: { id: existing.id },
        data: { text: payload.text, rating: payload.rating },
      });
    }
  }

  const result = await prisma.recommendation.create({ data: payload });

  if (payload.receiverId) {
    await sendNotificationToUser(
      payload.receiverId,
      "New recommendation",
      "You received a new recommendation."
    );
  }

  return result;
};

const getRecommendationsByPersonId = async (authId: string) => {
  const result = await prisma.recommendation.findMany({
    where: {
      receiverId: authId,
    },
    select: {
      id: true,
      rating: true,
      text: true,
      createdAt: true,
      giver: {
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
    },
  });
  return result;
};

const getClassRecommendations = async (classId: string) => {
  const result = await prisma.recommendation.findMany({
    where: {
      classReceiverId: classId,
    },
    select: {
      id: true,
      rating: true,
      text: true,
      giver: {
        select: {
          id: true,
          person: {
            select: {
              id: true,
              name: true,
              image: true,
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
    },
  });
  return result;
};

export const recommendationService = {
  giveRecommendation,
  getRecommendationsByPersonId,
  getClassRecommendations,
};
