import express from 'express';
import {
  getDashboardHud,
  getDashboardRide,
  getDashboardSummary,
} from '../controllers/dashboardController.js';

const router = express.Router();

router.get('/hud', getDashboardHud);
router.get('/summary', getDashboardSummary);
router.get('/ride/:ride_id', getDashboardRide);

export default router;
