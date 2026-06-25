import { Request, Response } from 'express';
import handleAsyncRequest from '../../utils/handleAsyncRequest';
import { sendResponse } from '../../utils/sendResponse';
import prisma from '../../utils/prisma';

// GET /api/v1/job-titles/search?q=engineer&limit=20
const searchJobTitles = handleAsyncRequest(async (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim();
  const limit = Math.min(parseInt(req.query.limit as string || '20'), 50);

  if (q.length < 2) {
    return sendResponse(res, {
      message: 'Job titles fetched',
      data: [],
    });
  }

  const results = await prisma.jobTitle.findMany({
    where: {
      title: {
        contains: q,
        mode: 'insensitive',
      },
    },
    orderBy: [
      // Exact start match first, then contains
      { title: 'asc' },
    ],
    take: limit,
    select: { title: true },
  });

  // Sort: titles that START with query come first
  const qLower = q.toLowerCase();
  const sorted = results.sort((a, b) => {
    const aStarts = a.title.toLowerCase().startsWith(qLower);
    const bStarts = b.title.toLowerCase().startsWith(qLower);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    return a.title.localeCompare(b.title);
  });

  return sendResponse(res, {
    message: 'Job titles fetched',
    data: sorted.map(r => r.title),
  });
});

export const jobTitleController = { searchJobTitles };
