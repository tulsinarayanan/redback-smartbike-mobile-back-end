import express from 'express';
import {
  createFriendRequest,
  getFriendRequests,
  getFriends,
  respondToFriendRequest,
} from '../controllers/friendsController.js';

const router = express.Router();

router.get('/', getFriends);
router.get('/requests', getFriendRequests);
router.post('/request', createFriendRequest);
router.post('/respond', respondToFriendRequest);

export default router;
