import mqtt from 'mqtt';
import { supabase } from '../config/supabaseClient.js';

const DEFAULT_CONTROL_TOPIC = 'bike/000001/control';
const DEFAULT_SENSOR_TOPIC = 'bike/000001/sensor';
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const mqttState = {
  enabled: false,
  connected: false,
  subscribedTopics: [],
  lastMessageAt: null,
  lastError: null,
};

let mqttClient = null;

const toNumberOrNull = (value) => {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
};

const toTimestamp = (value) => {
  if (!value) return new Date().toISOString();

  const date = typeof value === 'number' ? new Date(value) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
};

const getTopics = () => [
  process.env.MQTT_CONTROL_TOPIC || DEFAULT_CONTROL_TOPIC,
  process.env.MQTT_SENSOR_TOPIC || DEFAULT_SENSOR_TOPIC,
];

const parsePayload = (payload) => {
  if (typeof payload === 'string') {
    return JSON.parse(payload);
  }

  if (Buffer.isBuffer(payload)) {
    return JSON.parse(payload.toString('utf8'));
  }

  if (payload && typeof payload === 'object') {
    return payload;
  }

  throw new Error('Payload must be a JSON object');
};

export const mapMqttPayloadToSensorData = (topic, payload) => {
  const speed = toNumberOrNull(payload.speed);
  const cadence = toNumberOrNull(payload.cadence);
  const heartRate = toNumberOrNull(payload.heart_rate?.bpm ?? payload.heart_rate);
  const power = toNumberOrNull(payload.power);
  const rideId = payload.ride_id && UUID_REGEX.test(payload.ride_id)
    ? payload.ride_id
    : null;

  const insertRow = {
    ride_id: rideId,
    timestamp: toTimestamp(payload.ts || payload.timestamp),
    speed,
    cadence,
    heart_rate: heartRate,
    power,
  };

  const hasSensorValue = [speed, cadence, heartRate, power].some(
    (value) => value !== null,
  );

  return {
    topic,
    device: payload.device || null,
    insertRow,
    hasSensorValue,
  };
};

export const handleIotMessage = async (topic, rawPayload, options = {}) => {
  const { dryRun = false } = options;

  if (!topic) {
    return {
      ok: false,
      inserted: false,
      message: 'topic is required',
    };
  }

  const subscribedTopics = getTopics();

  if (!subscribedTopics.includes(topic)) {
    return {
      ok: false,
      inserted: false,
      message: `Unsupported topic: ${topic}`,
      subscribedTopics,
    };
  }

  let payload;

  try {
    payload = parsePayload(rawPayload);
  } catch (error) {
    return {
      ok: false,
      inserted: false,
      message: 'Invalid JSON payload',
      error: error.message,
    };
  }

  const mapped = mapMqttPayloadToSensorData(topic, payload);
  mqttState.lastMessageAt = new Date().toISOString();

  if (!mapped.hasSensorValue) {
    return {
      ok: true,
      inserted: false,
      message: 'No supported sensor fields found',
      mapped,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      inserted: false,
      message: 'Dry run only',
      mapped,
    };
  }

  const { data, error } = await supabase
    .from('sensor_data')
    .insert(mapped.insertRow)
    .select('data_id,ride_id,timestamp,speed,cadence,heart_rate,power,updated_at')
    .single();

  if (error) {
    return {
      ok: false,
      inserted: false,
      message: 'Failed to insert sensor data',
      error: error.message,
      mapped,
    };
  }

  return {
    ok: true,
    inserted: true,
    message: 'Sensor data inserted',
    mapped,
    data,
  };
};

export const startMqttService = () => {
  mqttState.enabled = process.env.MQTT_ENABLED === 'true';
  mqttState.subscribedTopics = getTopics();

  if (!mqttState.enabled) {
    return mqttState;
  }

  if (mqttClient) {
    return mqttState;
  }

  const host = process.env.MQTT_HOST;
  if (!host) {
    mqttState.enabled = false;
    mqttState.lastError = 'MQTT_HOST is required when MQTT_ENABLED=true';
    console.warn(mqttState.lastError);
    return mqttState;
  }

  const port = Number(process.env.MQTT_PORT || 1883);
  const url = `mqtt://${host}:${port}`;

  mqttClient = mqtt.connect(url, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    reconnectPeriod: 10000,
    connectTimeout: 5000,
  });

  mqttClient.on('connect', () => {
    mqttState.connected = true;
    mqttState.lastError = null;
    mqttClient.subscribe(mqttState.subscribedTopics, (error) => {
      if (error) {
        mqttState.lastError = error.message;
        console.warn('MQTT subscription failed:', error.message);
        return;
      }
    });
  });

  mqttClient.on('message', async (topic, message) => {
    const result = await handleIotMessage(topic, message);

    if (!result.ok) {
      console.warn('MQTT message ignored:', result.message, result.error || '');
    }
  });

  mqttClient.on('error', (error) => {
    mqttState.connected = false;
    mqttState.lastError = error.message;
    console.warn('MQTT broker connection warning:', error.message);
  });

  mqttClient.on('offline', () => {
    mqttState.connected = false;
  });

  mqttClient.on('close', () => {
    mqttState.connected = false;
  });

  return mqttState;
};

export const getMqttStatus = () => ({
  mqttEnabled: mqttState.enabled,
  mqttConnected: mqttState.connected,
  subscribedTopics: mqttState.subscribedTopics,
  lastMessageAt: mqttState.lastMessageAt,
  lastError: mqttState.lastError,
});
