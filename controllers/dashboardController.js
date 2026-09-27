import { supabase } from '../config/supabaseClient.js';

const VALID_TIMEFRAMES = new Set(['daily', 'weekly', 'monthly']);
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

const toNumber = (value, fallback = 0) => {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
};

const isUuid = (value) => typeof value === 'string' && UUID_REGEX.test(value);

const getTimeframeStart = (timeframe) => {
  const now = new Date();
  const start = new Date(now);

  if (timeframe === 'daily') {
    start.setDate(now.getDate() - 1);
  } else if (timeframe === 'monthly') {
    start.setDate(now.getDate() - 30);
  } else {
    start.setDate(now.getDate() - 7);
  }

  return start.toISOString();
};

const formatRideTime = (seconds) => {
  const safeSeconds = Math.max(0, Math.round(toNumber(seconds)));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(secs).padStart(2, '0'),
  ].join(':');
};

const estimateCalories = (power, seconds, fallback = 0) => {
  const wattSeconds = toNumber(power) * Math.max(0, toNumber(seconds));
  const calories = wattSeconds / 4184;

  return Number(Math.max(toNumber(fallback), calories).toFixed(1));
};

const fetchRide = async (rideId) => {
  if (!isUuid(rideId)) {
    return null;
  }

  const { data, error } = await supabase
    .from('rides')
    .select('ride_id,user_id,start_time,end_time,duration,distance,avg_speed,calories')
    .eq('ride_id', rideId)
    .single();

  if (error) {
    return null;
  }

  return data;
};

