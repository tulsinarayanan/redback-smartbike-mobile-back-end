import { exportUserTrainingFeatures } from '../services/mlPipelineService.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toCsv = (records) => {
  if (!records.length) return '';
  // Flatten key set (top-level + nested flattened)
  const headers = [
    'ride_id',
    'user_id',
    'start_time',
    'end_time',
    'duration_sec',
    'distance_km',
    'avg_speed_kmh',
    'calories',
    'work_kj',
    'normalized_power',
    'intensity_factor',
    'peak_power_5s',
    'peak_power_1m',
    'peak_power_5m',
    'avg_cadence',
    'max_heart_rate',
    'max_power',
    'weight_kg',
    'level',
    'power_to_weight_normalized',
    'power_to_weight_peak_5s',
    'power_to_weight_peak_1m',
    'power_to_weight_peak_5m',
    'power_to_weight_max',
    'hr_zone_1_pct',
    'hr_zone_2_pct',
    'hr_zone_3_pct',
    'hr_zone_4_pct',
    'hr_zone_5_pct',
    '7_day_distance_km',
    '7_day_duration_sec',
    '7_day_calories',
    '7_day_ride_count',
  ];
  const escape = (v) => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of records) {
    const row = [
      r.ride_id,
      r.user_id,
      r.start_time,
      r.end_time,
      r.duration_sec,
      r.distance_km,
      r.avg_speed_kmh,
      r.calories,
      r.work_kj,
      r.normalized_power,
      r.intensity_factor,
      r.peak_power_5s,
      r.peak_power_1m,
      r.peak_power_5m,
      r.avg_cadence,
      r.max_heart_rate,
      r.max_power,
      r.weight_kg,
      r.level,
      r.power_to_weight?.normalized,
      r.power_to_weight?.peak_5s,
      r.power_to_weight?.peak_1m,
      r.power_to_weight?.peak_5m,
      r.power_to_weight?.max,
      r.hr_zone_distribution?.zone_1_recovery_pct,
      r.hr_zone_distribution?.zone_2_aerobic_pct,
      r.hr_zone_distribution?.zone_3_tempo_pct,
      r.hr_zone_distribution?.zone_4_threshold_pct,
      r.hr_zone_distribution?.zone_5_anaerobic_pct,
      r['7_day_load']?.distance_km,
      r['7_day_load']?.duration_sec,
      r['7_day_load']?.calories,
      r['7_day_load']?.ride_count,
    ].map(escape);
    lines.push(row.join(','));
  }
  return lines.join('\n');
};

export const exportDataset = async (req, res) => {
  const userId = String(req.query.user_id || req.query.userId || '').trim();
  const format = String(req.query.format || 'json').toLowerCase();

  if (!userId) {
    return res.status(400).json({ message: 'user_id query param is required' });
  }
  if (!UUID_REGEX.test(userId)) {
    return res.status(400).json({ message: 'user_id must be a valid UUID' });
  }
  if (!['json', 'csv'].includes(format)) {
    return res.status(400).json({ message: 'format must be json or csv' });
  }

  try {
    const records = await exportUserTrainingFeatures(userId);
    if (format === 'csv') {
      const csv = toCsv(records);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="training_features_${userId}.csv"`);
      return res.send(csv);
    }
    return res.json({
      user_id: userId,
      count: records.length,
      records,
    });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ message: err.message });
    if (err.status === 404) return res.status(404).json({ message: err.message });
    console.error('ML export failed:', err);
    return res.status(500).json({ message: 'Failed to export training features' });
  }
};
