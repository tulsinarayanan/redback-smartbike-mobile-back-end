import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import userRoutes from './routes/userRoutes.js';
import leaderboardRoutes from './routes/leaderboardRoutes.js';
import friendsRoutes from './routes/friendsRoutes.js';
import notificationsRoutes from './routes/notificationsRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import iotRoutes from './routes/iotRoutes.js';
import progressionRoutes from './routes/progressionRoutes.js';
import rideRoutes from './routes/rideRoutes.js';
import mlRoutes from './routes/mlRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import ridesRoutes from './routes/ridesRoutes.js';
import { startMqttService } from './services/mqttService.js';
import { initTelemetrySocket } from './sockets/telemetrySocket.js';
import { flushAllSync } from './services/telemetryBuffer.js';

dotenv.config();

const PORT = process.env.PORT || 5001;

const app = express();

// Middleware - CORS must be before any route mounting for mobile/web access
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// Routes
app.use('/api/users', userRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/iot', iotRoutes);
app.use('/api/progression', progressionRoutes);
app.use('/api/rides', ridesRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/workouts', rideRoutes);
app.use('/api/ml', mlRoutes);
app.use('/api/ai', aiRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', port: PORT }));
// app.use('/api/dashboard', dashboardRoutes);

app.use('/api', (req, res) => {
  return res.status(404).json({ message: 'API route not found' });
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ message: 'Invalid JSON body' });
  }

  console.error('Unhandled API error:', err);
  return res.status(500).json({ message: 'Internal server error' });
});

// HTTP server + Socket.io binding (same port)
const httpServer = http.createServer(app);
const io = initTelemetrySocket(httpServer);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  startMqttService();
});

// Graceful shutdown — flush telemetry buffers before exit
const gracefulShutdown = async (signal) => {
  console.log(`[app] ${signal} received — shutting down...`);
  try {
    await flushAllSync();
  } catch (e) {
    console.error('[app] flushAllSync failed on shutdown:', e.message || e);
  }
  httpServer.close(() => {
    console.log('[app] HTTP server closed');
    process.exit(0);
  });
  // Force exit if close hangs
  setTimeout(() => process.exit(0), 5000).unref();
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export { app, httpServer, io };
export default app;


