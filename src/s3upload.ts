import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "node:fs";
import path, { dirname, join } from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config();


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const region = process.env.AWS_REGION;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const bucketName = process.env.S3_BUCKET_NAME;


if (!region || !accessKeyId || !secretAccessKey || !bucketName) {
  throw new Error(
    "Missing required AWS credentials"
  );
}

const s3Client = new S3Client({
  region: region,
  credentials: {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
  },
});

const s3Upload = async (s3Path:string,localPath:string) => {
  try {

    const fileStream = fs.createReadStream(localPath);
    
    fileStream.on("error", function (err) {
      console.log("File Error", err);
    });

    const uploadParams = {
      Bucket: bucketName,
      Key: s3Path,
      Body: fileStream,
    };

    const command = new PutObjectCommand(uploadParams);
    const data = await s3Client.send(command);

    console.log("Success! File uploaded:", data);

  } catch (err) {
    console.error("S3 Upload Error:", err);
  }
};

export default s3Upload;

