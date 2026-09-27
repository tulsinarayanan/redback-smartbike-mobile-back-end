import { supabase } from '../config/supabaseClient.js';
import { triggerAnalyticsAsync } from './analyticsService.js';

const RECONNECT_GRACE_MS = 30_000;
const FINALIZE_DELAY_MS = 120_000;

const sessions = new Map();

const getSession = (rideId) => {
  const key = String(rideId);
  if (!sessions.has(key)) {
    sessions.set(key, {
      rideId: key,
      activeSockets: new Set(),
      reconnectTimer: null,
      finalizeTimer: null,
      lastDisconnectAt: null,
    });
  }
  return sessions.get(key);
};

const clearTimers = (session) => {
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }
  if (session.finalizeTimer) {
    clearTimeout(session.finalizeTimer);
    session.finalizeTimer = null;
  }
};

export const handleJoin = (rideId, socketId) => {
  if (!rideId || !socketId) return;
  const session = getSession(rideId);
  session.activeSockets.add(String(socketId));
  if (session.reconnectTimer || session.finalizeTimer) {
    console.log(`[sessionMonitor] ride ${rideId} reconnected — cancelling timers`);
  }
  clearTimers(session);
  session.lastDisconnectAt = null;
  return { ride_id: String(rideId), connections: session.activeSockets.size };
};

export const handleLeave = (rideId, socketId) => {
  if (!rideId) return;
  const key = String(rideId);
  const session = sessions.get(key);
  if (!session) return;

  if (socketId) session.activeSockets.delete(String(socketId));

  if (session.activeSockets.size > 0) return { ride_id: key, connections: session.activeSockets.size, pending: false };

  // No active connections — start drop protection timers
  session.lastDisconnectAt = new Date().toISOString();
  console.log(`[sessionMonitor] ride ${key} has no active clients — starting ${RECONNECT_GRACE_MS / 1000}s reconnect window`);

  session.reconnectTimer = setTimeout(() => {
    console.log(`[sessionMonitor] ride ${key} reconnect window expired (${RECONNECT_GRACE_MS / 1000}s) — awaiting finalization`);
    session.reconnectTimer = null;
  }, RECONNECT_GRACE_MS);

  if (session.reconnectTimer.unref) session.reconnectTimer.unref();

  session.finalizeTimer = setTimeout(async () => {
    try {
      await finalizeRide(key);
    } catch (e) {
      console.error(`[sessionMonitor] finalizeRide ${key} failed:`, e.message || e);
    } finally {
      sessions.delete(key);
    }
  }, FINALIZE_DELAY_MS);

  if (session.finalizeTimer.unref) session.finalizeTimer.unref();

  return { ride_id: key, connections: 0, pending: true, finalizeInMs: FINALIZE_DELAY_MS };
};

export const handleDisconnectAll = (socketId, rideIds = []) => {
  const results = [];
  for (const rideId of rideIds) {
    results.push(handleLeave(rideId, socketId));
  }
  return results;
};

export const finalizeRide = async (rideId) => {
  const key = String(rideId);
  const endTime = new Date().toISOString();

  const { data: ride, error: fetchError } = await supabase
    .from('rides')
    .select('ride_id, start_time, end_time, duration')
    .eq('ride_id', key)
    .single();

  if (fetchError) {
    console.warn(`[sessionMonitor] finalizeRide ${key} fetch failed:`, fetchError.message);
    // Ride may not exist yet — create minimal end marker not possible without user_id;
    // just log and clear session.
    return { ok: false, message: fetchError.message, ride_id: key };
  }

  if (ride?.end_time) {
    console.log(`[sessionMonitor] ride ${key} already finalized at ${ride.end_time}`);
    return { ok: true, alreadyFinalized: true, ride_id: key, end_time: ride.end_time };
  }

  let duration = null;
  if (ride?.start_time) {
    const start = new Date(ride.start_time).getTime();
    const end = new Date(endTime).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      duration = Math.round((end - start) / 1000);
    }
  }

  const updatePayload = {
    end_time: endTime,
    updated_at: endTime,
  };
  if (duration !== null) updatePayload.duration = duration;

  const { data, error: updateError } = await supabase
    .from('rides')
    .update(updatePayload)
    .eq('ride_id', key)
    .select('ride_id, start_time, end_time, duration, updated_at')
    .single();

  if (updateError) {
    console.error(`[sessionMonitor] finalizeRide ${key} update failed:`, updateError.message);
    return { ok: false, message: updateError.message, ride_id: key };
  }

  console.log(`[sessionMonitor] ride ${key} finalized — end_time=${endTime} duration=${duration}s`);

  // ETL Worker — async analytics after finalization (non-blocking)
  triggerAnalyticsAsync(key);

  return { ok: true, ride_id: key, end_time: endTime, duration, data };
};

export const completeRide = async (rideId) => {
  const key = String(rideId);
  const session = sessions.get(key);
  if (session) {
    clearTimers(session);
    sessions.delete(key);
  }
  return finalizeRide(key);
};

export const getActiveConnections = (rideId) => {
  if (rideId) return sessions.get(String(rideId))?.activeSockets.size || 0;
  const out = {};
  for (const [k, s] of sessions.entries()) out[k] = s.activeSockets.size;
  return out;
};

export const isRideActive = (rideId) => {
  const s = sessions.get(String(rideId));
  return !!s && s.activeSockets.size > 0;
};

export const getSessionState = (rideId) => {
  if (rideId) return sessions.get(String(rideId)) || null;
  return [...sessions.entries()].reduce((acc, [k, v]) => {
    acc[k] = {
      connections: v.activeSockets.size,
      hasReconnectTimer: !!v.reconnectTimer,
      hasFinalizeTimer: !!v.finalizeTimer,
      lastDisconnectAt: v.lastDisconnectAt,
    };
    return acc;
  }, {});
};

export const _internals = {
  sessions,
  RECONNECT_GRACE_MS,
  FINALIZE_DELAY_MS,
  clearTimers,
};
