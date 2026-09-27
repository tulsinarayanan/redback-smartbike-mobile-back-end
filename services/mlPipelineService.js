import { supabase } from '../config/supabaseClient.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const calcWorkKj = (normalizedPower, durationSec) => {
  if (!normalizedPower || !durationSec) return 0;
  return Number(((normalizedPower * durationSec) / 1000).toFixed(2));
};

const calcPowerToWeight = (power, weight) => {
  const w = toNum(weight, 0);
  const p = toNum(power, 0);
  if (!w || w <= 0) return null;
  return Number((p / w).toFixed(3));
};

const calcHrDistribution = (analytics) => {
  const z1 = toNum(analytics.hr_zone_1_recovery_sec, 0);
  const z2 = toNum(analytics.hr_zone_2_aerobic_sec, 0);
  const z3 = toNum(analytics.hr_zone_3_tempo_sec, 0);
  const z4 = toNum(analytics.hr_zone_4_threshold_sec, 0);
  const z5 = toNum(analytics.hr_zone_5_anaerobic_sec, 0);
  const total = z1 + z2 + z3 + z4 + z5;
  if (total <= 0) {
    return {
      hr_zone_1_pct: 0,
      hr_zone_2_pct: 0,
      hr_zone_3_pct: 0,
      hr_zone_4_pct: 0,
      hr_zone_5_pct: 0,
      total_zone_sec: 0,
    };
  }
  return {
    hr_zone_1_pct: Number(((z1 / total) * 100).toFixed(2)),
    hr_zone_2_pct: Number(((z2 / total) * 100).toFixed(2)),
    hr_zone_3_pct: Number(((z3 / total) * 100).toFixed(2)),
    hr_zone_4_pct: Number(((z4 / total) * 100).toFixed(2)),
    hr_zone_5_pct: Number(((z5 / total) * 100).toFixed(2)),
    total_zone_sec: total,
  };
};

/**
 * Export ML-ready feature vectors per workout for a user.
 * @param {string} userId - profiles.id
 * @returns {Promise<Array>} normalized JSON records
 */
