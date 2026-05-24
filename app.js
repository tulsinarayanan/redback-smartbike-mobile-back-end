import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import userRoutes from './routes/userRoutes.js';
import leaderboardRoutes from './routes/leaderboardRoutes.js';
import friendsRoutes from './routes/friendsRoutes.js';
import notificationsRoutes from './routes/notificationsRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import iotRoutes from './routes/iotRoutes.js';
import { startMqttService } from './services/mqttService.js';

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/users', userRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/iot', iotRoutes);

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

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startMqttService();
});
