import { PostStatus, Prisma, UserRole, UserStatus } from "@prisma/client";
import prisma from "../../utils/prisma";
import { TPersonSignUp, TUpdatePersonProfile } from "./person.validation";
import ApiError from "../../middlewares/classes/ApiError";
import bcrypt from "bcrypt";
import generateOTP from "../../utils/generateOTP";
import { sendEmail } from "../../utils/sendEmail";
import { TFile } from "../../interface/file.interface";
import { deleteFromS3, uploadToS3 } from "../../utils/awss3";
import {
  calculatePagination,
  TPaginationOptions,
} from "../../utils/paginationCalculation";
import { addUserToGeneralChat } from "../../utils/generalChat";

/**
 * How long an emailed code stays valid.
 *
 * Ten minutes, because delivery through an external relay routinely takes a
 * minute or more and longer to Gmail under load. The old windows were two,
 * three and five minutes depending on which path you came in by, so a code
 * could expire while it was still in transit and the person was told it was
 * wrong. Codes are single use and stored hashed, so the extra minutes cost
 * nothing in safety.
 */
const OTP_EXPIRY_MINUTES = 10;

const signUp = async (payload: TPersonSignUp) => {
  const existingUser = await prisma.auth.findUnique({
    where: {
      email: payload.person.email,
      OR: [
        { status: UserStatus.ACTIVE },
        { status: UserStatus.BLOCKED },
        { status: UserStatus.DELETED },
      ],
    },
  });

  if (existingUser) throw new ApiError(400, "User already exists!");

  // Who sent them here. Comes from the shared profile the visitor was looking
  // at; ignored unless it names a real person, so a junk value cannot poison
  // the referral figures.
  if (payload.person.referredById) {
    const referrer = await prisma.person.findUnique({
      where: { id: payload.person.referredById },
      select: { id: true },
    });
    if (!referrer) delete (payload.person as { referredById?: string }).referredById;
  }

  // One account per WhatsApp number. Enforced here rather than with a unique
  // index because the column already holds duplicates from before this rule,
  // and an index would refuse to build over them.
  if (payload.person.phone) {
    const phoneTaken = await prisma.person.findFirst({
      where: {
        phone: payload.person.phone,
        NOT: { email: payload.person.email },
      },
      select: { id: true },
    });

    if (phoneTaken)
      throw new ApiError(
        400,
        "That WhatsApp number is already used by another account!"
      );
  }

  const hashedPassword = await bcrypt.hash(payload.password, 10);
  const authData = {
    email: payload.person.email,
    password: hashedPassword,
    role: UserRole.PERSON,
  };

  const otp = generateOTP();

  const result = await prisma.$transaction(async tn => {
    const auth = await tn.auth.upsert({
      where: {
        email: payload.person.email,
      },
      create: authData,
      update: authData,
    });

    const result = await tn.person.upsert({
      where: {
        email: payload.person.email,
      },
      create: payload.person,
      update: payload.person,
    });

    const hashedOtp = await bcrypt.hash(otp.toString(), 10);
    const otpExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    const otpData = {
      email: payload.person.email,
      otp: hashedOtp,
      expires: otpExpires,
      attempts: 0,
    };

    await tn.otp.upsert({
      where: {
        email: payload.person.email,
      },
      update: otpData,
      create: otpData,
    });

    await addUserToGeneralChat(tn, auth.id);

    return result;
  });

  // sendEmail
  if (result) {
    const subject = "Complete your signup – verify your email";
    const replacements = {
      name: payload.person.name,
      otp,
    };
    const path = "./src/app/emailTemplates/welcome.html";
    sendEmail(payload.person.email, subject, path, replacements);
  }

  return result;
};

const getSingle = async (id: string, currentAuthId: string) => {
  const result = await prisma.auth.findUnique({
    where: {
      id: id,
      role: UserRole.PERSON,
    },
    select: {
      id: true,
      createdAt: true,
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
    },
  });

  const connection = await prisma.connection.findFirst({
    where: {
      OR: [
        { requesterId: currentAuthId, receiverId: id },
        { requesterId: id, receiverId: currentAuthId },
      ],
    },
  });

  const ratingAgg = await prisma.recommendation.aggregate({
    where: { receiverId: id },
    _avg: { rating: true },
    _count: { rating: true },
  });

  return {
    auth: result,
    connection,
    avgRating: ratingAgg._avg.rating ?? 0,
    ratingCount: ratingAgg._count.rating ?? 0,
  };
};

