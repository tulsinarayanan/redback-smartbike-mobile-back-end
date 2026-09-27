import { supabase } from '../config/supabaseClient.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const computeMaxHr = (age) => {
  const n = Number(age);
  if (Number.isFinite(n) && n > 0 && n < 120) return 220 - n;
  return 190;
};

const getZone = (hr, maxHr) => {
  if (!Number.isFinite(hr) || hr <= 0) return null;
  const pct = hr / maxHr;
  if (pct < 0.6) return 1;
  if (pct < 0.7) return 2;
  if (pct < 0.8) return 3;
  if (pct < 0.9) return 4;
  return 5;
};

// Two-pointer rolling average by time window (seconds)
const computePeakPower = (points, windowSec) => {
  if (!points.length) return 0;
  let maxAvg = 0;
  let sum = 0;
  let count = 0;
  let left = 0;
  const windowMs = windowSec * 1000;
  for (let right = 0; right < points.length; right++) {
    const rPower = points[right].power;
    if (Number.isFinite(rPower)) {
      sum += rPower;
      count += 1;
    }
    while (points[right].ts - points[left].ts > windowMs) {
      const lPower = points[left].power;
      if (Number.isFinite(lPower)) {
        sum -= lPower;
        count -= 1;
      }
      left++;
    }
    if (count > 0) {
      const avg = sum / count;
      if (avg > maxAvg) maxAvg = avg;
    }
  }
  return Number(maxAvg.toFixed(2));
};

const computeNormalizedPower = (points) => {
  if (!points.length) return 0;
  const windowMs = 30 * 1000;
  const rollingAvgs = [];
  let sum = 0;
  let count = 0;
  let left = 0;
  for (let right = 0; right < points.length; right++) {
    const rPower = points[right].power;
    if (Number.isFinite(rPower)) {
      sum += rPower;
      count += 1;
    }
    while (points[right].ts - points[left].ts > windowMs) {
      const lPower = points[left].power;
      if (Number.isFinite(lPower)) {
        sum -= lPower;
        count -= 1;
      }
      left++;
    }
    if (count > 0) {
      rollingAvgs.push(sum / count);
    }
  }
  if (rollingAvgs.length === 0) return 0;
  const fourthPowAvg = rollingAvgs.reduce((acc, v) => acc + Math.pow(v, 4), 0) / rollingAvgs.length;
  const np = Math.pow(fourthPowAvg, 0.25);
  return Number.isFinite(np) ? Number(np.toFixed(2)) : 0;
};

