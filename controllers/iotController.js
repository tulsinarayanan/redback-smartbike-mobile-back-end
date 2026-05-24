import { getMqttStatus, handleIotMessage } from '../services/mqttService.js';

export const simulateIotMessage = async (req, res) => {
  const { topic, payload, dryRun = false } = req.body || {};

  if (!topic) {
    return res.status(400).json({ message: 'topic is required' });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ message: 'payload must be a JSON object' });
  }

  try {
    const result = await handleIotMessage(topic, payload, { dryRun });
    const status = result.ok ? 200 : 400;

    return res.status(status).json(result);
  } catch (error) {
    console.error('IoT simulation failed:', error);
    return res.status(500).json({ message: 'Failed to simulate IoT message' });
  }
};

export const getIotStatus = (req, res) => {
  return res.json(getMqttStatus());
};
