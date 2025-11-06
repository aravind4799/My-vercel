import util from "util";
import { exec } from "child_process";
import path from "path"; // Keep path, it's good practice

// 1. Create a "promisified" version of exec
// This lets us use 'await' with child_process.exec
const execAsync = util.promisify(exec);


export const runBuildInDocker = async (localCodePath: string) => {
  // We use node:20 as a base image. You can change this.
  // --rm = Automatically remove the container when it exits.
  // -v = Mounts your localCodePath to /app inside the container.
  //      Note: path.resolve() in your test script will be
  //      crucial to ensure this is an absolute path.
  // -w = Sets the working directory inside the container to /app.
  // The rest is the command to run.
  const dockerCommand = [
    "docker run --rm",
    `-v "${localCodePath}":/app`,
    "-w /app",
    "node:16", 
    "sh -c 'npm install --no-fund --no-audit && npm run build'", 
  ].join(" ");

  console.log(`Executing Docker command: ${dockerCommand}`);

  try {
    // This command will run and wait for it to complete
    const { stdout, stderr } = await execAsync(dockerCommand);

    console.log("--- Docker Build STDOUT ---");
    console.log(stdout);
    if (stderr) {
      console.error("--- Docker Build STDERR ---");
      console.error(stderr);
    }
    console.log("--- Docker Build Complete ---");
  } catch (err) {
    console.error("Failed to run Docker build:", err);
    throw err; 
  }
};