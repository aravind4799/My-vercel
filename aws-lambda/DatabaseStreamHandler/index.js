import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { unmarshall } from "@aws-sdk/util-dynamodb";

// --- Client Setup ---
const { API_GATEWAY_ENDPOINT } = process.env;

if (!API_GATEWAY_ENDPOINT) {
  throw new Error("Missing API_GATEWAY_ENDPOINT env variable");
}

const apiGatewayClient = new ApiGatewayManagementApiClient({
  endpoint: API_GATEWAY_ENDPOINT,
});

// Helper function to post messages back to a specific connection
const postToConnection = async (connectionId, data) => {
  try {
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(data),
    });
    await apiGatewayClient.send(command);
  } catch (error) {
    if (error.statusCode !== 410) {
      console.error("Error posting to connection:", error);
    }
  }
};


export const handler = async (event) => {
  console.log("DynamoDB Stream event received:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    // We only care about MODIFY events (e.g., status updates)
    if (record.eventName === "MODIFY") {
      try {
        const newImage = record.dynamodb.NewImage;
        if (!newImage) {
          continue;
        }

        // Convert from DynamoDB's format to a normal JSON object
        const deployment = unmarshall(newImage);

        // --- Check if a Client is Registered ---
        if (deployment.connectionId) {
          console.log(
            `Change detected for ${deployment.id}, sending status '${deployment.status}' to ${deployment.connectionId}`
          );

          // --- Send the Update ---
          await postToConnection(deployment.connectionId, {
            type: "STATUS_UPDATE",
            id: deployment.id,
            status: deployment.status,
            error: deployment.error || null,
          });
        } else {
          console.log(
            `Change detected for ${deployment.id}, but no client is registered.`
          );
        }
      } catch (error) {
        console.error("Error processing stream record:", error);
      }
    }
  }
};