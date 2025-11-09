import {
    DynamoDBClient,
  } from "@aws-sdk/client-dynamodb";
  import {
    DynamoDBDocumentClient,
    UpdateCommand,
  } from "@aws-sdk/lib-dynamodb";
  import {
    ApiGatewayManagementApiClient,
    PostToConnectionCommand,
  } from "@aws-sdk/client-apigatewaymanagementapi";
  
  // --- Client Setup ---
  const { TABLE_NAME, API_GATEWAY_ENDPOINT } = process.env;
  
  if (!TABLE_NAME || !API_GATEWAY_ENDPOINT) {
    throw new Error("Missing TABLE_NAME or API_GATEWAY_ENDPOINT env variables");
  }
  
  const ddbClient = new DynamoDBClient({});
  const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
  
  // This client is used to send messages back to the user
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
      // A 'GoneException' means the user disconnected.
      // We can safely ignore this error.
      if (error.statusCode !== 410) {
        console.error("Error posting to connection:", error);
      }
    }
  };
  
  // --- Main Handler ---
  export const handler = async (event) => {
    const routeKey = event.requestContext.routeKey;
    const connectionId = event.requestContext.connectionId;
  
    console.log(`Received route: ${routeKey} for connection: ${connectionId}`);
  
    switch (routeKey) {
      // --- User Connects ---
      case "$connect":
        // This is where you could log a new connection, but we don't
        // know *which* deployment they're interested in yet.
        // We will wait for them to "register".
        console.log("Client connected:", connectionId);
        return { statusCode: 200, body: "Connected." };
  
      // --- User Disconnects ---
      case "$disconnect":
        // This is where you *could* go to DynamoDB and find any items
        // matching this connectionId and set them to null.
        // For simplicity, we'll just log it.
        console.log("Client disconnected:", connectionId);
        return { statusCode: 200, body: "Disconnected." };
  
      // --- User Registers for a Deployment ID ---
      case "register":
        try {
          const body = JSON.parse(event.body);
          const deploymentId = body.id;
  
          if (!deploymentId) {
            return { statusCode: 400, body: "Missing 'id' in register message." };
          }
  
          // --- This is the most important part ---
          // We "register" this connection by saving its ID to the
          // DynamoDB item for that specific deployment.
          const command = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: deploymentId },
            // We are adding the 'connectionId' attribute to the item.
            // This will *only* work if an item with this 'id' already exists
            // (which our upload-service created).
            UpdateExpression: "SET connectionId = :cid",
            ExpressionAttributeValues: {
              ":cid": connectionId,
            },
            // This ensures we don't create a new item by accident.
            ConditionExpression: "attribute_exists(id)", 
          });
  
          await ddbDocClient.send(command);
  
          console.log(`Registered connection ${connectionId} to ID ${deploymentId}`);
  
          // Send a confirmation back to the client
          await postToConnection(connectionId, {
            type: "SYSTEM",
            message: `Successfully registered for updates on ${deploymentId}`,
          });
  
          return { statusCode: 200, body: "Registered." };
        } catch (error) {
          console.error("Error during registration:", error);
          return { statusCode: 500, body: "Registration failed." };
        }
  
      // --- Default / Unknown Route ---
      default:
        console.log("Received unknown route:", routeKey);
        return { statusCode: 404, body: "Unknown route." };
    }
  };