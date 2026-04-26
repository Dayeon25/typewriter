import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    allowEIO3: true
  });

  app.use(express.json());

  // In-memory room state storage
  const roomStates: Record<string, any> = {};
  const roomEvents: Record<string, any[]> = {};
  const MAX_EVENTS = 50;

  // REST API for Python helper to poll
  app.get("/api/events/:roomId", (req, res) => {
    const { roomId } = req.params;
    const since = parseInt(req.query.since as string) || 0;
    const events = (roomEvents[roomId] || []).filter(e => e.timestamp > since);
    res.json(events);
  });

  // REST API to post events (Fallback for web app)
  app.post("/api/events/:roomId", (req, res) => {
    const { roomId } = req.params;
    const event = req.body;
    
    const newEvent = {
      ...event,
      timestamp: Date.now(),
      seq: (roomEvents[roomId]?.length || 0)
    };
    
    if (!roomEvents[roomId]) roomEvents[roomId] = [];
    roomEvents[roomId].push(newEvent);
    if (roomEvents[roomId].length > MAX_EVENTS) roomEvents[roomId].shift();
    
    io.to(roomId).emit("remote-event", newEvent);
    res.json({ success: true, timestamp: newEvent.timestamp });
  });

  const PORT = 3000;

  // Error handling for httpServer
  httpServer.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`[SERVER] Port ${PORT} is already in use. Please wait a moment or restart again.`);
    } else {
      console.error("[SERVER] HTTP Server error:", e);
    }
  });

  // Socket.io logic
  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("join-room", (roomId) => {
      socket.join(roomId);
      console.log(`User ${socket.id} joined room ${roomId}`);
      
      // Send current state to joining user
      if (roomStates[roomId]) {
        socket.emit("room-sync", roomStates[roomId]);
      }
    });

    socket.on("update-room-state", ({ roomId, state }) => {
      roomStates[roomId] = { ...roomStates[roomId], ...state };
      socket.to(roomId).emit("room-sync", roomStates[roomId]);
    });

    socket.on("remote-event", ({ roomId, event }) => {
      const newEvent = {
        ...event,
        timestamp: Date.now(),
        seq: (roomEvents[roomId]?.length || 0)
      };
      
      if (!roomEvents[roomId]) roomEvents[roomId] = [];
      roomEvents[roomId].push(newEvent);
      if (roomEvents[roomId].length > MAX_EVENTS) roomEvents[roomId].shift();

      socket.to(roomId).emit("remote-event", newEvent);
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Started successfully on port ${PORT}`);
    console.log(`[SERVER] Listening on all interfaces (0.0.0.0)`);
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });
}

startServer().catch(err => {
  console.error("[SERVER] Failed to start:", err);
  process.exit(1);
});
