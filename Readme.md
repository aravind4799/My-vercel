# Reactor Deployment Engine

> An end-to-end, serverless CI/CD pipeline on AWS using SQS, S3, Lambda, DynamoDB, API Gateway and CodeBuild for secure, automated deployments.

This project is a fully-functional, deployment platform. It can take any public React Git repository, build the project in a secure cloud environment, and serve the final static site on a unique, project-specific subdomain.

It's built as a decoupled, event-driven system of microservices, orchestrated entirely on AWS.


[![Project Demo](./docs/front_end.png)](./docs/reactor-deployer.mp4")

## Table of Contents

1.  [Architecture & End-to-End Flow](#1-architecture--end-to-end-flow)
    * [1.1. Step 1: The Upload & Status Creation](#11-step-1-the-upload--status-creation)
    * [1.2. Step 2: The Real-time Handshake](#12-step-2-the-real-time-handshake)
    * [1.3. Step 3: The Build (The Serverless Worker)](#13-step-3-the-build-the-serverless-worker)
    * [1.4. Step 4: The "Magic" (Real-time Updates)](#14-step-4-the-magic-real-time-updates)
    * [1.5. Step 5: Serving the Live Site](#15-step-5-serving-the-live-site)
2.  [Key Architectural Decisions](#2-key-architectural-decisions)
3.  [Setup & How to Run](#3-setup--how-to-run)
4.  [Proof of Work (Local Testing)](#4-proof-of-work-local-testing)
5.  [Project Write-up & Challenges](#5-project-write-up--challenges)
6.  [Future Improvements](#6-future-improvements)

---

## 1. Architecture & End-to-End Flow

Here is a high-level diagram of the entire system architecture, showing all services and the flow of data.

![Reactor Architecture Diagram](./docs/System_Design.png)

## Core Features

* **End-to-End Deployment:** Automates the entire CI/CD pipeline from a Git URL to a live, public-facing website.
* **Secure & Isolated Builds:** Uses **AWS CodeBuild** to run `npm install` and `npm run build` in an ephemeral, sandboxed container, eliminating the risk of Remote Code Execution (RCE) on the host.
* **Resilient Queueing:** Leverages **AWS SQS** with a **Dead-Letter Queue (DLQ)** to manage build jobs, ensuring a single "poison pill" (failing build) cannot block the entire deployment pipeline.
* **Real-time Status Updates:** Provides instant, push-based feedback to the client (e.g., `PENDING`, `IN_PROGRESS`, `DEPLOYED`) using a serverless **WebSocket API (API Gateway)** triggered by **DynamoDB Streams**.
* **Dynamic Subdomain Routing:** A custom Node.js/Express reverse-proxy (`request-handler`) serves the correct site by parsing the `id` from the request's subdomain (e.g., `abc123xyz.my-site.com`).

---

## Tech Stack & Architecture

This project is a hybrid architecture, using Node.js microservices to orchestrate a serverless AWS backend.

| Category | Service | Purpose |
| :--- | :--- | :--- |
| **Frontend** | **React (Vite)** | Client UI for submitting deployment requests and viewing real-time status. |
| **API** | **Node.js + Express** | `upload-service`: A public-facing API to handle initial deploy requests. |
| **Queue** | **AWS SQS** | A message queue to decouple the API from the build worker. |
| | **SQS Dead-Letter Queue** | A "graveyard" queue to automatically isolate failing "poison pill" messages. |
| **Worker** | **Node.js (Poller)** | `deployment-service`: A worker that polls SQS and orchestrates the build. |
| **Build** | **AWS CodeBuild** | A secure, serverless service that runs the `npm install` & `npm run build` in an isolated container. |
| **Storage** | **AWS S3** | Stores both the initial source code (`/repos`) and the final build artifacts (`/builds`). |
| **Database** | **AWS DynamoDB** | The "source of truth" for real-time status (`PENDING`, `IN_PROGRESS`, `DEPLOYED`, `ERROR`). |
| **Real-time** | **API Gateway (WebSocket)** | Manages persistent WebSocket connections with thousands of clients. |
| | **AWS Lambda** | "Glue" logic. One Lambda handles WebSocket connections (`$connect`, `register`), and another is triggered by DynamoDB Streams to push status updates. |
| **Serving** | **Node.js + Express** | `request-handler`: A reverse-proxy that serves the correct static site from S3 based on the subdomain. |

---

## 1. Architecture & End-to-End Flow

This is the complete lifecycle of a single deployment.

### 1.1. Step 1: The Upload & Status Creation

1.  **React Client** sends a `POST /deploy` request to the **`upload-service`**.
2.  `upload-service` generates a unique, lowercase `id` (e.g., `abc123xyz`).
3.  **Status Update:** It immediately writes the initial status to the **DynamoDB** table: `{ id: "abc123xyz", status: "PENDING" }`.
4.  **Source Upload:** The service clones the repo and uploads the source code to **S3** at `s3://.../repos/abc123xyz/`.
5.  **Queue Job:** It sends a message to the **SQS** queue: `{ "id": "abc123xyz" }`.
6.  `upload-service` returns the new `id` to the React client.

### 1.2. Step 2: The Real-time Handshake

1.  **React Client** receives the `id` and immediately opens a WebSocket connection to the **API Gateway** URL.
2.  The client sends a "register" message: `{ "action": "register", "id": "abc123xyz" }`.
3.  This triggers the **`apiGatewaySocketHandler` Lambda**, which gets the client's unique `connectionId`.
4.  The Lambda **updates the DynamoDB item**, linking the client to the job: `{ id: "abc123xyz", status: "PENDING", connectionId: "conn-user-1" }`.

### 1.3. Step 3: The Build (The Serverless Worker)

1.  The **`deployment-service`** polls SQS and receives the message `{ "id": "abc123xyz" }`.
2.  **Status Update:** It immediately updates DynamoDB: `{ id: "abc123xyz", status: "IN_PROGRESS", ... }`.
3.  **Trigger Build:** It calls the **AWS CodeBuild** API to `startBuild()`, passing in the `id`.
4.  **CodeBuild Takes Over:**
    * **Source:** Downloads the source from `s3://.../repos/abc123xyz/`.
    * **Buildspec:** Runs the predefined commands (`npm config set python python3`, `npm install`, `npm run build`), with environment variables set (`NODE_OPTIONS=--openssl-legacy-provider`, `PUBLIC_URL=.`).
    * **Artifacts:** Uploads the *entire contents* of the `build/` folder to `s3://.../builds/abc123xyz/`.
5.  **Status Update:** When the build succeeds, the `deployment-service` updates DynamoDB: `{ id: "abc123xyz", status: "DEPLOYED", ... }`.
6.  The service deletes the message from the SQS queue.

### 1.4. Step 4: The "Magic" (Real-time Updates)

This happens in parallel with Step 3, automatically.

1.  When DynamoDB is updated to `IN_PROGRESS`, the **DynamoDB Stream** fires.
2.  This stream **triggers the `databaseStreamHandler` Lambda**.
3.  The Lambda reads the changed item, finds the `connectionId: "conn-user-1"`, and sends a `{ "status": "IN_PROGRESS" }` message to that specific client via the API Gateway.
4.  ...A few minutes later, when the status changes to `DEPLOYED`, the **stream fires again**, the Lambda runs again, and the client receives the final `{ "status": "DEPLOYED" }` message.

### 1.5. Step 5: Serving the Live Site

1.  The user clicks the final link from the React app: `http://abc123xyz.my-vercel-ara.com:5000`.
2.  The request hits the **`request-handler`** reverse-proxy.
3.  The server parses the `id` ("abc123xyz") from the hostname.
4.  It makes a `GetObject` call to S3 for the *exact* file (e.g., `s3://.../builds/abc123xyz/index.html`).
5.  It streams the file from S3 directly to the user's browser.

---

## 2. Key Architectural Decisions

This project's architecture was designed to solve several common real-world engineering problems.

| Problem | Chosen Solution | Why? |
| :--- | :--- | :--- |
| **Security** | **AWS CodeBuild** | Running `npm install` on a host server is a massive vulnerability. CodeBuild provides an ephemeral, sandboxed environment that is destroyed after each build, perfectly isolating any malicious code. |
| **Resilience** | **SQS + Dead-Letter Queue (DLQ)** | A single "poison pill" (failing build) can block an entire queue. A DLQ with a `maxReceiveCount` of 3 automatically isolates failing jobs, ensuring the pipeline never gets stuck. |
| **Real-time Status** | **DynamoDB Streams + Lambda + WebSocket API** | Polling is inefficient and slow. This event-driven-flow (`DB Update` -> `Stream` -> `Lambda` -> `WebSocket`) pushes status changes to the client in milliseconds with zero wasted resources. |
| **Routing** | **Lowercase ID + Subdomain Proxy** | Browser hostnames are case-insensitive. By forcing all deployment `id`s to lowercase, we guarantee the hostname (`abc.com`) will always match the S3 path (`/abc/`). The reverse-proxy handles the rest. |

---

## 3. Setup & How to Run

This project consists of 4 main parts that must all be running.

### 3.1. AWS Setup (One-Time)

1.  **S3:** Create a bucket (e.g., `firstbuckethell`).
2.  **SQS:** Create a main queue (`deployment-queue`) and a Dead-Letter Queue (`deployment-dlq`). Configure the main queue's "Redrive policy" to point to the DLQ after 3 receives.
3.  **DynamoDB:** Create a table (`react-clone-status`) with a partition key of `id` (String). Enable DynamoDB Streams ("New and old images").
4.  **CodeBuild:** Create a build project (`react-clone-builder`). Point its source and artifacts to your S3 bucket (placeholders are fine). Give it an IAM role with S3 and CloudWatch access.
5.  **Lambda:** Create two Lambda functions (`apiGatewaySocketHandler`, `databaseStreamHandler`) and upload the code.
    * Configure `apiGatewaySocketHandler`'s IAM role with DynamoDB write and API Gateway messaging permissions.
    * Configure `databaseStreamHandler`'s IAM role with API Gateway messaging permissions. Set its trigger to be the DynamoDB stream.
6.  **API Gateway:** Create a WebSocket API (`ReactCloneSocketApi`).
    * Route `$connect`, `$disconnect`, and `register` to your `apiGatewaySocketHandler` Lambda.
    * Deploy to a stage (e.g., `prod`) and copy the `wss://` URL.
7.  **Lambda (Final Step):** Go back to your two Lambda functions and paste the API Gateway's `https://` endpoint URL into their `API_GATEWAY_ENDPOINT` environment variables.

### 3.2. Local Setup (All Services)

1.  **Clone** this repository (which contains all services in separate folders).
2.  **Install** dependencies for all 4 projects:
    * `Client/`
    * `upload-service/`
    * `deployment-service/`
    * `request-handler/`
3.  **Create `.env` files** for all 4 projects and fill in the required AWS keys, SQS URLs, DynamoDB table name, and API Gateway URLs.
4.  **Edit your hosts file** (This is a *critical* step for local testing. See [Proof of Work](#4-proof-of-work-local-testing) below).

### 3.3. Running the System

You must have 4 separate terminals open.

1.  **Terminal 1 (Client):** `cd Client && npm run dev`
2.  **Terminal 2 (Upload API):** `cd upload-service && npm start`
3.  **Terminal 3 (Deploy Worker):** `cd deployment-service && npm start`
4.  **Terminal 4 (Request Handler):** `cd request-handler && npm start`

Open the client (`http://localhost:5173`), paste in a Git URL, and watch the entire pipeline run in real-time.

---

## 4. Proof of Work (Local Testing)

This section documents the end-to-end functionality, showing how a local test can prove the entire cloud architecture is working.

### 4.1. The `hosts` File "Trick"

The `request-handler` service is designed to serve sites on dynamic subdomains (e.g., `abc123xyz.my-vercel-ara.com`). To test this on a local machine, we must "trick" the browser into thinking our local server is that domain.

1.  **Open your `hosts` file** as an administrator.
    * **Windows:** `C:\Windows\System32\drivers\etc\hosts`
    * **Linux/macOS:** `/etc/hosts`
2.  **Add a new line** that points your test domain to your local machine:
    ```
    127.0.0.1   my-vercel-ara.com
    1.0.0.1   *.my-vercel-ara.com
    ```
    *(Note: You'll need to use a domain from your `.env` file and a specific deployed ID, e.g., `127.0.0.1 abc123xyz.my-vercel-ara.com`)*


---

## 5. Project Write-up & Challenges

I wrote a detailed article documenting the process, key challenges (like security, resilience, and real-time updates), and the architectural decisions I made while building this project.

* **Read the full story on Medium:** [How I Built a Serverless CI/CD Pipeline on AWS](https://medium.com/@araviku04/how-i-built-a-serverless-ci-cd-pipeline-on-aws-66f4e5a902c2)

---

## 6. Future Improvements

This architecture does the job, but as a next step, several parts could be upgraded to be fully serverless, more automated, and more cost-effective.

### 6.1. SQS Poller → SQS-Triggered Lambda

* **Problem:** The `deployment-service` is a Node.js server that runs 24/7 in a `while(true)` loop, just to poll an SQS queue. This wastes a server (e.g., an EC2 instance) and its associated costs, and it's a single point of failure.
* **Improvement:** Replace the entire `deployment-service` with a new **AWS Lambda** function. You can configure SQS to trigger this Lambda directly (an "Event Source Mapping") the instant a message arrives.
* **Benefit:** This is a truly serverless, event-driven architecture. It's far cheaper (you pay for ~1 second of Lambda compute vs. a 24/7 server), and it scales automatically. If 1,000 messages arrive, AWS will spin up 1,000 Lambda instances to process them in parallel.

### 6.2. Manual Deploy → GitHub Webhook (True Git-to-Global CI/CD)

* **Problem:** The pipeline currently starts when a user manually copies and pastes a Git URL into the React UI.
* **Improvement:** Implement a **GitHub (or GitLab) Webhook**. The user would install this webhook into their repository. When they `git push` to their `main` branch, GitHub automatically sends a `POST` request to our `upload-service`.
* **Benefit:** This creates a true, automated "Git-to-Global" CI/CD pipeline. The developer's only action is `git push`, and the rest of the deployment is completely automatic.

---

> ⭐ If you learned something new or found this project helpful, **star the repository**!