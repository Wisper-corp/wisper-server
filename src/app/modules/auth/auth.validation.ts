import z from "zod";
import { emailZod, passwordZod } from "../../validation/global.validation";
import { UserStatus } from "@prisma/client";

export const loginZodSchema = z.object({
  email: emailZod,
  password: passwordZod,
  fcmToken: z.string().optional(),
  voipToken: z.string().optional(),
  deviceType: z.enum(["android", "ios"]).optional(),
  isMobileApp: z.boolean().default(false),
});

export type TLoginInput = z.infer<typeof loginZodSchema>;

export const googleLoginSchema = z.object({
  email: emailZod,
  name: z.string(),
  image: z.string(),
  fcmToken: z.string().optional(),
  voipToken: z.string().optional(),
  deviceType: z.enum(["android", "ios"]).optional(),
  role: z.enum(["PERSON", "BUSINESS"]),
});

export type TGoogleLoginInput = z.infer<typeof googleLoginSchema>;

export const resetPasswordZod = z.object({
  email: emailZod,
  password: passwordZod,
});

export type TResetPasswordInput = z.infer<typeof resetPasswordZod>;

export const changePasswordZod = z.object({
  oldPassword: passwordZod,
  newPassword: passwordZod,
});

export type TChangePasswordInput = z.infer<typeof changePasswordZod>;

export const changeAccountStatusZod = z.object({
  status: z
    .enum([UserStatus.ACTIVE, UserStatus.DELETED, UserStatus.BLOCKED])
    .default("ACTIVE")
    .transform(val => val.toUpperCase()),
});

export const updateDeviceTokenZod = z
  .object({
    fcmToken: z.string().optional(),
    voipToken: z.string().optional(),
    deviceType: z.enum(["android", "ios"]).optional(),
  })
  .refine(
    payload =>
      payload.fcmToken !== undefined ||
      payload.voipToken !== undefined ||
      payload.deviceType !== undefined,
    {
      message: "At least one device token field is required",
    }
  );

export type TUpdateDeviceTokenInput = z.infer<typeof updateDeviceTokenZod>;
