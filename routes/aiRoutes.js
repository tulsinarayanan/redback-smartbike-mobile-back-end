import express from 'express';
import { chat } from '../controllers/aiCoachController.js';

const router = express.Router();

router.post('/coach/chat', chat);

export default router;
