import { supabase } from '../config/supabaseClient.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_FILTERS = new Set(['daily', 'weekly', 'monthly', 'all-time']);
const VALID_PERIODS = new Set(['weekly', 'monthly']);

const toNumber = (value, fallback = 0) => {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
};

const round2 = (value) => Math.round(value * 100) / 100;
const isValidUuid = (value) => UUID_REGEX.test(String(value || ''));

const getRideIdParam = (req) => (
  req.params?.ride_id ||
  req.params?.rideId ||
  req.params?.id ||
  Object.values(req.params || {})[0]
);

const getRideSensorSummary = async (rideId) => {
  const { data, error } = await supabase
    .from('sensor_data')
    .select('timestamp,speed,cadence,heart_rate,power')
    .eq('ride_id', rideId)
    .order('timestamp', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = data || [];
  const speedRows = rows.filter((row) => row.speed !== null && row.speed !== undefined);
  const latest = rows[rows.length - 1] || null;

  const averageSpeed = speedRows.length
    ? speedRows.reduce((total, row) => total + toNumber(row.speed), 0) / speedRows.length
    : 0;

  const maxSpeed = speedRows.length
    ? Math.max(...speedRows.map((row) => toNumber(row.speed)))
    : 0;

  const averagePower = rows.length
    ? rows.reduce((total, row) => total + toNumber(row.power), 0) / rows.length
    : 0;

  return {
    latest,
    samples: rows,
    averageSpeed,
    maxSpeed,
    averagePower,
  };
};

const getPeriodStart = (key) => {
  if (key === 'all-time') return null;

  const now = new Date();

  if (key === 'daily') {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    return start.toISOString();
  }

  if (key === 'monthly') {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return start.toISOString();
  }

  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  return start.toISOString();
};

const fetchRides = async (userId, startIso) => {
  let query = supabase
    .from('rides')
    .select('ride_id,start_time,end_time,duration,distance,avg_speed,calories')
    .eq('user_id', userId);

  if (startIso) {
    query = query.gte('start_time', startIso);
  }

  return query;
};

const emptyStats = () => ({
  total_rides: 0,
  total_distance: 0,
  total_calories: 0,
  total_duration_seconds: 0,
  avg_speed: 0,
  avg_distance_per_ride: 0,
  avg_calories_per_ride: 0,
  longest_ride_distance: 0,
  fastest_avg_speed: 0,
  first_ride_at: null,
  last_ride_at: null,
});

const aggregateRideStats = (rides) => {
  if (!rides || rides.length === 0) {
    return emptyStats();
  }

  let totalDistance = 0;
  let totalCalories = 0;
  let totalDuration = 0;
  let speedSum = 0;
  let speedSamples = 0;
  let longestRide = 0;
  let fastestSpeed = 0;
  let firstRideAt = null;
  let lastRideAt = null;

  rides.forEach((ride) => {
    const distance = toNumber(ride.distance);
    const calories = toNumber(ride.calories);
    const duration = toNumber(ride.duration);
    const avgSpeed = toNumber(ride.avg_speed);

    totalDistance += distance;
    totalCalories += calories;
    totalDuration += duration;

    if (ride.avg_speed !== null && ride.avg_speed !== undefined) {
      speedSum += avgSpeed;
      speedSamples += 1;
    }

    if (distance > longestRide) longestRide = distance;
    if (avgSpeed > fastestSpeed) fastestSpeed = avgSpeed;

    if (ride.start_time) {
      const startTs = new Date(ride.start_time).getTime();
      if (!Number.isNaN(startTs)) {
        if (firstRideAt === null || startTs < firstRideAt) firstRideAt = startTs;
        if (lastRideAt === null || startTs > lastRideAt) lastRideAt = startTs;
      }
    }
  });

  const totalRides = rides.length;
  const avgSpeed = speedSamples > 0 ? speedSum / speedSamples : 0;

  return {
    total_rides: totalRides,
    total_distance: round2(totalDistance),
    total_calories: round2(totalCalories),
    total_duration_seconds: Math.round(totalDuration),
    avg_speed: round2(avgSpeed),
    avg_distance_per_ride: round2(totalDistance / totalRides),
    avg_calories_per_ride: round2(totalCalories / totalRides),
    longest_ride_distance: round2(longestRide),
    fastest_avg_speed: round2(fastestSpeed),
    first_ride_at: firstRideAt ? new Date(firstRideAt).toISOString() : null,
    last_ride_at: lastRideAt ? new Date(lastRideAt).toISOString() : null,
  };
};

export const startRide = async (req, res) => {
  const { user_id, start_time } = req.body || {};

  if (!isValidUuid(user_id)) {
    return res.status(400).json({
      message: 'user_id is required and must be a valid profile UUID',
    });
  }

  try {
    const { data, error } = await supabase
      .from('rides')
      .insert({
        user_id,
        start_time: start_time || new Date().toISOString(),
        duration: 0,
        distance: 0,
        avg_speed: 0,
        calories: 0,
      })
      .select('ride_id,user_id,start_time,end_time,duration,distance,avg_speed,calories')
      .single();

    if (error) {
      console.error('Ride start failed:', error);
      return res.status(500).json({ message: 'Failed to start ride' });
    }

    return res.status(201).json(data);
  } catch (error) {
    console.error('Ride start endpoint failed:', error);
    return res.status(500).json({ message: 'Failed to start ride' });
  }
};

export const endRide = async (req, res) => {
  const rideId = getRideIdParam(req);
  const {
    end_time,
    duration,
    distance,
    avg_speed,
    calories,
  } = req.body || {};

  if (!isValidUuid(rideId)) {
    return res.status(400).json({ message: 'ride_id must be a valid UUID' });
  }

  try {
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('ride_id,user_id,start_time,end_time,duration,distance,avg_speed,calories')
      .eq('ride_id', rideId)
      .single();

    if (rideError || !ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    const sensorSummary = await getRideSensorSummary(rideId);
    const endTime = end_time || new Date().toISOString();
    const startedAt = ride.start_time ? new Date(ride.start_time) : null;
    const endedAt = new Date(endTime);
    const calculatedDuration = startedAt && !Number.isNaN(startedAt.getTime())
      ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
      : 0;

    const update = {
      end_time: endTime,
      duration: Math.round(toNumber(duration, calculatedDuration)),
      distance: Number(toNumber(distance, ride.distance).toFixed(3)),
      avg_speed: Number(toNumber(avg_speed, sensorSummary.averageSpeed || ride.avg_speed).toFixed(2)),
      calories: Number(toNumber(calories, ride.calories).toFixed(1)),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('rides')
      .update(update)
      .eq('ride_id', rideId)
      .select('ride_id,user_id,start_time,end_time,duration,distance,avg_speed,calories')
      .single();

    if (error) {
      console.error('Ride end failed:', error);
      return res.status(500).json({ message: 'Failed to end ride' });
    }

    return res.json({
      ...data,
      sensorSummary: {
        sampleCount: sensorSummary.samples.length,
        maxSpeed: Number(sensorSummary.maxSpeed.toFixed(2)),
        averagePower: Number(sensorSummary.averagePower.toFixed(1)),
      },
    });
  } catch (error) {
    console.error('Ride end endpoint failed:', error);
    return res.status(500).json({ message: 'Failed to end ride' });
  }
};

export const getRide = async (req, res) => {
  const rideId = getRideIdParam(req);

  if (!isValidUuid(rideId)) {
    return res.status(400).json({ message: 'ride_id must be a valid UUID' });
  }

  try {
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('ride_id,user_id,start_time,end_time,duration,distance,avg_speed,calories')
      .eq('ride_id', rideId)
      .single();

    if (rideError || !ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    const sensorSummary = await getRideSensorSummary(rideId);

    return res.json({
      ...ride,
      latestSensor: sensorSummary.latest,
      sensorSummary: {
        sampleCount: sensorSummary.samples.length,
        averageSpeed: Number(sensorSummary.averageSpeed.toFixed(2)),
        maxSpeed: Number(sensorSummary.maxSpeed.toFixed(2)),
        averagePower: Number(sensorSummary.averagePower.toFixed(1)),
      },
      sensorData: sensorSummary.samples,
    });
  } catch (error) {
    console.error('Ride details endpoint failed:', error);
    return res.status(500).json({ message: 'Failed to fetch ride details' });
  }
};

export const getUserStats = async (req, res) => {
  const { userId } = req.params;
  const requestedFilter = String(req.query.filter || 'all-time');
  const filter = VALID_FILTERS.has(requestedFilter) ? requestedFilter : 'all-time';

  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: 'userId is required' });
  }

  if (!isValidUuid(userId)) {
    return res
      .status(400)
      .json({ success: false, message: 'userId must be a valid UUID' });
  }

  try {
    const startIso = getPeriodStart(filter);
    const { data: rides, error } = await fetchRides(userId, startIso);

    if (error) {
      console.error('Supabase ride stats query failed:', error);
      return res
        .status(500)
        .json({ success: false, message: 'Failed to fetch ride statistics' });
    }

    return res.json({
      success: true,
      filter,
      stats: aggregateRideStats(rides || []),
    });
  } catch (error) {
    console.error('Ride stats endpoint failed:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to fetch ride statistics' });
  }
};

export const getUserSummary = async (req, res) => {
  const { userId } = req.params;
  const requestedPeriod = String(req.query.period || 'weekly');
  const period = VALID_PERIODS.has(requestedPeriod) ? requestedPeriod : 'weekly';

  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: 'userId is required' });
  }

  if (!isValidUuid(userId)) {
    return res
      .status(400)
      .json({ success: false, message: 'userId must be a valid UUID' });
  }

  try {
    const startIso = getPeriodStart(period);
    const periodEndIso = new Date().toISOString();

    const { data: rides, error } = await fetchRides(userId, startIso);

    if (error) {
      console.error('Supabase ride summary query failed:', error);
      return res
        .status(500)
        .json({ success: false, message: 'Failed to fetch ride summary' });
    }

    const stats = aggregateRideStats(rides || []);

    return res.json({
      success: true,
      period,
      period_start: startIso,
      period_end: periodEndIso,
      summary: {
        total_rides: stats.total_rides,
        total_distance: stats.total_distance,
        total_calories: stats.total_calories,
        total_duration_seconds: stats.total_duration_seconds,
        avg_speed: stats.avg_speed,
      },
    });
  } catch (error) {
    console.error('Ride summary endpoint failed:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to fetch ride summary' });
  }
};
