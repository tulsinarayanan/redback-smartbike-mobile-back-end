import { supabase } from '../config/supabaseClient.js';

const VALID_TIMEFRAMES = new Set(['daily', 'weekly', 'monthly']);
const FALLBACK_PHOTO = 'https://i.pravatar.cc/150?img=14';

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

const toNumber = (value) => {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
};

const formatName = (profile) =>
  profile?.name ||
  profile?.username ||
  profile?.email?.split('@')[0] ||
  'Rider';

const buildLeaderboardRows = (rides) => {
  const groupedRides = new Map();

  rides.forEach((ride) => {
    const userId = ride.user_id;

    if (!userId) return;

    const existing = groupedRides.get(userId) || {
      id: userId,
      profile: ride.profiles,
      distance: 0,
      calories: 0,
      periodRides: 0,
    };

    existing.distance += toNumber(ride.distance);
    existing.calories += toNumber(ride.calories);
    existing.periodRides += 1;

    groupedRides.set(userId, existing);
  });

  return Array.from(groupedRides.values())
    .map((row) => {
      const points = row.distance * 10 + row.calories;

      return {
        id: row.id,
        name: formatName(row.profile),
        photo: row.profile?.avatar_url || FALLBACK_PHOTO,
        email: row.profile?.email || '',
        status: 'Rising',
        badge: 'Consistency',
        distance: Number(row.distance.toFixed(1)),
        points: Math.round(points),
        periodRides: row.periodRides,
      };
    })
    .sort((first, second) => {
      if (second.points !== first.points) {
        return second.points - first.points;
      }

      return second.distance - first.distance;
    })
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
};

export const getLeaderboard = async (req, res) => {
  const requestedTimeframe = req.query.timeframe || 'weekly';
  const timeframe = VALID_TIMEFRAMES.has(requestedTimeframe)
    ? requestedTimeframe
    : 'weekly';

  try {
    const { data, error } = await supabase
      .from('rides')
      .select(`
        user_id,
        distance,
        calories,
        start_time,
        profiles (
          id,
          email,
          name,
          username,
          avatar_url
        )
      `)
      .gte('start_time', getTimeframeStart(timeframe));

    if (error) {
      console.error('Supabase leaderboard query failed:', error);
      return res.status(500).json({
        message: 'Failed to fetch leaderboard data',
      });
    }

    return res.json(buildLeaderboardRows(data || []));
  } catch (error) {
    console.error('Leaderboard endpoint failed:', error);
    return res.status(500).json({
      message: 'Failed to fetch leaderboard data',
    });
  }
};
