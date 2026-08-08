import { z } from "zod";

export const createJobSchema = z.object({
  groupId: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(["PART_TIME", "FULL_TIME", "CONTRACT"]),
  experienceLevel: z.enum(["ENTRY_LEVEL", "JUNIOR", "MID_LEVEL", "SENIOR"]),
  compensationType: z.enum(["MONTHLY", "ONE_OFF"]),
  salary: z.number().positive(),
  currency: z.string().optional().default("USD"),
  locationType: z.enum(["ON_SITE", "HYBRID", "REMOTE"]),
  location: z.string().optional(),
  industry: z.string().optional().default("General"),
  qualification: z.enum(["BSC", "PHD", "HND", "OND", "SSCE", "MSC"]),
  requirements: z.array(z.string()).optional().default([]),
  responsibilities: z.array(z.string()).optional().default([]),
  applicationType: z.enum(["EMAIL", "EXTERNAL", "CHAT"]),
  applicationLink: z.string().url().optional().or(z.literal('')).optional(),
  applicationEmail: z.string().email().optional().or(z.literal('')).optional(),
  isScraped: z.boolean().optional(),
  companyLogo: z.string().url().optional(),
  companyName: z.string().optional(),
});
