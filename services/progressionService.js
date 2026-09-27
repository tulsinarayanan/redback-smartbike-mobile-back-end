import { supabase } from '../config/supabaseClient.js';

// XP required per level — Level = floor(XP / 100) + 1
const XP_PER_LEVEL = 100;

export const calculateLevel = (xp) => {
  const safeXp = Number.isFinite(Number(xp)) ? Math.max(0, Number(xp)) : 0;
  return Math.floor(safeXp / XP_PER_LEVEL) + 1;
};

export const getXpProgress = (xp) => {
  const safeXp = Number.isFinite(Number(xp)) ? Math.max(0, Number(xp)) : 0;
  const currentLevelXp = safeXp % XP_PER_LEVEL;
  const xpToNextLevel = XP_PER_LEVEL - currentLevelXp;
  return {
    currentLevelXp,
    xpToNextLevel: currentLevelXp === 0 && safeXp !== 0 ? XP_PER_LEVEL : xpToNextLevel,
    // For display: progress within current level (0-100)
    progressPercent: Math.round((currentLevelXp / XP_PER_LEVEL) * 100),
  };
};

// Fetch current progression for a user
export const getUserProgression = async (userId) => {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, level, xp, streak_days')
    .eq('id', userId)
    .single();

  if (error) throw error;
  if (!profile) throw new Error('Profile not found');

  const xp = profile.xp ?? 0;
  const level = profile.level ?? calculateLevel(xp);
  const streakDays = profile.streak_days ?? 0;
  const { currentLevelXp, xpToNextLevel, progressPercent } = getXpProgress(xp);

  return {
    user_id: profile.id,
    level,
    xp,
    currentLevelXp,
    xpToNextLevel,
    progressPercent,
    streak_days: streakDays,
  };
};

// Add XP when a ride is completed and update level atomically
export const addXpForRide = async (userId, xpGained) => {
  const gained = Number(xpGained);
  if (!Number.isFinite(gained) || gained <= 0) {
    throw new Error('xp_gained must be a positive number');
  }

  // Read current values
  const { data: profile, error: fetchError } = await supabase
    .from('profiles')
    .select('id, xp, level, streak_days')
    .eq('id', userId)
    .single();

  if (fetchError) throw fetchError;
  if (!profile) throw new Error('Profile not found');

  const currentXp = Number(profile.xp) || 0;
  const newXp = currentXp + gained;
  const newLevel = calculateLevel(newXp);

  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({
      xp: newXp,
      level: newLevel,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select('id, level, xp, streak_days')
    .single();

  if (updateError) throw updateError;

  const leveledUp = newLevel > (profile.level || calculateLevel(currentXp));
  const { currentLevelXp, xpToNextLevel, progressPercent } = getXpProgress(newXp);

  return {
    user_id: updated.id,
    previousXp: currentXp,
    previousLevel: profile.level || calculateLevel(currentXp),
    level: updated.level,
    xp: updated.xp,
    xp_gained: gained,
    currentLevelXp,
    xpToNextLevel,
    progressPercent,
    streak_days: updated.streak_days ?? 0,
    leveledUp,
  };
};
