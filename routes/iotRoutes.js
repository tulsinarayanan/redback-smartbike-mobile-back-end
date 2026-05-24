import express from 'express';
import { getIotStatus, simulateIotMessage } from '../controllers/iotController.js';

const router = express.Router();

router.get('/status', getIotStatus);
router.post('/simulate', simulateIotMessage);

export default router;
