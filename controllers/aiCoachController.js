import { getChatReply } from '../services/aiCoachService.js';

export const chat = async (req, res) => {
  const { user_id, message } = req.body || {};
  try {
    const result = await getChatReply({ user_id, message });
    return res.json(result);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ message: err.message });
    if (err.status === 404) return res.status(404).json({ message: err.message });
    console.error('AI coach chat failed:', err);
    return res.status(500).json({ message: 'Failed to process coaching request' });
  }
};
