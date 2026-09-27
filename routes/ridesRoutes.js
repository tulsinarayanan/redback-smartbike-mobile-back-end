import express from 'express';
import {
  endRide,
  getRide,
  getUserStats,
  getUserSummary,
  startRide,
} from '../controllers/ridesController.js';

const router = express.Router();

router.get('/stats/:userId', getUserStats);
router.get('/summary/:userId', getUserSummary);
router.post('/start', startRide);
router.post('/:ride_id/end', endRide);
router.get('/:ride_id', getRide);

export default router;
