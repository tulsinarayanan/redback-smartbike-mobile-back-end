import express from 'express';
import {
  createConversation,
  getConversations,
  getMessages,
  sendMessage,
} from '../controllers/chatController.js';

const router = express.Router();

router.get('/conversations', getConversations);
router.post('/conversations', createConversation);
router.get('/conversations/:conversation_id/messages', getMessages);
router.post('/messages', sendMessage);

export default router;
