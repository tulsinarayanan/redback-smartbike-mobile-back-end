import { createRide, getRidesForUser, validateRidePayload } from '../services/rideService.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const logRide = async (req, res) => {
  const payload = req.body || {};
  const { valid, message } = validateRidePayload(payload);
  if (!valid) return res.status(400).json({ message });

  try {
    const ride = await createRide(payload);
    return res.status(201).json(ride);
  } catch (error) {
    console.error('Create ride failed:', error);
    if (String(error.message || '').includes('invalid input syntax for type uuid')) {
      return res.status(400).json({ message: 'Invalid user_id' });
    }
    return res.status(500).json({ message: 'Failed to log ride' });
  }
};

export const getRides = async (req, res) => {
  const userId = req.query.user_id || req.params.user_id;
  if (!userId) return res.status(400).json({ message: 'user_id is required' });
  if (!UUID_REGEX.test(String(userId))) return res.status(400).json({ message: 'user_id must be a valid UUID' });

  const limit = req.query.limit || 10;
  try {
    const rides = await getRidesForUser(userId, limit);
    return res.json(rides);
  } catch (error) {
    console.error('Get rides failed:', error);
    return res.status(500).json({ message: 'Failed to fetch rides' });
  }
};
