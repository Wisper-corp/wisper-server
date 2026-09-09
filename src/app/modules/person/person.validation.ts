import { z } from "zod";
import { emailZod, passwordZod } from "../../validation/global.validation";

export const personSignupZod = z.object({
  password: passwordZod,
  person: z.object({
    email: emailZod,
    name: z.string({ message: "Name is required" }).min(2, "Name is too short"),
    phone: z.string().optional(),
    title: z
      .string({ message: "Title is required" })
      .min(4, "Title is too short"),
    // The profile whose shared link brought them. Optional, and checked
    // against a real person in the service before it is stored.
    referredById: z.string().uuid().optional(),
  }),
});

export type TPersonSignUp = z.infer<typeof personSignupZod>;

export const updatePersonProfileZod = z.object({
  name: z.string().min(2, "Name is too short").optional(),
  phone: z.string().optional(),
  title: z.string().min(2, "Title is too short").optional(),
  address: z.string().min(2, "Address is too short").optional(),
});

export type TUpdatePersonProfile = z.infer<typeof updatePersonProfileZod>;
