import express from 'express';
import { exportDataset } from '../controllers/mlController.js';

const router = express.Router();

router.get('/export', exportDataset);

export default router;
