import { supabase } from '../config/supabaseClient.js';

const BUFFER_LIMIT = 50;
const FLUSH_INTERVAL_MS = 3000;

const buffers = new Map();
let flushTimer = null;
let hooksInstalled = false;
let isFlushingAll = false;

const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const toTimestamp = (value) => {
  if (!value) return new Date().toISOString();
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
};

const normalizeRow = (payload = {}) => {
  const rideId = payload.ride_id || payload.rideId || null;
  return {
    ride_id: rideId,
    timestamp: toTimestamp(payload.timestamp || payload.ts),
    speed: toNumberOrNull(payload.speed),
    cadence: toNumberOrNull(payload.cadence),
    heart_rate: toNumberOrNull(payload.heart_rate ?? payload.heartRate),
    power: toNumberOrNull(payload.power),
  };
};

export const enqueue = (payload) => {
  if (!payload || typeof payload !== 'object') return { ok: false, message: 'payload must be an object' };
  const rideId = payload.ride_id || payload.rideId;
  if (!rideId) return { ok: false, message: 'ride_id is required' };

  const row = normalizeRow(payload);
  const key = String(rideId);
  if (!buffers.has(key)) buffers.set(key, []);
  const queue = buffers.get(key);
  queue.push(row);

  if (queue.length >= BUFFER_LIMIT) {
    void flushRide(key);
  }

  return { ok: true, buffered: queue.length, ride_id: key };
};

export const flushRide = async (rideId) => {
  const key = String(rideId);
  const queue = buffers.get(key);
  if (!queue || queue.length === 0) return { ok: true, flushed: 0, ride_id: key };

  const batch = queue.splice(0, queue.length);
  if (batch.length === 0) return { ok: true, flushed: 0, ride_id: key };

  try {
    const { error } = await supabase.from('sensor_data').insert(batch);
    if (error) throw error;
    return { ok: true, flushed: batch.length, ride_id: key };
  } catch (err) {
    console.error(`[telemetryBuffer] flushRide ${key} failed:`, err.message || err);
    // Requeue failed batch to front to avoid data loss (capped to prevent unbounded growth)
    const existing = buffers.get(key) || [];
    buffers.set(key, [...batch, ...existing].slice(0, 500));
    return { ok: false, flushed: 0, error: err.message || String(err), ride_id: key };
  }
};

export const flushAll = async () => {
  if (isFlushingAll) return { ok: true, flushed: 0, skipped: true };
  isFlushingAll = true;
  let total = 0;
  const results = [];
  try {
    const rideIds = [...buffers.keys()];
    for (const rideId of rideIds) {
      const res = await flushRide(rideId);
      total += res.flushed || 0;
      results.push(res);
    }
    return { ok: true, flushed: total, results };
  } finally {
    isFlushingAll = false;
  }
};

// Synchronous-named flush for SIGINT/SIGTERM — awaits all pending inserts before exit
export const flushAllSync = async () => {
  stopInterval();
  const result = await flushAll();
  return result;
};

export const getBufferStats = () => {
  const stats = {};
  for (const [rideId, queue] of buffers.entries()) {
    stats[rideId] = queue.length;
  }
  return stats;
};

export const getBufferSize = (rideId) => {
  if (rideId) return buffers.get(String(rideId))?.length || 0;
  let total = 0;
  for (const q of buffers.values()) total += q.length;
  return total;
};

export const clearBuffer = (rideId) => {
  if (rideId) buffers.delete(String(rideId));
  else buffers.clear();
};

const startInterval = () => {
  if (flushTimer) return flushTimer;
  flushTimer = setInterval(() => {
    void flushAll();
  }, FLUSH_INTERVAL_MS);
  // Allow process to exit if only timer remains
  if (flushTimer.unref) flushTimer.unref();
  return flushTimer;
};

const stopInterval = () => {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
};

const installHooks = () => {
  if (hooksInstalled) return;
  hooksInstalled = true;
  const handler = async (signal) => {
    console.log(`[telemetryBuffer] ${signal} received — flushing buffers...`);
    try {
      const res = await flushAllSync();
      console.log(`[telemetryBuffer] flushed ${res.flushed || 0} records on ${signal}`);
    } catch (e) {
      console.error('[telemetryBuffer] flushAllSync failed on shutdown:', e.message || e);
    }
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
};

startInterval();
installHooks();

// For testing / graceful shutdown
export const _internals = {
  buffers,
  startInterval,
  stopInterval,
  installHooks,
  BUFFER_LIMIT,
  FLUSH_INTERVAL_MS,
};
