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

  fs.readFile(templatePath, "utf8", async (err, data) => {
    if (err) throw new ApiError(500, err.message || "Something went wrong");

    // Replace all placeholders
    let emailContent = data;
    for (const [key, value] of Object.entries(replacements)) {
      emailContent = emailContent.replace(`{{${key}}}`, value?.toString());
    }
    emailContent = emailContent.replace("{{year}}", year);

    await resend.emails.send({
      from: "Wisper <support@wisperonline.com>",
      to,
      subject,
      html: emailContent,
    });
  });
};
