import { supabase } from '../config/supabaseClient.js';
import { triggerAnalyticsAsync } from './analyticsService.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const validateRidePayload = (payload) => {
  const { user_id, duration, duration_seconds, distance, distance_km, calories, calories_burned, start_time, end_time } = payload || {};
  const userId = user_id;
  if (!userId || !UUID_REGEX.test(String(userId))) return { valid: false, message: 'user_id must be a valid UUID' };

  const dur = duration ?? duration_seconds;
  if (dur !== undefined && (!Number.isFinite(Number(dur)) || Number(dur) < 0)) return { valid: false, message: 'duration must be a non-negative number' };

  const dist = distance ?? distance_km;
  if (dist !== undefined && (!Number.isFinite(Number(dist)) || Number(dist) < 0)) return { valid: false, message: 'distance must be a non-negative number' };

  const cal = calories ?? calories_burned;
  if (cal !== undefined && (!Number.isFinite(Number(cal)) || Number(cal) < 0)) return { valid: false, message: 'calories must be a non-negative number' };

  return { valid: true };
};

export const getRidesForUser = async (userId, limit = 10) => {
  const { data, error } = await supabase
    .from('rides')
    .select('ride_id, user_id, start_time, end_time, duration, distance, avg_speed, calories')
    .eq('user_id', userId)
    .order('start_time', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 10, 1), 50));
  if (error) throw error;
  return data || [];
};

export const checkAndUnlockAchievements = async (userId, ride) => {
  try {
    const { data: allAchievements } = await supabase.from('achievements').select('id, name');
    if (!allAchievements || allAchievements.length === 0) return [];
    const { data: existing } = await supabase.from('user_achievements').select('achievement_id').eq('user_id', userId);
    const unlockedIds = new Set((existing || []).map((r) => r.achievement_id));
    const byName = new Map(allAchievements.map((a) => [a.name, a.id]));

    const toUnlock = [];

    // fetch stats once if needed
    let totalDistance = 0;
    let totalRides = 0;
    try {
      const { data: rides } = await supabase.from('rides').select('distance').eq('user_id', userId);
      totalRides = (rides || []).length;
      totalDistance = (rides || []).reduce((s, r) => s + (Number(r.distance) || 0), 0);
    } catch {}

    const startHour = ride?.start_time ? new Date(ride.start_time).getHours() : null;

    if (byName.has('First Ride') && !unlockedIds.has(byName.get('First Ride')) && totalRides >= 1) {
      toUnlock.push(byName.get('First Ride'));
    }
    if (byName.has('Streak Starter') && !unlockedIds.has(byName.get('Streak Starter'))) {
      // streak_days >=3 or total rides >=3 as fallback
      try {
        const { data: prof } = await supabase.from('profiles').select('streak_days').eq('id', userId).single();
        const streak = Number(prof?.streak_days) || totalRides;
        if (streak >= 3) toUnlock.push(byName.get('Streak Starter'));
      } catch {}
    }
    if (byName.has('Century Rider') && !unlockedIds.has(byName.get('Century Rider')) && totalDistance >= 100) {
      toUnlock.push(byName.get('Century Rider'));
    }
    if (byName.has('Early Bird') && !unlockedIds.has(byName.get('Early Bird')) && startHour !== null && startHour < 7) {
      toUnlock.push(byName.get('Early Bird'));
    }
    if (byName.has('Night Owl') && !unlockedIds.has(byName.get('Night Owl')) && startHour !== null && startHour >= 21) {
      toUnlock.push(byName.get('Night Owl'));
    }

    const inserted = [];
    for (const achId of toUnlock) {
      const { data, error } = await supabase
        .from('user_achievements')
        .insert({ user_id: userId, achievement_id: achId })
        .select('id')
        .single();
      if (!error && data) inserted.push(achId);
    }
    return inserted;
  } catch (e) {
    console.warn('Achievement unlock check failed:', e?.message);
    return [];
  }
};

export const createRide = async ({ user_id, duration, duration_seconds, distance, distance_km, calories, calories_burned, start_time, end_time, avg_speed }) => {
  const userId = user_id;
  const dur = duration ?? duration_seconds ?? 0;
  const dist = Number(distance ?? distance_km ?? 0);
  const cal = Number(calories ?? calories_burned ?? 0);
  const durationInt = Math.round(Number(dur) || 0);

  const start = start_time ? new Date(start_time).toISOString() : new Date(Date.now() - durationInt * 1000).toISOString();
  const end = end_time ? new Date(end_time).toISOString() : new Date().toISOString();

  let avgSpeed = avg_speed !== undefined ? Number(avg_speed) : null;
  if (avgSpeed === null && durationInt > 0) {
    avgSpeed = Number((dist / (durationInt / 3600)).toFixed(1));
    if (!Number.isFinite(avgSpeed)) avgSpeed = null;
  }

  const { data, error } = await supabase
    .from('rides')
    .insert({
      user_id: userId,
      start_time: start,
      end_time: end,
      duration: durationInt,
      distance: dist,
      calories: cal,
      avg_speed: avgSpeed,
      updated_at: new Date().toISOString(),
    })
    .select('ride_id, user_id, start_time, end_time, duration, distance, avg_speed, calories')
    .single();

  if (error) throw error;

  // increment streak_days (awaited) and unlock achievements synchronously for immediate feedback
  try {
    const { data: prof } = await supabase.from('profiles').select('streak_days').eq('id', userId).single();
    const cur = Number(prof?.streak_days) || 0;
    await supabase.from('profiles').update({ streak_days: cur + 1, updated_at: new Date().toISOString() }).eq('id', userId);
  } catch {}

  try {
    await checkAndUnlockAchievements(userId, data);
  } catch {}

  // ETL Worker Pipeline — async, non-blocking
  if (data?.ride_id) triggerAnalyticsAsync(data.ride_id);

  return data;
};
