import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import dotenv from "dotenv";

dotenv.config();

const region = process.env.AWS_REGION;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const queueUrl = process.env.AWS_SQS_QUEUE_URL; 

export interface DeploymentMessage {
  id: string;
  repoUrl: string;
}

if (!region || !accessKeyId || !secretAccessKey || !queueUrl) {
  throw new Error(
    "Missing required AWS credentials or SQS Queue URL for SQS sender"
  );
}

const sqsClient = new SQSClient({
  region: region,
  credentials: {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
  },
});


export const sendSqsMessage = async (messageBody:DeploymentMessage) => {
  try {

    const messageBodyString = JSON.stringify(messageBody);

    const command = new SendMessageCommand({
      QueueUrl: queueUrl, 
      MessageBody: messageBodyString, 
    });

    const data = await sqsClient.send(command);
    console.log(`Success! Message sent to SQS. MessageID: ${data.MessageId}`);
    return data;

  } catch (err) {
    console.error("SQS Send Error:", err);
    throw err; 
  }
};