const fetchLatestSensor = async (rideId) => {
  let query = supabase
    .from('sensor_data')
    .select('data_id,ride_id,timestamp,speed,cadence,heart_rate,power')
    .order('timestamp', { ascending: false })
    .limit(1);

  if (isUuid(rideId)) {
    query = query.eq('ride_id', rideId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data?.[0] || null;
};

const fetchSensorSummary = async (rideId) => {
  if (!isUuid(rideId)) {
    return {
      averageSpeed: 0,
      maxSpeed: 0,
      sampleCount: 0,
    };
  }

  const { data, error } = await supabase
    .from('sensor_data')
    .select('speed,power')
    .eq('ride_id', rideId);

  if (error) {
    throw error;
  }

  const rows = data || [];
  const speedRows = rows.filter((row) => row.speed !== null && row.speed !== undefined);
  const averageSpeed = speedRows.length
    ? speedRows.reduce((total, row) => total + toNumber(row.speed), 0) / speedRows.length
    : 0;
  const maxSpeed = speedRows.length
    ? Math.max(...speedRows.map((row) => toNumber(row.speed)))
    : 0;

  return {
    averageSpeed,
    maxSpeed,
    sampleCount: rows.length,
  };
};

const calculateRideSeconds = (ride) => {
  if (!ride) {
    return 0;
  }

  if (ride.duration) {
    return toNumber(ride.duration);
  }

  if (!ride.start_time) {
    return 0;
  }

  const start = new Date(ride.start_time);
  const end = ride.end_time ? new Date(ride.end_time) : new Date();

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
};

export const getDashboardHud = async (req, res) => {
  const { ride_id: rideId, gear, target_distance_km: targetDistanceKm } = req.query;

  if (req.query.mock === 'true') {
    const now = new Date();
    const seconds = Math.floor(Date.now() / 1000) % 3600;
    const speed = 24 + Math.sin(seconds / 8) * 4;
    const cadence = 82 + Math.sin(seconds / 9) * 5;
    const heartRate = 128 + Math.sin(seconds / 11) * 8;
    const power = 170 + Math.sin(seconds / 7) * 35;
    const rideSeconds = 12 * 60 + (seconds % 180);

    return res.json({
      rideId: rideId || 'mock-ride',
      currentSpeedKmh: Number(speed.toFixed(2)),
      cadenceRpm: Number(cadence.toFixed(1)),
      heartRateBpm: Number(heartRate.toFixed(1)),
      powerWatts: Number(power.toFixed(1)),
      currentGear: Math.max(0, Math.round(toNumber(gear, 6))),
      distanceKm: 3.41,
      caloriesKcal: estimateCalories(power, rideSeconds, 167),
      rideTimeSeconds: rideSeconds,
      rideTime: formatRideTime(rideSeconds),
      averageSpeedKmh: 28.4,
      maxSpeedKmh: 45.4,
      progressPercent: 72,
      sampleCount: 0,
      latestSensor: {
        timestamp: now.toISOString(),
        speed,
        cadence,
        heart_rate: heartRate,
        power,
      },
    });
  }

  try {
    const [ride, latestSensor, sensorSummary] = await Promise.all([
      fetchRide(rideId),
      fetchLatestSensor(rideId),
      fetchSensorSummary(rideId),
    ]);

    const rideSeconds = calculateRideSeconds(ride);
    const speed = toNumber(latestSensor?.speed);
    const cadence = toNumber(latestSensor?.cadence);
    const heartRate = toNumber(latestSensor?.heart_rate);
    const power = toNumber(latestSensor?.power);
    const distance = toNumber(ride?.distance);
    const targetDistance = Math.max(1, toNumber(targetDistanceKm, 30));
    const progress = Math.min(100, Math.max(0, (distance / targetDistance) * 100));

    return res.json({
      rideId: ride?.ride_id || latestSensor?.ride_id || null,
      currentSpeedKmh: Number(speed.toFixed(2)),
      cadenceRpm: Number(cadence.toFixed(1)),
      heartRateBpm: Number(heartRate.toFixed(1)),
      powerWatts: Number(power.toFixed(1)),
      currentGear: Math.max(0, Math.round(toNumber(gear, 0))),
      distanceKm: Number(distance.toFixed(3)),
      caloriesKcal: estimateCalories(power, rideSeconds, ride?.calories),
      rideTimeSeconds: rideSeconds,
      rideTime: formatRideTime(rideSeconds),
      averageSpeedKmh: Number(toNumber(ride?.avg_speed, sensorSummary.averageSpeed).toFixed(2)),
      maxSpeedKmh: Number(sensorSummary.maxSpeed.toFixed(2)),
      progressPercent: Number(progress.toFixed(1)),
      sampleCount: sensorSummary.sampleCount,
      latestSensor,
    });
  } catch (error) {
    console.error('Dashboard HUD endpoint failed:', error);
    return res.status(500).json({ message: 'Failed to fetch dashboard HUD data' });
  }
};

export const getDashboardSummary = async (req, res) => {
  const { user_id: userId } = req.query;
  const requestedTimeframe = req.query.timeframe || 'weekly';
  const timeframe = VALID_TIMEFRAMES.has(requestedTimeframe)
    ? requestedTimeframe
    : 'weekly';

  if (!isUuid(userId)) {
    return res.status(400).json({
      message: 'user_id is required and must be a valid profile UUID',
    });
  }

  try {
    const { data, error } = await supabase
      .from('rides')
      .select('ride_id,duration,distance,avg_speed,calories,start_time')
      .eq('user_id', userId)
      .gte('start_time', getTimeframeStart(timeframe));

    if (error) {
      console.error('Dashboard summary query failed:', error);
      return res.status(500).json({ message: 'Failed to fetch dashboard summary' });
    }

    const rides = data || [];
    const totalDuration = rides.reduce((total, ride) => total + toNumber(ride.duration), 0);
    const totalDistance = rides.reduce((total, ride) => total + toNumber(ride.distance), 0);
    const totalCalories = rides.reduce((total, ride) => total + toNumber(ride.calories), 0);
    const speedRows = rides.filter((ride) => toNumber(ride.avg_speed) > 0);
    const averageSpeed = speedRows.length
      ? speedRows.reduce((total, ride) => total + toNumber(ride.avg_speed), 0) / speedRows.length
      : 0;
    const personalBest = speedRows.length
      ? Math.max(...speedRows.map((ride) => toNumber(ride.avg_speed)))
      : 0;

    return res.json({
      timeframe,
      totalRides: rides.length,
      totalDistanceKm: Number(totalDistance.toFixed(2)),
      totalTimeSeconds: Math.round(totalDuration),
      totalTime: formatRideTime(totalDuration),
      totalCaloriesKcal: Number(totalCalories.toFixed(1)),
      averageSpeedKmh: Number(averageSpeed.toFixed(2)),
      personalBestKmh: Number(personalBest.toFixed(2)),
      rides,
    });
  } catch (error) {
    console.error('Dashboard summary endpoint failed:', error);
    return res.status(500).json({ message: 'Failed to fetch dashboard summary' });
  }
};

export const getDashboardRide = async (req, res) => {
  const { ride_id: rideId } = req.params;

  if (!isUuid(rideId)) {
    return res.status(400).json({ message: 'ride_id must be a valid UUID' });
  }

  try {
    const ride = await fetchRide(rideId);

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    const { data, error } = await supabase
      .from('sensor_data')
      .select('data_id,timestamp,speed,cadence,heart_rate,power')
      .eq('ride_id', rideId)
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('Dashboard ride query failed:', error);
      return res.status(500).json({ message: 'Failed to fetch dashboard ride' });
    }

    return res.json({
      ...ride,
      rideTimeSeconds: calculateRideSeconds(ride),
      rideTime: formatRideTime(calculateRideSeconds(ride)),
      sensorData: data || [],
    });
  } catch (error) {
    console.error('Dashboard ride endpoint failed:', error);
    return res.status(500).json({ message: 'Failed to fetch dashboard ride' });
  }
};
