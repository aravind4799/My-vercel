import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message, // Import the Message type
} from "@aws-sdk/client-sqs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { downloadS3Folder } from "./s3Downloader.js"; // Uses .js for Node.js ESM compatibility
import { runBuildInDocker } from "./dockerBuild.js";
dotenv.config();
export interface DeploymentMessage {
    id: string;
    repoUrl: string;
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. SQS Client Setup ---
const region = process.env.AWS_REGION as string;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID as string;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY as string;
const queueUrl = process.env.AWS_SQS_QUEUE_URL as string;

if (!region || !accessKeyId || !secretAccessKey || !queueUrl) {
  throw new Error(
    "Missing required AWS credentials or SQS Queue URL. Make sure .env file is correct."
  );
}

const sqsClient = new SQSClient({
  region: region,
  credentials: {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
  },
});

console.log("Deployment service started. Polling for messages...");

// --- 2. The Infinite Polling Loop ---
const startPolling = async () => {
  while (true) {
    try {
      // --- 3. Poll for Messages ---
      const receiveCommand = new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
      });

      const data = await sqsClient.send(receiveCommand);

      // --- 4. Process Messages (if any) ---
      if (data.Messages && data.Messages.length > 0) {
        for (const message of data.Messages as Message[]) {
          if (!message.ReceiptHandle) {
            console.error(
              "Received message with no ReceiptHandle. Cannot delete.",
              message
            );
            continue;
          }

          console.log("--- NEW MESSAGE RECEIVED ---");

          if (message.Body) {
            console.log("Raw Message Body:", message.Body);

            try {
              // Type assertion: We expect the body to be our defined message
              const body = JSON.parse(message.Body) as DeploymentMessage;
              console.log("Parsed ID:", body.id);
              console.log("Parsed Repo:", body.repoUrl);

              // --- START: DOWNLOAD LOGIC ---
              const s3Prefix = `repos/${body.id}/`;
              const localOutputPath = path.join(
                __dirname,
                "output",
                body.id
              );

              console.log(
                `Downloading files from S3 to: ${localOutputPath}`
              );

              await downloadS3Folder(s3Prefix, localOutputPath);
              await runBuildInDocker(localOutputPath);

              console.log(
                `All files for deployment ${body.id} downloaded.`
              );
              // --- END: DOWNLOAD LOGIC ---
            } catch (parseError) {
              console.error("Error parsing message body:", parseError);
            }
          } else {
            console.log("Received message with no Body.");
          }

          // --- 5. CRITICAL: Delete the Message ---
          const deleteCommand = new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle,
          });

          await sqsClient.send(deleteCommand);

          console.log("Message processed and deleted.");
          console.log("----------------------------");
        }
      } else {
        console.log("No new messages. Re-polling...");
      }
    } catch (err) {
      console.error("Error in polling loop:", err);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

startPolling();