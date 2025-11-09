import React, { useState, useEffect, useCallback } from 'react';
import { Github, Send, Loader2, Server, Globe, PackageCheck, PackageX, Info, Zap } from 'lucide-react';

// --- CONFIGURATION ---
// These are loaded from your .env file (must be prefixed with VITE_)
const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT; 
const WEBSOCKET_URL = import.meta.env.VITE_WEBSOCKET_URL; 
const SITE_BASE_URL = import.meta.env.VITE_SITE_BASE_URL;

// --- STATUS INDICATOR COMPONENT ---
const StatusIndicator = ({ status }) => {
  const statusConfig = {
    IDLE: { text: "Ready to deploy", icon: <Send className="w-5 h-5" />, color: "text-gray-400" },
    UPLOADING: { text: "Uploading repository...", icon: <Loader2 className="w-5 h-5 animate-spin" />, color: "text-blue-400" },
    PENDING: { text: "Waiting in queue...", icon: <Loader2 className="w-5 h-5 animate-spin" />, color: "text-yellow-400" },
    IN_PROGRESS: { text: "Build in progress...", icon: <Loader2 className="w-5 h-5 animate-spin" />, color: "text-blue-400" },
    DEPLOYED: { text: "Deployment successful!", icon: <PackageCheck className="w-5 h-5" />, color: "text-green-400" },
    ERROR: { text: "Build failed", icon: <PackageX className="w-5 h-5" />, color: "text-red-400" },
  };

  const config = statusConfig[status] || statusConfig.IDLE;

  return (
    <div className="p-6 bg-gray-800/50 rounded-lg border border-gray-700">
      <div className={`flex items-center gap-3 ${config.color}`}>
        {config.icon}
        <span className="text-xl font-semibold">{config.text}</span>
      </div>
    </div>
  );
};

