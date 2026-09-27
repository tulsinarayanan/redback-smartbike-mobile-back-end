import { Server } from 'socket.io';
import { enqueue, flushRide } from '../services/telemetryBuffer.js';
import * as sessionMonitor from '../services/sessionMonitor.js';
import { triggerAnalyticsAsync } from '../services/analyticsService.js';

let ioInstance = null;

export const initTelemetrySocket = (httpServer) => {
  if (ioInstance) return ioInstance;

  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
    const joinedRides = new Set();

    socket.on('join:ride', (payload) => {
      const rideId = typeof payload === 'string' ? payload : payload?.ride_id || payload?.rideId;
      if (!rideId) {
        socket.emit('error', { message: 'ride_id is required for join:ride' });
        return;
      }
      const room = `ride:${rideId}`;
      socket.join(room);
      joinedRides.add(String(rideId));
      sessionMonitor.handleJoin(rideId, socket.id);
      socket.emit('joined:ride', { ride_id: String(rideId), room });
      // Notify others optionally
      // socket.to(room).emit('ride:peer-joined', { ride_id: String(rideId), socketId: socket.id });
    });

    socket.on('telemetry:send', (payload) => {
      const rideId = payload?.ride_id || payload?.rideId;
      if (!rideId) {
        socket.emit('error', { message: 'ride_id is required for telemetry:send' });
        return;
      }
      const room = `ride:${rideId}`;

      // Zero-latency broadcast to all clients in room (including sender for VR sync)
      io.to(room).emit('telemetry:update', payload);

      // High-throughput buffering — db write is async, non-blocking
      const result = enqueue(payload);
      if (!result.ok) {
        socket.emit('error', { message: result.message || 'Failed to buffer telemetry' });
      }
    });

    socket.on('ride:complete', async (payload) => {
      const rideId = typeof payload === 'string' ? payload : payload?.ride_id || payload?.rideId;
      if (!rideId) {
        socket.emit('error', { message: 'ride_id is required for ride:complete' });
        return;
      }
      const room = `ride:${rideId}`;
      try {
        const flushRes = await flushRide(rideId);
        // ETL Pipeline — trigger analytics async after buffer flush (non-blocking)
        triggerAnalyticsAsync(String(rideId));
        // Optionally finalize ride row if not already handled via sessionMonitor
        // Do not block on session finalize — telemetrySocket flush is primary; sessionMonitor handles auto-finalize on disconnect
        io.to(room).emit('ride:completed', {
          ride_id: String(rideId),
          completedAt: new Date().toISOString(),
          flushed: flushRes.flushed || 0,
        });
        // Also ack sender
        socket.emit('ride:completed', {
          ride_id: String(rideId),
          completedAt: new Date().toISOString(),
          flushed: flushRes.flushed || 0,
        });
      } catch (e) {
        console.error('[telemetrySocket] ride:complete flush failed:', e.message || e);
        socket.emit('error', { message: 'Failed to complete ride' });
      }
    });

    socket.on('disconnect', () => {
      for (const rideId of joinedRides) {
        sessionMonitor.handleLeave(rideId, socket.id);
      }
      joinedRides.clear();
    });

    // Optional: explicit leave event
    socket.on('leave:ride', (payload) => {
      const rideId = typeof payload === 'string' ? payload : payload?.ride_id || payload?.rideId;
      if (!rideId) return;
      const room = `ride:${rideId}`;
      socket.leave(room);
      joinedRides.delete(String(rideId));
      sessionMonitor.handleLeave(rideId, socket.id);
    });
  });

  ioInstance = io;
  return io;
};

export const getIO = () => ioInstance;

export default initTelemetrySocket;