export const exportUserTrainingFeatures = async (userId) => {
  const uid = String(userId || '').trim();
  if (!UUID_REGEX.test(uid)) {
    const err = new Error('Invalid user_id');
    err.status = 400;
    throw err;
  }

  // Verify profile exists (also need weight for power_to_weight)
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, age, weight, height, level, xp')
    .eq('id', uid)
    .single();

  if (profileError || !profile) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  // Historical rides
  const { data: rides, error: ridesError } = await supabase
    .from('rides')
    .select('ride_id, user_id, start_time, end_time, duration, distance, avg_speed, calories')
    .eq('user_id', uid)
    .order('start_time', { ascending: true });

  if (ridesError) throw ridesError;

  if (!rides || rides.length === 0) {
    return [];
  }

  const rideIds = rides.map((r) => r.ride_id);

  // Joined analytics (may be missing for some rides)
  const { data: analyticsRows, error: analyticsError } = await supabase
    .from('ride_analytics')
    .select(
      'ride_id, user_id, hr_zone_1_recovery_sec, hr_zone_2_aerobic_sec, hr_zone_3_tempo_sec, hr_zone_4_threshold_sec, hr_zone_5_anaerobic_sec, peak_power_5s, peak_power_1m, peak_power_5m, normalized_power, intensity_factor, avg_cadence, max_heart_rate, max_power'
    )
    .in('ride_id', rideIds);

  if (analyticsError && analyticsError.code !== 'PGRST116') {
    // If table missing, treat as empty analytics
    if (String(analyticsError.message || '').includes('does not exist')) {
      // proceed with empty
    } else {
      throw analyticsError;
    }
  }

  const analyticsByRide = new Map((analyticsRows || []).map((a) => [a.ride_id, a]));

  // Pre-sort rides ascending for rolling 7-day window
  const sorted = [...rides].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  // Helper to compute 7-day rolling aggregates inclusive of current ride
  const compute7DayLoad = (currentRide) => {
    const currentStart = new Date(currentRide.start_time).getTime();
    if (!Number.isFinite(currentStart)) return { distance_km: 0, duration_sec: 0, calories: 0, ride_count: 0 };
    const windowStart = currentStart - 7 * 24 * 60 * 60 * 1000;
    let distance_km = 0;
    let duration_sec = 0;
    let calories = 0;
    let ride_count = 0;
    for (const r of sorted) {
      const t = new Date(r.start_time).getTime();
      if (t >= windowStart && t <= currentStart) {
        distance_km += toNum(r.distance, 0);
        // duration is integer seconds in rides table
        duration_sec += toNum(r.duration, 0);
        calories += toNum(r.calories, 0);
        ride_count += 1;
      }
    }
    return {
      distance_km: Number(distance_km.toFixed(2)),
      duration_sec,
      duration_min: Number((duration_sec / 60).toFixed(1)),
      calories: Number(calories.toFixed(1)),
      ride_count,
    };
  };

  const weight = profile.weight;

  const records = sorted.map((ride) => {
    const analytics = analyticsByRide.get(ride.ride_id) || {};
    const durationSec = toNum(ride.duration, 0) || (() => {
      const s = new Date(ride.start_time).getTime();
      const e = new Date(ride.end_time).getTime();
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) return Math.round((e - s) / 1000);
      return 0;
    })();

    const normalizedPower = toNum(analytics.normalized_power, 0);
    const work_kj = calcWorkKj(normalizedPower, durationSec);

    const hrDist = calcHrDistribution(analytics);

    const sevenDay = compute7DayLoad(ride);

    return {
      ride_id: ride.ride_id,
      user_id: uid,
      start_time: ride.start_time,
      end_time: ride.end_time,
      duration_sec: durationSec,
      distance_km: toNum(ride.distance, 0),
      avg_speed_kmh: toNum(ride.avg_speed, 0),
      calories: toNum(ride.calories, 0),
      // ML features
      work_kj,
      power_to_weight: {
        normalized: calcPowerToWeight(normalizedPower, weight),
        peak_5s: calcPowerToWeight(analytics.peak_power_5s, weight),
        peak_1m: calcPowerToWeight(analytics.peak_power_1m, weight),
        peak_5m: calcPowerToWeight(analytics.peak_power_5m, weight),
        max: calcPowerToWeight(analytics.max_power, weight),
      },
      hr_zone_distribution: {
        zone_1_recovery_pct: hrDist.hr_zone_1_pct,
        zone_2_aerobic_pct: hrDist.hr_zone_2_pct,
        zone_3_tempo_pct: hrDist.hr_zone_3_pct,
        zone_4_threshold_pct: hrDist.hr_zone_4_pct,
        zone_5_anaerobic_pct: hrDist.hr_zone_5_pct,
        total_zone_sec: hrDist.total_zone_sec,
      },
      hr_zones_sec: {
        hr_zone_1_recovery_sec: toNum(analytics.hr_zone_1_recovery_sec, 0),
        hr_zone_2_aerobic_sec: toNum(analytics.hr_zone_2_aerobic_sec, 0),
        hr_zone_3_tempo_sec: toNum(analytics.hr_zone_3_tempo_sec, 0),
        hr_zone_4_threshold_sec: toNum(analytics.hr_zone_4_threshold_sec, 0),
        hr_zone_5_anaerobic_sec: toNum(analytics.hr_zone_5_anaerobic_sec, 0),
      },
      intensity_factor: toNum(analytics.intensity_factor, 0),
      normalized_power: normalizedPower,
      peak_power_5s: toNum(analytics.peak_power_5s, 0),
      peak_power_1m: toNum(analytics.peak_power_1m, 0),
      peak_power_5m: toNum(analytics.peak_power_5m, 0),
      avg_cadence: toNum(analytics.avg_cadence, 0),
      max_heart_rate: toNum(analytics.max_heart_rate, 0),
      max_power: toNum(analytics.max_power, 0),
      '7_day_load': sevenDay,
      weight_kg: weight != null ? toNum(weight, null) : null,
      level: profile.level ?? null,
    };
  });

  return records;
};

export const get7DaySummary = async (userId) => {
  const features = await exportUserTrainingFeatures(userId);
  if (features.length === 0) {
    return {
      total_distance_km: 0,
      total_duration_sec: 0,
      total_duration_min: 0,
      total_calories: 0,
      ride_count: 0,
      avg_intensity_factor: 0,
      avg_normalized_power: 0,
      total_work_kj: 0,
    };
  }
  const latest = features[features.length - 1];
  const seven = latest['7_day_load'];
  const last7 = features.filter((f) => {
    const t = new Date(f.start_time).getTime();
    const latestT = new Date(latest.start_time).getTime();
    return t >= latestT - 7 * 24 * 60 * 60 * 1000;
  });
  const avgIF = last7.reduce((s, r) => s + toNum(r.intensity_factor, 0), 0) / (last7.length || 1);
  const avgNP = last7.reduce((s, r) => s + toNum(r.normalized_power, 0), 0) / (last7.length || 1);
  const totalWork = last7.reduce((s, r) => s + toNum(r.work_kj, 0), 0);
  return {
    total_distance_km: seven.distance_km,
    total_duration_sec: seven.duration_sec,
    total_duration_min: seven.duration_min,
    total_calories: seven.calories,
    ride_count: seven.ride_count,
    avg_intensity_factor: Number(avgIF.toFixed(3)),
    avg_normalized_power: Number(avgNP.toFixed(1)),
    total_work_kj: Number(totalWork.toFixed(1)),
  };
};
