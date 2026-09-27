import { supabase } from '../config/supabaseClient.js';
import { addXpForRide, calculateLevel, getUserProgression, getXpProgress } from '../services/progressionService.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUuid = (value) => UUID_REGEX.test(String(value || ''));

// GET /api/progression/:user_id  or  GET /api/progression?user_id=...
export const getProgression = async (req, res) => {
  const userId = req.params.user_id || req.query.user_id;

  if (!userId) {
    return res.status(400).json({ message: 'user_id is required' });
  }
  if (!isValidUuid(userId)) {
    return res.status(400).json({ message: 'user_id must be a valid UUID' });
  }

  try {
    const progression = await getUserProgression(userId);

    // Also fetch unlocked achievements for this user (if tables exist)
    let achievements = [];
    try {
      const { data, error } = await supabase
        .from('user_achievements')
        .select('id, unlocked_at, achievements (id, name, description, xp_reward, icon)')
        .eq('user_id', userId);
      if (!error && data) {
        achievements = data.map((row) => ({
          id: row.id,
          unlocked_at: row.unlocked_at,
          ...(row.achievements || {}),
        }));
      }
    } catch {
      // tables may not exist yet before migration — ignore
    }

    return res.json({ ...progression, achievements });
  } catch (error) {
    // Graceful fallback if progression columns not yet migrated
    if (String(error.message || '').includes('column') && String(error.message).includes('does not exist')) {
      const fallbackXp = 0;
      const { currentLevelXp, xpToNextLevel, progressPercent } = getXpProgress(fallbackXp);
      return res.json({
        user_id: userId,
        level: calculateLevel(fallbackXp),
        xp: fallbackXp,
        currentLevelXp,
        xpToNextLevel,
        progressPercent,
        streak_days: 0,
        achievements: [],
        _migrated: false,
        _note: 'Run database/progression.sql to enable progression columns',
      });
    }
    console.error('Get progression failed:', error);
    return res.status(500).json({ message: 'Failed to fetch progression' });
  }
};

// POST /api/progression/ride-complete
// Body: { user_id, xp_gained, ride_id? }
export const completeRide = async (req, res) => {
  const { user_id: userId, xp_gained: xpGained, xp, ride_id: rideId } = req.body || {};
  const gained = xpGained ?? xp;

  if (!userId) {
    return res.status(400).json({ message: 'user_id is required' });
  }
  if (!isValidUuid(userId)) {
    return res.status(400).json({ message: 'user_id must be a valid UUID' });
  }
  if (gained === undefined || gained === null || String(gained).trim() === '') {
    return res.status(400).json({ message: 'xp_gained is required' });
  }

  const numericGain = Number(gained);
  if (!Number.isFinite(numericGain) || numericGain <= 0) {
    return res.status(400).json({ message: 'xp_gained must be a positive number' });
  }

  try {
    const result = await addXpForRide(userId, numericGain);

    // Optionally record ride linkage if ride_id supplied and valid
    if (rideId && isValidUuid(rideId)) {
      // No extra write required — link is optional. Could be extended to update rides table.
    }

    return res.json(result);
  } catch (error) {
    if (String(error.message || '').includes('column') && String(error.message).includes('does not exist')) {
      return res.status(500).json({
        message: 'Progression columns not yet migrated. Run database/progression.sql',
      });
    }
    if (error.message === 'Profile not found') {
      return res.status(404).json({ message: 'Profile not found' });
    }
    if (error.message === 'xp_gained must be a positive number') {
      return res.status(400).json({ message: error.message });
    }
    console.error('Complete ride failed:', error);
    return res.status(500).json({ message: 'Failed to update progression' });
  }
};
