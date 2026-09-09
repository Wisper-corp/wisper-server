import { Prisma, UserRole } from "@prisma/client";
import { Admin } from "@prisma/client";
import { TFile } from "../../interface/file.interface";
import { deleteFromS3, uploadToS3 } from "../../utils/awss3";
import prisma from "../../utils/prisma";

const getProfile = async (email: string) => {
  const admin = await prisma.admin.findUniqueOrThrow({
    where: {
      email: email,
    },
  });

  return admin;
};

const updateProfile = async (
  email: string,
  payload: Partial<Admin>,
  file?: TFile
) => {
  const admin = await prisma.admin.findUniqueOrThrow({
    where: {
      email: email,
    },
  });

  if (file) {
    payload.profileImage = await uploadToS3(file);
  }

  const result = await prisma.admin.update({
    where: {
      email: email,
    },
    data: payload,
  });

  if (result && payload.profileImage && admin.profileImage) {
    await deleteFromS3(admin.profileImage);
  }

  return result;
};


/**
 * The numbers behind the web signup site.
 *
 * Every figure is a count of *people*, not events: "posted a service" means
 * how many accounts have at least one, not how many services exist, because
 * one person posting nine is not nine people posting.
 */
const getWebStats = async () => {
  const [registered, referred, posters, reviewed, services, reviews] =
    await Promise.all([
      prisma.person.count(),
      prisma.person.count({ where: { NOT: { referredById: null } } }),
      prisma.post
        .findMany({ select: { authorId: true }, distinct: ["authorId"] })
        .then(rows => rows.length),
      prisma.recommendation
        .findMany({
          where: { NOT: { receiverId: null } },
          select: { receiverId: true },
          distinct: ["receiverId"],
        })
        .then(rows => rows.length),
      prisma.post.count(),
      prisma.recommendation.count(),
    ]);

  const rate = (n: number) =>
    registered ? Number(((n / registered) * 100).toFixed(1)) : 0;

  return {
    registered,
    referred,
    referralRate: rate(referred),
    postedService: posters,
    servicePostRate: rate(posters),
    totalServices: services,
    withReviews: reviewed,
    reviewRate: rate(reviewed),
    totalReviews: reviews,
  };
};

/**
 * Every customer with what they have actually done.
 *
 * Driven from Auth rather than Person: Person carries no createdAt, so "who
 * joined most recently" only exists on the auth row -- which is also what
 * posts and reviews are keyed to.
 *
 * Counts are gathered per table and stitched on by id rather than fetched per
 * person; 134 accounts would otherwise be several hundred queries.
 */
const getWebCustomers = async (opts: {
  search?: string;
  skip: number;
  take: number;
}) => {
  const where: Prisma.AuthWhereInput = {
    role: UserRole.PERSON,
    person: { isNot: null },
    ...(opts.search
      ? {
          person: {
            OR: [
              { name: { contains: opts.search, mode: "insensitive" } },
              { email: { contains: opts.search, mode: "insensitive" } },
              { title: { contains: opts.search, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };

  const [total, auths] = await Promise.all([
    prisma.auth.count({ where }),
    prisma.auth.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
      select: {
        id: true,
        status: true,
        createdAt: true,
        person: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            title: true,
            image: true,
            address: true,
            referredById: true,
          },
        },
      },
    }),
  ]);

  const authIds = auths.map(a => a.id);
  const referrerIds = auths
    .map(a => a.person?.referredById)
    .filter((v): v is string => !!v);

  const [postCounts, reviewCounts, ratings, referrers] = await Promise.all([
    prisma.post.groupBy({
      by: ["authorId"],
      where: { authorId: { in: authIds } },
      _count: { _all: true },
    }),
    prisma.recommendation.groupBy({
      by: ["receiverId"],
      where: { receiverId: { in: authIds } },
      _count: { _all: true },
    }),
    prisma.recommendation.groupBy({
      by: ["receiverId"],
      where: { receiverId: { in: authIds } },
      _avg: { rating: true },
    }),
    referrerIds.length
      ? prisma.person.findMany({
          where: { id: { in: referrerIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const posts = new Map(postCounts.map(r => [r.authorId, r._count._all]));
  const revs = new Map(reviewCounts.map(r => [r.receiverId, r._count._all]));
  const avg = new Map(ratings.map(r => [r.receiverId, r._avg.rating ?? 0]));
  const refName = new Map(referrers.map(r => [r.id, r.name]));

  return {
    meta: { total, skip: opts.skip, take: opts.take },
    customers: auths.map(a => {
      const p = a.person!;
      const referredById = p.referredById ?? null;
      return {
        id: p.id,
        name: p.name,
        email: p.email,
        phone: p.phone,
        title: p.title,
        image: p.image,
        address: p.address,
        joinedAt: a.createdAt,
        status: a.status,
        services: posts.get(a.id) ?? 0,
        reviews: revs.get(a.id) ?? 0,
        avgRating: Number((avg.get(a.id) ?? 0).toFixed(1)),
        referredBy: referredById
          ? { id: referredById, name: refName.get(referredById) ?? "Unknown" }
          : null,
      };
    }),
  };
};

export const adminServices = {
  getWebStats,
  getWebCustomers,
  getProfile,
  updateProfile,
};
