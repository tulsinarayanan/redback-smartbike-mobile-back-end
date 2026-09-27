import express from 'express';
import { getRides, logRide } from '../controllers/rideController.js';
import { getRideAnalytics } from '../controllers/analyticsController.js';

const router = express.Router();

// GET /api/rides?user_id=...&limit=...
router.get('/', getRides);

// Analytics must be before generic :user_id param
router.get('/:ride_id/analytics', getRideAnalytics);

router.get('/:user_id', getRides);

// POST /api/rides  — log completed workout
router.post('/', logRide);

// Also support /api/workouts alias for spec compatibility
router.post('/complete', logRide);

export default router;
