import prisma from "../../utils/prisma";

const search = async (q: string, limit: number = 20) => {
  if (!q || q.trim().length < 1) {
    // Return top industries across sectors when no query
    const results = await prisma.industry.findMany({
      take: limit,
      orderBy: { name: "asc" },
      select: { id: true, name: true, sector: true },
    });
    return results;
  }

  const results = await prisma.industry.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { sector: { contains: q, mode: "insensitive" } },
      ],
    },
    take: limit,
    orderBy: { name: "asc" },
    select: { id: true, name: true, sector: true },
  });

  return results;
};

const getSectors = async () => {
  const sectors = await prisma.industry.findMany({
    distinct: ["sector"],
    select: { sector: true },
    orderBy: { sector: "asc" },
  });
  return sectors.map((s: { sector: string }) => s.sector);
};

export const industryService = { search, getSectors };
