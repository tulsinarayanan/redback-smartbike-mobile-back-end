import express from 'express';
import { getRideAnalytics } from '../controllers/analyticsController.js';

const router = express.Router();

router.get('/rides/:ride_id/analytics', getRideAnalytics);

export default router;