const getMyProfile = async (id: string) => {
  const result = await prisma.auth.findUnique({
    where: {
      id: id,
    },
    select: {
      id: true,
      role: true,
      createdAt: true,
      person: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          phone: true,
          title: true,
          defaultResume: {
            select: {
              name: true,
              file: true,
              fileSize: true,
              createdAt: true,
            },
          },
          address: true,
        },
      },
    },
  });

  // Compute rating stats
  const ratingAgg = await prisma.recommendation.aggregate({
    where: { receiverId: id },
    _avg: { rating: true },
    _count: { rating: true },
  });

  return {
    auth: result,
    avgRating: ratingAgg._avg.rating ?? 0,
    ratingCount: ratingAgg._count.rating ?? 0,
  };
};

const updateMyProfile = async (
  email: string,
  payload: TUpdatePersonProfile
) => {
  const result = await prisma.person.update({
    where: {
      email,
    },
    data: payload,
  });

  return result;
};

const updateProfileImage = async (email: string, file: TFile) => {
  if (!file) throw new Error("No file provided!");
  const person = await prisma.person.findUnique({
    where: {
      email,
    },
  });
  const image = await uploadToS3(file);
  const result = await prisma.person.update({
    where: {
      email,
    },
    data: {
      image,
    },
  });
  if (result && person?.image) await deleteFromS3(person.image);
  return result;
};

const getUserRoles = async (
  options: TPaginationOptions,
  query: Record<string, any>,
  currentAuthId: string
) => {
  const andConditions: Prisma.AuthWhereInput[] = [];

  andConditions.push({
    role: UserRole.PERSON,
  });

  if (query.searchTerm) {
    andConditions.push({
      OR: [
        {
          person: {
            OR: [
              { name: { contains: query.searchTerm, mode: "insensitive" } },
              { title: { contains: query.searchTerm, mode: "insensitive" } },
            ],
          },
        },
      ],
    });
  }

  if (query.country) {
    andConditions.push({
      person: {
        address: { contains: query.country as string, mode: "insensitive" },
      },
    });
  }

  const whereConditions: Prisma.AuthWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const { page, take, skip, sortBy, orderBy } = calculatePagination(options);
  const roles = await prisma.auth.findMany({
    where: whereConditions,
    select: {
      id: true,
      person: {
        select: {
          name: true,
          image: true,
          title: true,
        },
      },
      _count: {
        select: {
          posts: true,
          receivedRecommendations: true,
        },
      },
      requestedConnections: {
        where: {
          receiverId: currentAuthId,
        },
        select: {
          status: true,
          requesterId: true,
        },
      },
      receivedConnections: {
        where: {
          requesterId: currentAuthId,
        },
        select: {
          status: true,
          receiverId: true,
        },
      },
    },
    skip,
    take,
    orderBy: sortBy && orderBy ? { [sortBy]: orderBy } : { createdAt: "desc" },
  });

  const mappedRoles = roles.map(user => {
    const outgoing = user.receivedConnections[0];
    const incoming = user.requestedConnections[0];

    let connectionStatus = "NOT_CONNECTED";

    if (outgoing) {
      connectionStatus =
        outgoing.status === "PENDING" ? "REQUEST_SENT" : outgoing.status;
    }

    if (incoming) {
      connectionStatus =
        incoming.status === "PENDING" ? "REQUEST_RECEIVED" : incoming.status;
    }

    return {
      ...user,
      connectionStatus,
    };
  });

  const total = await prisma.auth.count({
    where: {
      role: UserRole.PERSON,
    },
  });

  const meta = {
    page,
    limit: take,
    total,
  };
  return { meta, roles: mappedRoles };
};

