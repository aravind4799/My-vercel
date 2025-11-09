import express from "express";
import cors from 'cors';
import { simpleGit } from 'simple-git';
import { generateRandomString } from "./utils.js";
import path from "path";
import { getAllFiles } from "./fileupload.js";
import { fileURLToPath } from 'url';
import s3Upload from "./s3upload.js";
import { sendSqsMessage } from "./sqsSender.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const region = process.env.AWS_REGION as string;
if (!region) {
  throw new Error("Missing AWS_REGION environment variable");
}
const ddbClient = new DynamoDBClient({ region });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
// dynamodb table name
const TABLE_NAME = "vercel-clone-status"; 

app.post("/deploy", async (req, res) => {
  let deploymentId = ""; 

  try {
    const repoUrl = req.body.repoUrl; 
    

    const id = generateRandomString().toLowerCase();
    deploymentId = id; 
    
    // Create the initial 'PENDING' status in DynamoDB
    console.log(`Creating initial status 'PENDING' for id: ${id}`);
    const putCommand = new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        id: id,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      },
    });
    // We await this to ensure the item is created before we return the ID
    await ddbDocClient.send(putCommand);

    const repoPath = path.join(__dirname, 'repos', id);
    
    await simpleGit().clone(repoUrl, repoPath);
    const files =  getAllFiles(repoPath);
    
    console.log('Files:', files);     
    console.log('Repository URL:', repoUrl);

    const uploadFiles = files.map((file) => {
      // We must use the lowercase 'id' for the S3 path
      const s3Key = `repos/${id}/${file.substring(repoPath.length + 1)}`;
      return s3Upload(s3Key, file);
    });

    await Promise.allSettled(uploadFiles);
    
    // Send message to SQS to notify worker
    console.log(`Queueing deployment ID for worker: ${id}`);
    await sendSqsMessage({ 
      id: id,
      repoUrl: repoUrl 
    });
  
    // We now return the ID *after* the item is created in DynamoDB.
    // The client will use this ID to register its WebSocket.
    res.json({
      message: `Deployment ${id} successfully queued!`,
      id: id,
    });


  } catch (error) {
    console.error('Error:', error);

    // If the deployment fails at any step, update DynamoDB to 'ERROR'
    if (deploymentId) {
      try {
        const updateCommand = new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            id: deploymentId,
            status: "ERROR",
            error: (error as Error).message || "Upload service failure",
            updatedAt: new Date().toISOString(),
          },
        });
        await ddbDocClient.send(updateCommand);
      } catch (dbError) {
        console.error("Failed to update status to ERROR in DynamoDB:", dbError);
      }
    }
    res.status(500).json({ error: 'Failed to deploy repository' });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});