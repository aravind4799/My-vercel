import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable } from "stream"; 

dotenv.config();

// --- 1. S3 Client Setup ---
const region = process.env.AWS_REGION as string;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID as string;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY as string;
const bucketName = process.env.S3_BUCKET_NAME as string;

if (!region || !accessKeyId || !secretAccessKey || !bucketName) {
  throw new Error("Missing required AWS credentials for S3");
}

const s3Client = new S3Client({
  region: region,
  credentials: {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
  },
});

/**
 * Downloads a file from S3 and saves it to a local path.
 */
const downloadFile = async (s3Key: string, localFilePath: string) => {
  console.log(`Downloading: ${s3Key} to ${localFilePath}`);
  try {
    const dirName = path.dirname(localFilePath);
    await fsp.mkdir(dirName, { recursive: true });

    const getObjectParams = {
      Bucket: bucketName,
      Key: s3Key,
    };
    const command = new GetObjectCommand(getObjectParams);
    const data = await s3Client.send(command);

    if (data.Body && data.Body instanceof Readable) {
      const fileStream = fs.createWriteStream(localFilePath);
      return new Promise<void>((resolve, reject) => {
        (data.Body as Readable).on("error", reject);
        fileStream.on("error", reject);
        fileStream.on("finish", () => resolve());
        (data.Body as Readable).pipe(fileStream);
      });
    } else {
      throw new Error(`No body in S3 response for ${s3Key}`);
    }
  } catch (err) {
    console.error(`Error downloading file ${s3Key}:`, err);
    throw err;
  }
};

/**
 * Downloads all files from a specified S3 "folder" (prefix) to a local directory.
 */
export const downloadS3Folder = async (s3Prefix: string, localDest: string) => {
  console.log(`Starting download from S3 prefix: ${s3Prefix}`);
  try {
    const listParams = {
      Bucket: bucketName,
      Prefix: s3Prefix,
    };
    const command = new ListObjectsV2Command(listParams);
    const listData = await s3Client.send(command);

    if (!listData.Contents || listData.Contents.length === 0) {
      console.log("No files found at prefix:", s3Prefix);
      return;
    }

    console.log(`Found ${listData.Contents.length} files to download.`);

    const downloadPromises: Promise<unknown>[] = [];

    for (const s3Object of listData.Contents) {
      if (s3Object.Key) {
        const relativePath = s3Object.Key.substring(s3Prefix.length);

        if (!relativePath) {
          continue;
        }

        const localFilePath = path.join(localDest, relativePath);
        downloadPromises.push(downloadFile(s3Object.Key, localFilePath));
      }
    }

    await Promise.all(downloadPromises);

    console.log(
      `--- Successfully downloaded all files to ${localDest} ---`
    );
  } catch (err) {
    console.error(`Error in downloadS3Folder:`, err);
    throw err;
  }
};