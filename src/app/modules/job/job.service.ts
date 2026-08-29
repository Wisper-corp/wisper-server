import { Job, Prisma } from "@prisma/client";
import {
  NAIRA,
  NIGERIAN_CITIES,
  wantsLocal,
} from "../../utils/localMatch";
import prisma from "../../utils/prisma";
import {
  calculatePagination,
  TPaginationOptions,
} from "../../utils/paginationCalculation";
import { jobFilterableFields, jobSearchableFields } from "./job.constant";
import ApiError from "../../middlewares/classes/ApiError";
import { sendNotificationToUser } from "../../utils/sendNotification";
import config from "../../config";

const ensureGroupMembership = async (groupId: string, userId: string) => {
  const group = await prisma.group.findUniqueOrThrow({
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
    throw new ApiError(403, "You are not a member of this group!");
  }
};

import { checkContentRelevance } from "../../utils/aiModeration";

const createJob = async (userId: string, payload: Job) => {
  payload.authorId = userId;

  // Default industry if not provided
  if (!payload.industry) payload.industry = "General";

  // applicationEmail is still absent from the generated client. `currency` no
  // longer is -- and stripping it meant every job the app posted was saved
  // with the column default of USD, even though the app sends NGN.
  const { applicationEmail, ...cleanPayload } = payload as any;

  // Ensure group membership
  if (cleanPayload.groupId) {
    await ensureGroupMembership(cleanPayload.groupId, userId);
  }

  const result = await prisma.job.create({ data: cleanPayload });

  if (payload.industry) {
    const recipients = await prisma.auth.findMany({
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

    await Promise.all(
      recipients.map(recipient =>
        sendNotificationToUser(
          recipient.id,
          "New job posted",
          "A new job was posted in your industry."
        )
      )
    );
  }

  return result;
};

/// Jobs in Nigeria, or paid in naira.
///
/// Not "near the caller": half the accounts carry no address, which left the
/// filter empty for them, and the audience here is Nigerian -- the question
/// being asked is "is this job here, or paid in naira".
///
/// Cities are matched exactly or as the first part of "City, ..." rather than
/// by substring: "Aba" appears inside plenty of words that are not a city.
const localJobCondition = (): Prisma.JobWhereInput => ({
  OR: [
    { currency: NAIRA },
    { location: { contains: "Nigeria", mode: "insensitive" as const } },
    ...NIGERIAN_CITIES.flatMap(city => [
      { location: { equals: city, mode: "insensitive" as const } },
      { location: { startsWith: `${city},`, mode: "insensitive" as const } },
    ]),
  ],
});

const getAllJobs = async (
  options: TPaginationOptions,
  query: Record<string, any>
) => {
  const { searchTerm, maxSalary, minSalary, postedAfter } = query;
  const andConditions: Prisma.JobWhereInput[] = [];

  // add search
  if (searchTerm) {
    andConditions.push({
      OR: jobSearchableFields.map(field => ({
        [field]: {
          contains: searchTerm,
          mode: "insensitive",
        },
      })),
    });
  }

  jobFilterableFields.forEach(field =>
    andConditions.push({
      [field]: query[field],
    })
  );

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

  if (wantsLocal(query.local)) {
    andConditions.push(localJobCondition());
  }

  const whereConditions: Prisma.JobWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  // Filter scraped jobs to English titles only
  // Non-English chars: exclude jobs with common non-ASCII characters (German, French, etc.)
  const finalWhereConditions: Prisma.JobWhereInput = {
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

  const { page, take, skip, sortBy, orderBy } = calculatePagination(options);
  const jobs = await prisma.job.findMany({
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

  const total = await prisma.job.count({
    where: finalWhereConditions,
  });

  const meta = {
    page,
    limit: take,
    total,
  };
  return { meta, jobs };
};

/// Scraped jobs are only fit to show when they carry a company logo and the
/// title is Latin-script — same bar the main feed applies.
const presentableScrapedJob: Prisma.JobWhereInput = {
  isScraped: true,
  companyLogo: { not: null },
  NOT: {
    OR: [
      { companyLogo: "" },
      { title: { contains: "ü" } },
      { title: { contains: "ö" } },
      { title: { contains: "ä" } },
      { title: { contains: "ß" } },
      { title: { contains: "é" } },
      { title: { contains: "è" } },
      { title: { contains: "ê" } },
      { title: { contains: "ñ" } },
      { title: { contains: "ç" } },
      { title: { contains: "m/w/d" } },
      { title: { contains: "(m/f/d)" } },
      { title: { contains: "(f/m/d)" } },
      { description: { contains: "wir suchen" } },
      { description: { contains: "Auftrag" } },
      { description: { contains: "München" } },
    ],
  },
};

const getGroupJobs = async (
  groupId: string,
  options: TPaginationOptions,
  query: Record<string, any> = {}
) => {
  // One designated community also surfaces the shared scraped-job pool, which
  // is otherwise unreachable (scraped jobs carry no groupId). Every other
  // community keeps showing only what its own members posted.
  const showsScrapedPool =
    Boolean(config.scrapedJobsGroupId) &&
    groupId === config.scrapedJobsGroupId;

  const scope: Prisma.JobWhereInput = showsScrapedPool
    ? { OR: [{ groupId }, presentableScrapedJob] }
    : { groupId };

  // Everything below used to be dropped on the floor: this endpoint took no
  // query at all, so searching inside a community's Jobs tab and filtering it
  // by location both did nothing.
  const andConditions: Prisma.JobWhereInput[] = [scope];

  if (query.searchTerm) {
    andConditions.push({
      OR: jobSearchableFields.map(field => ({
        [field]: { contains: query.searchTerm, mode: "insensitive" },
      })),
    });
  }

  if (query.locationType) {
    andConditions.push({ locationType: query.locationType });
  }

  if (wantsLocal(query.local)) {
    andConditions.push(localJobCondition());
  }

  const whereConditions: Prisma.JobWhereInput = { AND: andConditions };

  const { page, take, skip, sortBy, orderBy } = calculatePagination(options);
  const jobs = await prisma.job.findMany({
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

  const total = await prisma.job.count({
    where: whereConditions,
  });

  const meta = {
    page,
    limit: take,
    total,
  };

  return { meta, jobs };
};

const getSingleJob = async (id: string, userId: string) => {
  const job = await prisma.job.findFirstOrThrow({
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

  const favoriteJob = await prisma.favoriteJob.findFirst({
    where: {
      jobId: id,
      authId: userId,
    },
  });
  return { ...job, isFavorite: favoriteJob ? true : false };
};

const updateJob = async (id: string, userId: string, payload: Partial<Job>) => {
  const job = await prisma.job.findUniqueOrThrow({
    where: {
      id,
    },
  });

  if (job.authorId !== userId) throw new ApiError(401, "Unauthorized!");

  if (payload.groupId) {
    await ensureGroupMembership(payload.groupId, userId);
  }

  const result = await prisma.job.update({
    where: {
      id,
    },
    data: payload,
  });
  return result;
};

const deleteJob = async (id: string, userId: string) => {
  const job = await prisma.job.findUniqueOrThrow({
    where: {
      id,
    },
  });

  if (job.authorId !== userId) throw new ApiError(401, "Unauthorized!");

  const result = await prisma.job.delete({
    where: {
      id,
    },
  });
  return result;
};

export const jobServices = {
  createJob,
  getAllJobs,
  getGroupJobs,
  getSingleJob,
  updateJob,
  deleteJob,
};
