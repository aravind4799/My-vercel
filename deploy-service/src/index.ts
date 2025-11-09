import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message,
} from "@aws-sdk/client-sqs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { startBuildAndWait } from "./codeBuild.js";

// --- NEW: Import DynamoDB clients ---
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

dotenv.config();

export interface DeploymentMessage {
  id: string;
  repoUrl: string;
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. SQS Client Setup (Unchanged) ---
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

// --- NEW: DynamoDB Client Setup ---
const ddbClient = new DynamoDBClient({ region });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = "vercel-clone-status";

// --- NEW: Helper function to update DynamoDB status ---
const updateStatus = async (id: string, status: string, errorMsg?: string) => {
  console.log(`Updating status for ${id} to ${status}`);
  try {
    let updateExpression = "SET #status = :s, updatedAt = :t";
    let expressionAttributes: any = {
      ":s": status,
      ":t": new Date().toISOString(),
    };
    let attributeNames: any = {
      "#status": "status", // "status" is a reserved word in DynamoDB
    };

    if (errorMsg) {
      updateExpression += ", #error = :e";
      expressionAttributes[":e"] = errorMsg;
      attributeNames["#error"] = "error";
    }

    const command = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: id },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: attributeNames,
      ExpressionAttributeValues: expressionAttributes,
    });
    await ddbDocClient.send(command);
  } catch (err) {
    console.error(`Failed to update status for ${id}:`, err);
  }
};
// --- END NEW HELPER ---


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
          
          let body: DeploymentMessage | undefined; 

          try {
            if (!message.Body) {
              throw new Error("Received message with no Body.");
            }
            
            console.log("Raw Message Body:", message.Body);
            body = JSON.parse(message.Body) as DeploymentMessage;
            
            if (!body || !body.id) {
              throw new Error("Invalid message body or missing deployment ID.");
            }

            console.log("Parsed ID:", body.id);
            console.log("Parsed Repo:", body.repoUrl);

            
            // --- STEP 1: Update status to IN_PROGRESS ---
            await updateStatus(body.id, "IN_PROGRESS");

            // --- STEP 2: Trigger AWS CodeBuild ---
            console.log(`Triggering AWS CodeBuild project for ${body.id}...`);
            await startBuildAndWait(body.id);

            // --- STEP 3: Update status to DEPLOYED ---
            console.log(
              `CodeBuild finished successfully for ${body.id}.`
            );
            await updateStatus(body.id, "DEPLOYED");
            

          } catch (err: any) {
            console.error(`Build failed for ID ${body?.id}:`, err);
            
            // --- STEP 4: Update status to ERROR ---
            if (body?.id) {
              await updateStatus(body.id, "ERROR", (err as Error).message || "Unknown error");
            }
            // We 'continue' to skip the delete command
            // This allows the DLQ (Dead-Letter Queue) to catch it after a few retries
            continue; 
          }

          // --- 5. CRITICAL: Delete the Message (Only on success) ---
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
      console.error("Error in main polling loop:", err);
      // Wait 5 seconds before retrying the poll
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

startPolling();