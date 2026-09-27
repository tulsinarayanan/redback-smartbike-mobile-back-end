import { supabase } from '../config/supabaseClient.js';
import { processRideAnalytics } from '../services/analyticsService.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const getRideAnalytics = async (req, res) => {
  const rideId = req.params.ride_id || req.params.rideId;

  if (!rideId || !UUID_REGEX.test(String(rideId))) {
    return res.status(400).json({ message: 'ride_id must be a valid UUID' });
  }

  try {
    // Check ride exists
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('ride_id')
      .eq('ride_id', rideId)
      .single();

    if (rideError || !ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    // Fetch pre-computed analytics
    const { data: analytics, error } = await supabase
      .from('ride_analytics')
      .select('*')
      .eq('ride_id', rideId)
      .single();

    if (analytics && !error) {
      return res.json(analytics);
    }

    // No analytics yet — handle missing table gracefully
    if (error && !String(error.message || '').includes('does not exist') && error.code !== 'PGRST116') {
      // PGRST116 = no rows; otherwise log
      if (error.code && error.code !== 'PGRST116') {
        console.error('Analytics fetch failed:', error);
        return res.status(500).json({ message: 'Failed to fetch analytics' });
      }
    }

    // Lazily trigger computation (async) and return processing status
    // Fire-and-forget, but also attempt synchronous compute for immediate response if fast
    try {
      // If client wants immediate result, try processing now with timeout handled by async
      // We trigger async and return 202
      void processRideAnalytics(rideId).catch((e) => {
        console.error(`[analyticsController] lazy process failed for ${rideId}:`, e.message || e);
      });
    } catch (e) {
      console.error('[analyticsController] trigger failed:', e.message || e);
    }

    return res.status(202).json({
      ride_id: rideId,
      status: 'processing',
      message: 'Analytics is being computed. Retry shortly.',
    });
  } catch (err) {
    console.error('Get analytics failed:', err);
    if (String(err.message || '').includes('does not exist')) {
      return res.status(500).json({ message: 'ride_analytics table not migrated. Run database/analytics.sql' });
    }
    return res.status(500).json({ message: 'Failed to fetch analytics' });
  }
};
