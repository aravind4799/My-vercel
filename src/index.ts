import express from "express";
import cors from 'cors';
import { simpleGit } from 'simple-git';
import { generateRandomString } from "./utils.js";
import path from "path";
import { getAllFiles } from "./fileupload.js";
import { fileURLToPath } from 'url';
import s3Upload from "./s3upload.js";
import { sendSqsMessage } from "./sqsSender.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// create an http server
const app = express();
app.use(cors());
app.use(express.json());


app.post("/deploy", async (req, res) => {
  try {
    const repoUrl = req.body.repoUrl; 
    const id = generateRandomString();
    const repoPath = path.join(__dirname, 'repos', id);
    
    await simpleGit().clone(repoUrl, repoPath);
    const files =  getAllFiles(repoPath);
    
    console.log('Files:', files);    
    console.log('Repository URL:', repoUrl);

    const uploadFiles = files.map((file) => {
      return s3Upload(file.slice(__dirname.length + 1),file);
    });

    await Promise.allSettled(uploadFiles);
    
    // Send message to SQS to notify worker
    console.log(`Queueing deployment ID for worker: ${id}`);
    await sendSqsMessage({ 
      id: id,
      repoUrl: repoUrl 
    });
 
    res.json({
      message: `Deployment ${id} successfully queued!`,
      id: id,
    });


  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to deploy repository' });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});