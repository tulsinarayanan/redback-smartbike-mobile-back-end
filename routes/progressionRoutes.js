import express from 'express';
import { completeRide, getProgression } from '../controllers/progressionController.js';

const router = express.Router();

// GET /api/progression/:user_id  and  GET /api/progression?user_id=...
router.get('/', getProgression);
router.get('/:user_id', getProgression);

// POST /api/progression/ride-complete  { user_id, xp_gained }
router.post('/ride-complete', completeRide);

export default router;
