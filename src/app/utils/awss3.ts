import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";
import config from "../config";
import multer, { memoryStorage } from "multer";
import { TFile } from "../interface/file.interface";
import ApiError from "../middlewares/classes/ApiError";

export const s3Client = new S3Client({
  // endpoint: config.aws.endpoint as string,
  region: `${config.aws.region}`,
  credentials: {
    accessKeyId: `${config.aws.accessKeyId}`,
    secretAccessKey: `${config.aws.secretAccessKey}`,
  },
});

/// The largest file the API will take, in bytes.
///
/// Files are held in memory while they are forwarded to S3 and the box has
/// under 2 GB of it, so this is a real ceiling rather than a formality. Set
/// below nginx's own limit so an oversized upload is refused here, with a
/// sentence someone can read, rather than by nginx with an HTML error page.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const upload = multer({
  storage: memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

//upload a single file
export const uploadToS3 = async (file: TFile): Promise<string> => {
  const fileName = `wisper/${Date.now()}-${file.originalname}`;

  const command = new PutObjectCommand({
    Bucket: config.aws.bucket,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
  });

  try {
    const key = await s3Client.send(command);
    if (!key) {
      throw new ApiError(400, "File Upload failed");
    }
    const url = `${config?.aws?.s3BaseUrl}${fileName}`;
    if (!url) throw new ApiError(400, "File Upload failed");

    return url;
  } catch (error) {
    console.log(error);
    throw new ApiError(400, "File Upload failed");
  }
};

// // delete file from s3 bucket
export const deleteFromS3 = async (url: string) => {
  const key = decodeURIComponent(
    url.split(config.aws.s3BaseUrl as string)[1] as string
  );

  try {
    const command = new DeleteObjectCommand({
      Bucket: config.aws.bucket,
      Key: key,
    });
    await s3Client.send(command);
  } catch (error) {
    console.log("🚀 ~ deleteFromS3 ~ error:", error);
  }
};