const getGroupRoles = async (
  groupId: string,
  currentAuthId: string,
  options: TPaginationOptions,
  query: Record<string, any>
) => {
  const group = await prisma.group.findUniqueOrThrow({
    where: {
      id: groupId,
    },
    select: {
      chat: {
        select: {
          participants: {
            where: {
              authId: currentAuthId,
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

  const andConditions: Prisma.AuthWhereInput[] = [
    {
      role: UserRole.PERSON,
    },
    {
      participatedChats: {
        some: {
          chat: {
            groupId,
          },
        },
      },
    },
  ];

  if (query.searchTerm) {
    andConditions.push({
      person: {
        OR: [
          { name: { contains: query.searchTerm, mode: "insensitive" } },
          { title: { contains: query.searchTerm, mode: "insensitive" } },
        ],
      },
    });
  }

  const whereConditions: Prisma.AuthWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const { page, take, skip, sortBy, orderBy } = calculatePagination(options);
  const roles = await prisma.auth.findMany({
    where: whereConditions,
    select: {
      id: true,
      person: {
        select: {
          name: true,
          image: true,
          title: true,
        },
      },
      _count: {
        select: {
          posts: true,
          receivedRecommendations: true,
        },
      },
      requestedConnections: {
        where: {
          receiverId: currentAuthId,
        },
        select: {
          status: true,
          requesterId: true,
        },
      },
      receivedConnections: {
        where: {
          requesterId: currentAuthId,
        },
        select: {
          status: true,
          receiverId: true,
        },
      },
    },
    skip,
    take,
    orderBy: sortBy && orderBy ? { [sortBy]: orderBy } : { createdAt: "desc" },
  });

  const mappedRoles = roles.map(user => {
    const outgoing = user.receivedConnections[0];
    const incoming = user.requestedConnections[0];

    let connectionStatus = "NOT_CONNECTED";

    if (outgoing) {
      connectionStatus =
        outgoing.status === "PENDING" ? "REQUEST_SENT" : outgoing.status;
    }

    if (incoming) {
      connectionStatus =
        incoming.status === "PENDING" ? "REQUEST_RECEIVED" : incoming.status;
    }

    return {
      ...user,
      connectionStatus,
    };
  });

  const total = await prisma.auth.count({
    where: whereConditions,
  });

  const meta = {
    page,
    limit: take,
    total,
  };
  return { meta, roles: mappedRoles };
};


/**
 * A profile as a stranger sees it, for a shared link.
 *
 * Unauthenticated, so it is deliberately narrow: the fields a profile page
 * renders and nothing else. Email and phone are excluded -- publishing a
 * WhatsApp number to anyone holding a URL is not the same as showing it to
 * the person who owns the profile.
 */
/**
 * Members worth showing on the Home page.
 *
 * Only people who have put something up: a photo and either a service or a
 * resume. A directory of blank avatars is worse than no directory, and the
 * bar doubles as the nudge to finish a profile.
 *
 * Signed in only. It returns no email, phone or resume file -- the file is
 * somebody's work history with their address in it, so the page says one
 * exists and stops there.
 */
const ratingOf = (rs: { rating: number }[]): number | null => {
  if (!rs.length) return null;
  return Math.round((rs.reduce((a, r) => a + r.rating, 0) / rs.length) * 10) / 10;
};

const discoverMembers = async (query: Record<string, any>) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;
  const term = String(query.searchTerm ?? "").trim();

  const where: Prisma.AuthWhereInput = {
    role: "PERSON",
    person: { is: { image: { not: null } } },
    posts: { some: {} },
  };

  // Searched by the two things someone would actually type: who they are,
  // and what they do.
  if (term) {
    where.AND = [
      {
        OR: [
          { person: { is: { name: { contains: term, mode: "insensitive" } } } },
          { person: { is: { title: { contains: term, mode: "insensitive" } } } },
          { posts: { some: { caption: { contains: term, mode: "insensitive" } } } },
        ],
      },
    ];
  }

  // Fetched whole, then filtered and paged here, because the test that
  // matters -- is the service description actually saying anything -- is a
  // string length, and Prisma cannot express that in a where clause. The
  // directory is small enough that this costs nothing; if it grows past a
  // few thousand people this wants a raw query with char_length().
  const candidates = await prisma.auth.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        person: { select: { name: true, image: true, title: true, address: true } },
        posts: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: {
            id: true, caption: true, aiSummary: true, price: true,
            priceType: true, currency: true, deliveryTime: true, images: true,
          },
        },
        // The ratings people have actually been given. Averaged below rather
        // than stored, because there is no rating column to drift out of date.
        receivedRecommendations: { select: { rating: true } },
        _count: { select: { posts: true, resumes: true } },
      },
  });

  // "hello", "test", "new comeback" are not services. A real description of
  // work runs to a sentence, so the floor is set where a sentence begins --
  // low enough to keep a terse but genuine listing, high enough to drop a
  // greeting.
  const MIN_SERVICE_CAPTION = 40;
  const rows = candidates.filter(r => {
    const caption = (r.posts[0]?.caption ?? "").trim();
    return caption.length >= MIN_SERVICE_CAPTION;
  });

  const total = rows.length;
  const paged = rows.slice(skip, skip + limit);

  const members = paged.map(r => ({
    id: r.id,
    name: r.person?.name ?? "",
    image: r.person?.image ?? null,
    title: r.person?.title ?? null,
    location: r.person?.address ?? null,
    serviceCount: r._count.posts,
    // Whether one exists, never where it lives.
    hasResume: r._count.resumes > 0,
    // Averaged only when there is something to average. A member with no
    // recommendations gets null, not 0 and not 5 -- the card then shows no
    // rating at all. Printing "5.0 (0)" on every new profile would put a
    // perfect score on people nobody has rated yet.
    rating: ratingOf(r.receivedRecommendations),
    ratingCount: r.receivedRecommendations.length,
    latestService: r.posts[0]
      ? {
          id: r.posts[0].id,
          // The card's line: the précis when the caption was too long to fit,
          // otherwise the caption itself. The full caption always travels too,
          // so the service page can show the author's own words.
          summary: r.posts[0].aiSummary ?? r.posts[0].caption,
          caption: r.posts[0].caption,
          price: r.posts[0].price,
          priceType: r.posts[0].priceType ?? "FIXED",
          currency: r.posts[0].currency ?? "NGN",
          deliveryTime: r.posts[0].deliveryTime ?? null,
          image: r.posts[0].images?.[0] ?? null,
        }
      : null,
  }));

  return { meta: { page, limit, total, pages: Math.ceil(total / limit) }, members };
};

const getPublicProfile = async (personId: string) => {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      name: true,
      image: true,
      title: true,
      address: true,
      email: true, // used below to reach the auth row, never returned
    },
  });

  if (!person) throw new ApiError(404, "Profile not found!");

  const auth = await prisma.auth.findUnique({
    where: { email: person.email },
    select: { id: true, createdAt: true, status: true },
  });

  if (!auth || auth.status !== UserStatus.ACTIVE)
    throw new ApiError(404, "Profile not found!");

  const rating = await prisma.recommendation.aggregate({
    where: { receiverId: auth.id },
    _avg: { rating: true },
    _count: { rating: true },
  });

  const posts = await prisma.post.findMany({
    where: { authorId: auth.id, status: PostStatus.ACTIVE },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      caption: true,
      images: true,
      price: true,
      currency: true,
      deliveryTime: true,
      createdAt: true,
    },
  });

  const reviews = await prisma.recommendation.findMany({
    where: { receiverId: auth.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      rating: true,
      text: true,
      createdAt: true,
      giver: {
        select: {
          person: { select: { name: true, image: true, title: true } },
          business: { select: { name: true, image: true } },
        },
      },
    },
  });

  return {
    id: person.id,
    // The id a review is addressed to. Opaque, and needed by anyone who wants
    // to leave one -- the profile is reached by person id, but a
    // recommendation is filed against the auth row.
    authId: auth.id,
    name: person.name,
    image: person.image,
    title: person.title,
    address: person.address,
    joinedAt: auth.createdAt,
    avgRating: rating._avg.rating ?? 0,
    ratingCount: rating._count.rating ?? 0,
    posts,
    reviews,
  };
};

export const personServices = {
  getPublicProfile,
  discoverMembers,
  signUp,
  getSingle,
  getMyProfile,
  updateMyProfile,
  updateProfileImage,
  getGroupRoles,
  getUserRoles,
};
