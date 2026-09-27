# Smart Ride Dashboard APIs

These endpoints support the Unity Smart Ride Analytics HUD and future dashboard screens.

## Ride Lifecycle

### Start Ride

```http
POST /api/rides/start
```

Request body:

```json
{
  "user_id": "profile-uuid"
}
```

Response:

```json
{
  "ride_id": "ride-uuid",
  "user_id": "profile-uuid",
  "start_time": "2026-08-19T10:00:00.000Z",
  "end_time": null,
  "duration": 0,
  "distance": 0,
  "avg_speed": 0,
  "calories": 0
}
```

### End Ride

```http
POST /api/rides/:ride_id/end
```

Request body:

```json
{
  "duration": 1849,
  "distance": 12.95,
  "avg_speed": 28.4,
  "calories": 220
}
```

The backend also checks related `sensor_data` rows to report sample count, max speed, and average power.

### Get Ride Details

```http
GET /api/rides/:ride_id
```

Returns the ride summary, latest sensor data, sensor summary, and full sensor history for that ride.

## Dashboard Data

### HUD Values

```http
GET /api/dashboard/hud?ride_id=<ride-id>&gear=6&target_distance_km=30
```

For first-time local testing without Supabase data, use:

```http
GET /api/dashboard/hud?mock=true&gear=6
```

Returns the latest values needed by the Unity HUD:

```json
{
  "rideId": "ride-uuid",
  "currentSpeedKmh": 23.45,
  "cadenceRpm": 82,
  "heartRateBpm": 142,
  "powerWatts": 180,
  "currentGear": 6,
  "distanceKm": 3.41,
  "caloriesKcal": 167,
  "rideTimeSeconds": 763,
  "rideTime": "00:12:43",
  "averageSpeedKmh": 24.1,
  "maxSpeedKmh": 31.2,
  "progressPercent": 72,
  "sampleCount": 20
}
```

### User Summary

```http
GET /api/dashboard/summary?user_id=<profile-id>&timeframe=weekly
```

Supported timeframes:

- `daily`
- `weekly`
- `monthly`

Returns total rides, total distance, total time, calories, average speed, and personal best.

### Dashboard Ride Details

```http
GET /api/dashboard/ride/:ride_id
```

Returns trip details and sensor history for dashboard charts.

## IoT Simulation Test

Use this existing endpoint to insert or dry-run live sensor data:

```http
POST /api/iot/simulate
```

Body:

```json
{
  "topic": "bike/000001/sensor",
  "payload": {
    "ride_id": "ride-uuid",
    "speed": 23.45,
    "cadence": 82,
    "heart_rate": {
      "bpm": 142
    },
    "power": 180,
    "ts": 1710000000000
  },
  "dryRun": false
}
```

Use `"dryRun": true` if you only want to check the mapping without inserting into Supabase.
