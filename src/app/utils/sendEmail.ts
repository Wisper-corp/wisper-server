import fs from "fs";
import { Resend } from "resend";
import ApiError from "../middlewares/classes/ApiError";

const resend = new Resend(process.env.RESEND_API_KEY);

type Replacements = Record<string, string | number>;

export const sendEmail = async (
  to: string,
  subject: string,
  templatePath: string,
  replacements: Replacements
) => {
  const year = new Date().getFullYear().toString();

  // Read and send inline rather than in a callback. The callback version
  // returned before Resend had been called, so a rejected send -- a bad key,
  // a blocked address, a rate limit -- was thrown away inside a promise
  // nobody held. Signup still answered "we sent a code" and no email existed.
  let data: string;
  try {
    data = await fs.promises.readFile(templatePath, "utf8");
  } catch (err: any) {
    throw new ApiError(500, err?.message || "Could not read the email template");
  }

  {

    // Replace all placeholders
    let emailContent = data;
    for (const [key, value] of Object.entries(replacements)) {
      emailContent = emailContent.replace(`{{${key}}}`, value?.toString());
    }
    emailContent = emailContent.replace("{{year}}", year);

    const { error } = await resend.emails.send({
      from: "Wisper <support@wisperonline.com>",
      to,
      subject,
      html: emailContent,
    });

    // Logged loudly and re-thrown: a code that was never sent must not look
    // like one that was, or the person waits for an email that is not coming
    // and nobody can tell them why.
    if (error) {
      console.error("[email] Resend refused the message:", to, subject, error);
      throw new ApiError(502, "We could not send that email. Please try again.");
    }
  }
};
