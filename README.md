# Redback SmartBike Backend

Node.js / Express backend for SmartBike data APIs. Supabase Auth is handled directly in the frontend; this backend only reads and writes application data.

## Requirements

- Node.js 20+
- npm
- Supabase project with the SmartBike schema applied

## Environment

Create `.env` from `.env.example`.

```env
PORT=5000
SUPABASE_URL=
SUPABASE_ANON_KEY=
MQTT_ENABLED=false
MQTT_HOST=
MQTT_PORT=
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_CONTROL_TOPIC=
MQTT_SENSOR_TOPIC=
```

Do not commit `.env` or real Supabase/MQTT credentials.

## Run

```bash
npm install
npm start
```

The server defaults to port `5000`.

## API Endpoints

- `GET /api/leaderboard?timeframe=daily|weekly|monthly`
- `GET /api/friends?user_id=<profile-id>`
- `GET /api/users/search?q=<query>&current_user_id=<profile-id>`
- `GET /api/friends/requests?user_id=<profile-id>`
- `POST /api/friends/request`
- `POST /api/friends/respond`
- `GET /api/notifications?user_id=<profile-id>`
- `GET /api/chat/conversations?user_id=<profile-id>`
- `POST /api/chat/conversations`
- `GET /api/chat/conversations/:conversation_id/messages`
- `POST /api/chat/messages`
- `GET /api/iot/status`
- `POST /api/iot/simulate`

All API errors should return JSON.

## Company Supabase Setup

1. Open the company Supabase SQL editor.
2. Run `database/schema.sql`.
3. Optional: review `database/seed-demo.sql` for demo data guidance. Create demo users through Supabase Auth first, then replace placeholder UUIDs with real `public.profiles.id` values.
4. Enable Supabase Auth providers needed by the frontend:
   - Email/password
   - Apple, Facebook, or Google only if those OAuth buttons are part of the demo
5. Update backend `.env`:

```env
SUPABASE_URL=<company-supabase-url>
SUPABASE_ANON_KEY=<company-supabase-anon-key>
```

6. Update frontend `.env` with the same company Supabase URL and anon key.

The frontend creates or repairs `public.profiles` rows after signup/login. `public.profiles.id` references `auth.users(id)`.

## Optional MQTT IoT Ingestion

MQTT ingestion is disabled by default. The backend starts normally when `MQTT_ENABLED=false`, even without broker access.

To enable a broker later:

```env
MQTT_ENABLED=true
MQTT_HOST=<broker-host>
MQTT_PORT=1883
MQTT_USERNAME=<broker-username>
MQTT_PASSWORD=<broker-password>
MQTT_CONTROL_TOPIC=bike/000001/control
MQTT_SENSOR_TOPIC=bike/000001/sensor
```

Supported payload examples:

```json
{
  "device": "000001",
  "speed": 23.45,
  "turn": 1,
  "brake": false,
  "ts": 1710000000000
}
```

```json
{
  "device": "000001",
  "heart_rate": {
    "bpm": 142,
    "connected": true,
    "battery": 87
  }
}
```

Payloads are mapped into `sensor_data` using available fields: `speed`, `cadence`, `heart_rate.bpm`, `power`, and `timestamp` from `ts` or `timestamp`. `ride_id` is `null` unless a valid `ride_id` is supplied.

