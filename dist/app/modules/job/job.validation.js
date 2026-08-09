"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJobSchema = void 0;
const zod_1 = require("zod");
exports.createJobSchema = zod_1.z.object({
    groupId: zod_1.z.string().uuid().optional(),
    title: zod_1.z.string().min(1),
    description: zod_1.z.string().min(1),
    type: zod_1.z.enum(["PART_TIME", "FULL_TIME", "CONTRACT"]),
    experienceLevel: zod_1.z.enum(["ENTRY_LEVEL", "JUNIOR", "MID_LEVEL", "SENIOR"]),
    compensationType: zod_1.z.enum(["MONTHLY", "ONE_OFF"]),
    salary: zod_1.z.number().positive(),
    currency: zod_1.z.string().optional().default("USD"),
    locationType: zod_1.z.enum(["ON_SITE", "HYBRID", "REMOTE"]),
    location: zod_1.z.string().optional(),
    industry: zod_1.z.string().optional().default("General"),
    qualification: zod_1.z.enum(["BSC", "PHD", "HND", "OND", "SSCE", "MSC"]),
    requirements: zod_1.z.array(zod_1.z.string()).optional().default([]),
    responsibilities: zod_1.z.array(zod_1.z.string()).optional().default([]),
    applicationType: zod_1.z.enum(["EMAIL", "EXTERNAL", "CHAT"]),
    applicationLink: zod_1.z.string().url().optional().or(zod_1.z.literal('')).optional(),
    applicationEmail: zod_1.z.string().email().optional().or(zod_1.z.literal('')).optional(),
    isScraped: zod_1.z.boolean().optional(),
    companyLogo: zod_1.z.string().url().optional(),
    companyName: zod_1.z.string().optional(),
});
//# sourceMappingURL=job.validation.js.map