export const processRideAnalytics = async (rideId) => {
  const key = String(rideId);
  if (!UUID_REGEX.test(key)) throw new Error('Invalid ride_id');

  // Extract: ride
  const { data: ride, error: rideError } = await supabase
    .from('rides')
    .select('ride_id, user_id, start_time, end_time')
    .eq('ride_id', key)
    .single();

  if (rideError || !ride) {
    throw new Error(rideError?.message || 'Ride not found');
  }

  const userId = ride.user_id;

  // Extract: profile for Max HR
  let maxHr = 190;
  if (userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('age')
      .eq('id', userId)
      .single();
    if (profile) maxHr = computeMaxHr(profile.age);
  }

  // Extract: sensor_data ordered
  const { data: sensorData, error: sensorError } = await supabase
    .from('sensor_data')
    .select('data_id, ride_id, timestamp, speed, cadence, heart_rate, power')
    .eq('ride_id', key)
    .order('timestamp', { ascending: true });

  if (sensorError) throw sensorError;

  const rows = sensorData || [];

  // Transform: prepare points sorted by ts
  const points = rows
    .map((r) => ({
      ts: new Date(r.timestamp).getTime(),
      heart_rate: r.heart_rate !== null && r.heart_rate !== undefined ? Number(r.heart_rate) : null,
      power: r.power !== null && r.power !== undefined ? Number(r.power) : null,
      cadence: r.cadence !== null && r.cadence !== undefined ? Number(r.cadence) : null,
    }))
    .filter((p) => Number.isFinite(p.ts))
    .sort((a, b) => a.ts - b.ts);

  // Heart Rate Zones — duration based on inter-point intervals
  const zoneSecs = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let maxHeartRate = 0;
  let maxPower = 0;
  let cadenceSum = 0;
  let cadenceCount = 0;
  let maxCadence = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (Number.isFinite(p.heart_rate) && p.heart_rate > maxHeartRate) maxHeartRate = p.heart_rate;
    if (Number.isFinite(p.power) && p.power > maxPower) maxPower = p.power;
    if (Number.isFinite(p.cadence)) {
      cadenceSum += p.cadence;
      cadenceCount += 1;
      if (p.cadence > maxCadence) maxCadence = p.cadence;
    }

    if (!Number.isFinite(p.heart_rate) || p.heart_rate <= 0) continue;
    const zone = getZone(p.heart_rate, maxHr);
    if (!zone) continue;

    let dtSec = 1;
    if (i < points.length - 1) {
      const nextTs = points[i + 1].ts;
      const diff = (nextTs - p.ts) / 1000;
      if (Number.isFinite(diff) && diff > 0 && diff <= 60) dtSec = diff;
      else if (diff > 60) dtSec = 1;
    }
    // cap single interval to 60s to avoid sensor dropout skewing zones
    dtSec = Math.min(dtSec, 60);
    zoneSecs[zone] += dtSec;
  }

  const hr_zone_1_recovery_sec = Math.round(zoneSecs[1]);
  const hr_zone_2_aerobic_sec = Math.round(zoneSecs[2]);
  const hr_zone_3_tempo_sec = Math.round(zoneSecs[3]);
  const hr_zone_4_threshold_sec = Math.round(zoneSecs[4]);
  const hr_zone_5_anaerobic_sec = Math.round(zoneSecs[5]);

  // Rolling peak power windows
  const peak_power_5s = computePeakPower(points, 5);
  const peak_power_1m = computePeakPower(points, 60);
  const peak_power_5m = computePeakPower(points, 300);

  // Normalized Power & Intensity Factor
  const normalized_power = computeNormalizedPower(points);
  // FTP estimation: use 95% of peak 5m or default 250W
  const ftpEstimate = peak_power_5m > 0 ? peak_power_5m : 250;
  const ftp = ftpEstimate > 0 ? ftpEstimate : 250;
  // Intensity Factor = NP / FTP, capped to [0, 2]
  let intensity_factor = ftp > 0 ? normalized_power / ftp : 0;
  if (!Number.isFinite(intensity_factor)) intensity_factor = 0;
  intensity_factor = Math.min(Math.max(intensity_factor, 0), 2);
  intensity_factor = Number(intensity_factor.toFixed(3));

  const avg_cadence = cadenceCount > 0 ? Number((cadenceSum / cadenceCount).toFixed(2)) : 0;
  maxHeartRate = Math.round(maxHeartRate);
  maxPower = Number(Number(maxPower).toFixed(2));
  // max_cadence computed but table stores avg_cadence per spec; we keep max in memory for potential future use
  void maxCadence;

  const payload = {
    ride_id: key,
    user_id: userId,
    hr_zone_1_recovery_sec,
    hr_zone_2_aerobic_sec,
    hr_zone_3_tempo_sec,
    hr_zone_4_threshold_sec,
    hr_zone_5_anaerobic_sec,
    peak_power_5s,
    peak_power_1m,
    peak_power_5m,
    normalized_power,
    intensity_factor,
    avg_cadence,
    max_heart_rate: maxHeartRate,
    max_power: maxPower,
  };

  // Load: upsert
  const { data, error } = await supabase
    .from('ride_analytics')
    .upsert(payload, { onConflict: 'ride_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
};

// Fire-and-forget wrapper for pipeline triggers (non-blocking)
export const triggerAnalyticsAsync = (rideId) => {
  if (!rideId || !UUID_REGEX.test(String(rideId))) return;
  setImmediate(async () => {
    try {
      await processRideAnalytics(rideId);
      console.log(`[analytics] processed ride ${rideId}`);
    } catch (e) {
      console.error(`[analytics] failed for ride ${rideId}:`, e.message || e);
    }
  });
};

export const _helpers = {
  computeMaxHr,
  getZone,
  computePeakPower,
  computeNormalizedPower,
};