// --- LOG CONSOLE COMPONENT ---
const LogConsole = ({ logs }) => {
  const logContainerRef = React.useRef(null);

  // Auto-scroll to the bottom when new logs arrive
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="w-full bg-black rounded-lg border border-gray-700 h-64 overflow-y-scroll font-mono text-sm" ref={logContainerRef}>
      <div className="p-4">
        {logs.map((log, index) => (
          <p key={index} className={`py-1 border-b border-gray-800 ${log.type === 'ERROR' ? 'text-red-400' : 'text-gray-300'}`}>
            <span className="mr-2 text-gray-500">{new Date().toLocaleTimeString()}</span>
            &gt; {log.message}
          </p>
        ))}
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---
function App() {
  const [repoUrl, setRepoUrl] = useState("http://github.com/aravind4799/Covid_tracker");
  const [status, setStatus] = useState("IDLE");
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null); 
  // const [deploymentId, setDeploymentId] = useState(null); // --- REMOVED: This was unused ---

  // A stable, memoized 'addLog' function
  const addLog = useCallback((message, type = 'INFO') => {
    setLogs((prevLogs) => [...prevLogs, { message, type }]);
  }, []);

  // Memoized WebSocket setup function
  const setupWebSocket = useCallback((id) => {
    addLog(`Connecting to WebSocket...`);
    const ws = new WebSocket(WEBSOCKET_URL);

    ws.onopen = () => {
      addLog("WebSocket Connected. Registering for updates...");
      ws.send(JSON.stringify({ action: "register", id: id }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      addLog(`Received message: ${JSON.stringify(data)}`);

      if (data.type === "SYSTEM") {
        addLog(`[System] ${data.message}`);
      }

      if (data.type === "STATUS_UPDATE") {
        setStatus(data.status);

        if (data.status === "ERROR") {
          const errorMsg = data.error || 'Unknown build error. Check CodeBuild logs.';
          addLog(`Build failed: ${errorMsg}`, 'ERROR');
          setResult({ type: 'error', message: errorMsg });
          ws.close();
        }

        if (data.status === "DEPLOYED") {
          addLog("Deployment successful!");
          // Use the *original* ID for the URL, not the one from the event
          const finalUrl = `http://${id}.${SITE_BASE_URL.replace(/^https?:\/\//, '')}`;
          setResult({ type: 'success', url: finalUrl, id: id });
          ws.close();
        }
      }
    };

    ws.onclose = () => addLog("WebSocket Disconnected.");
    ws.onerror = (error) => {
      const errorMsg = "WebSocket connection failed. Check URL or network.";
      addLog(errorMsg, 'ERROR');
      console.error("WebSocket Error:", error);
      setStatus("ERROR");
      setResult({ type: 'error', message: errorMsg });
    };

    // We don't save 'ws' to state to avoid re-renders
    // We'll return a 'cleanup' function
    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [addLog, SITE_BASE_URL]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLogs([]);
    setResult(null);
    setStatus("UPLOADING");
    // setDeploymentId(null); // --- REMOVED ---
    addLog("Submitting repository URL to upload service...");

    try {
      const response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to start deployment");
      }

      addLog(`Deployment ID received: ${data.id}`);
      // setDeploymentId(data.id); // --- REMOVED ---
      setStatus("PENDING");
      
      // Start listening for WebSocket updates
      setupWebSocket(data.id);

    } catch (error) {
      const errorMsg = error.message || 'Unknown server error';
      addLog(`Error: ${errorMsg}`, 'ERROR');
      setResult({ type: 'error', message: errorMsg });
      setStatus("ERROR");
    }
  };

  const isLoading = ['UPLOADING', 'PENDING', 'IN_PROGRESS'].includes(status);

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center p-4 sm:p-8">
      <div className="w-full max-w-3xl">
        
        {/* --- Header --- */}
        <header className="flex items-center gap-3 mb-6">
          <Zap className="w-8 h-8 text-blue-400" />
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-blue-600 text-transparent bg-clip-text">
            Reactor Deployment
          </h1>
        </header>

        {/* --- Main Card --- */}
        <div className="bg-gray-800 rounded-lg shadow-2xl overflow-hidden border border-gray-700">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-2">Deploy a new React project</h2>
            
            {/* --- Info Box --- */}
            <div className="p-4 mb-4 bg-gray-900/50 rounded-lg border border-gray-700 flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold text-blue-300">React Projects Only</h3>
                <p className="text-sm text-gray-300">
                  This build pipeline is configured for React apps. Please ensure your project's `package.json` contains a `build` script (e.g., `"build": "react-scripts build"`).
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4">
              <div className="flex-grow flex items-center bg-gray-700 rounded-md px-3">
                <Github className="w-5 h-5 text-gray-400 mr-3" />
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="Paste your React Git repository URL here"
                  className="w-full bg-transparent p-3 text-white placeholder-gray-400 focus:outline-none"
                  disabled={isLoading}
                />
              </div>
              <button 
                type="submit" 
                className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-md transition-all duration-200 disabled:bg-gray-500 disabled:cursor-not-allowed" 
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="animate-spin" /> : <Send />}
                {isLoading ? 'Deploying...' : 'Deploy'}
              </button>
            </form>
          </div>
        </div>

        {/* --- Status & Results Section --- */}
        <div className="mt-8 flex flex-col gap-6">
          <StatusIndicator status={status} />

          {/* --- Success Panel --- */}
          {result?.type === 'success' && (
            <div className="p-6 bg-green-900/50 rounded-lg border border-green-700 flex items-center gap-4">
              <CheckCircle className="w-8 h-8 text-green-400 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-green-300">Reactor Deployment Complete!</h3>
                <p className="text-green-200">Your site is live at:</p>
                <a 
                  href={result.url} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-white font-mono bg-black/50 px-2 py-1 rounded hover:underline break-all"
                >
                  {result.url} <Globe className="w-4 h-4 inline-block ml-1" />
                </a>
              </div>
            </div>
          )}

          {/* --- Error Panel --- */}
          {result?.type === 'error' && (
            <div className="p-6 bg-red-900/50 rounded-lg border border-red-700 flex items-center gap-4">
              <XCircle className="w-8 h-8 text-red-400 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-red-300">Reactor Deployment Failed</h3>
                <p className="text-red-200 font-mono bg-black/50 px-2 py-1 rounded">{result.message}</p>
              </div>
            </div>
          )}
          
          {/* --- Log Console --- */}
          {logs.length > 0 && (
            <LogConsole logs={logs} />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;