import { supabase } from '../config/supabaseClient.js';
import { exportUserTrainingFeatures, get7DaySummary } from './mlPipelineService.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const buildSystemPrompt = (context) => {
  const { profile, latestRide, latestAnalytics, sevenDay, userMessage } = context;
  const name = profile.name || 'Rider';
  const weight = profile.weight != null ? `${profile.weight} kg` : 'unknown';
  const level = profile.level ?? 'N/A';
  const hrZones = latestAnalytics
    ? `Z1 Recovery ${latestAnalytics.hr_zone_1_recovery_sec}s, Z2 Aerobic ${latestAnalytics.hr_zone_2_aerobic_sec}s, Z3 Tempo ${latestAnalytics.hr_zone_3_tempo_sec}s, Z4 Threshold ${latestAnalytics.hr_zone_4_threshold_sec}s, Z5 Anaerobic ${latestAnalytics.hr_zone_5_anaerobic_sec}s`
    : 'No HR zone data yet';
  const peak = latestAnalytics
    ? `5s ${latestAnalytics.peak_power_5s}W, 1m ${latestAnalytics.peak_power_1m}W, 5m ${latestAnalytics.peak_power_5m}W, NP ${latestAnalytics.normalized_power}W, IF ${latestAnalytics.intensity_factor}`
    : 'No power data yet';
  const duration = latestRide ? `${Math.round(toNum(latestRide.duration, 0) / 60)} min (${toNum(latestRide.duration, 0)}s), ${toNum(latestRide.distance, 0)} km at ${toNum(latestRide.avg_speed, 0)} km/h` : 'No rides yet';
  const seven = sevenDay
    ? `${sevenDay.ride_count} rides, ${sevenDay.total_distance_km} km, ${sevenDay.total_duration_min} min, ${sevenDay.total_calories} kcal, avg IF ${sevenDay.avg_intensity_factor}, total work ${sevenDay.total_work_kj} kJ`
    : 'No 7-day data';

  return `You are Healthy Bot — Your SmartBike AI Health & Performance Coach, an elite cycling performance coach for Redback SmartBike.

RIDER CONTEXT (injected, do not hallucinate):
- Rider: ${name} (Level ${level}, Weight ${weight})
- Latest ride: ${duration}
- Latest ride HR zones: ${hrZones}
- Latest ride peak power: ${peak}
- 7-day workload/fatigue: ${seven}

SYSTEM INSTRUCTIONS:
Tone: Enthusiastic, supportive, concise peer-coach. Speak in fluid conversational prose. Never output diagnostic tables, metric checklists, or raw key-value logs unless specifically asked for numerical breakdown. Weave metrics naturally into fluid sentences.
Identity: Always respond as Healthy Bot — Your SmartBike AI Health & Performance Coach. Be warm, direct, and motivating like a personal trainer talking post-workout.
Style: 2-3 natural paragraphs, address the rider by first name, translate numbers into human insights (e.g., "about 12 minutes in tempo at ~220W" not "Z3 Tempo 725s"). If power/HR is missing or 0, describe the ride by duration/distance/speed only.
Guidance: If Zones 4+5 >25% advise recovery; if IF >0.85 flag strain and prescribe easy spin; if 7-day volume low suggest progressive overload. Give 1-2 actionable next-workout ideas woven into prose, not tables.
Do not add robotic headers, raw dumps like "HR Zones (sec): Z1 0 | Z2 0", or meta footers like metrics disclaimers. No meta introductions — just talk directly to the rider.

USER MESSAGE: "${userMessage}"

Respond in direct, friendly chat style as Healthy Bot. If unrelated to cycling, politely redirect to training.`;
};

const ruleBasedCoach = (context) => {
  const { profile, latestRide, latestAnalytics, sevenDay, userMessage } = context;
  const fullName = profile.name || 'rider';
  const firstName = String(fullName).trim().split(/\s+/)[0] || 'rider';
  const zones = latestAnalytics || {};
  const np = toNum(zones.normalized_power, 0);
  const ifVal = toNum(zones.intensity_factor, 0);
  const totalZoneSec =
    toNum(zones.hr_zone_1_recovery_sec, 0) +
    toNum(zones.hr_zone_2_aerobic_sec, 0) +
    toNum(zones.hr_zone_3_tempo_sec, 0) +
    toNum(zones.hr_zone_4_threshold_sec, 0) +
    toNum(zones.hr_zone_5_anaerobic_sec, 0);
  const hasPower = np > 0 || toNum(zones.peak_power_5s, 0) > 0 || toNum(zones.max_power, 0) > 0;
  const hasHr = totalZoneSec > 0;
  const durationSec = latestRide ? toNum(latestRide.duration, 0) : 0;
  const durationMin = Math.round(durationSec / 60) || 0;
  const distanceKm = latestRide ? toNum(latestRide.distance, 0) : 0;
  const avgSpeed = latestRide ? toNum(latestRide.avg_speed, 0) : 0;
  const lowerMsg = String(userMessage || '').toLowerCase();
  const asksTomorrow = lowerMsg.includes('tomorrow') || lowerMsg.includes('next') || lowerMsg.includes('recovery') || lowerMsg.includes('interval');
  const asksHr = lowerMsg.includes('hr zone') || lowerMsg.includes('heart rate') || lowerMsg.includes('zone');

  const fmtMin = (sec) => {
    const m = Math.round(sec / 60);
    if (m <= 0) return 'a few seconds';
    if (m === 1) return 'about a minute';
    return `about ${m} minutes`;
  };
  const fmtDistance = (km) => (km ? `${km} km` : '');
  const fmtSpeed = (spd) => (spd ? `around ${Math.round(spd)} km/h` : '');

  // Build paragraph 1: warm greeting + human ride summary
  let p1 = '';
  if (!latestRide) {
    p1 = `Hey ${firstName}! I don't see any rides logged yet, but I'm excited to get you rolling. Once you get your first spin in, I'll be able to track your tempo, power and recovery needs and tailor every suggestion to you.`;
  } else if (!hasPower && !hasHr) {
    // GPS-only ride
    const distPart = fmtDistance(distanceKm);
    const speedPart = fmtSpeed(avgSpeed);
    p1 = `Hey ${firstName}! You knocked out a quick ${durationMin || 15}-minute spin${distPart ? ` covering ${distPart}` : ''}${speedPart ? ` at a solid ${speedPart} average` : ''} — nice work getting out there! It was a clean GPS ride without power or heart rate data, so we kept it simple and focused on time in the saddle.`;
  } else {
    const parts = [];
    parts.push(`Hey ${firstName}! You logged a great session today`);
    if (durationMin) parts.push(` — ${fmtMin(durationSec)} and ${fmtDistance(distanceKm) || 'a good distance'}`);
    if (avgSpeed) parts.push(` at ${fmtSpeed(avgSpeed)}`);
    let sentence = parts.join('') + '.';

    if (hasHr && totalZoneSec > 0) {
      // find dominant zone
      const z = {
        z1: toNum(zones.hr_zone_1_recovery_sec, 0),
        z2: toNum(zones.hr_zone_2_aerobic_sec, 0),
        z3: toNum(zones.hr_zone_3_tempo_sec, 0),
        z4: toNum(zones.hr_zone_4_threshold_sec, 0),
        z5: toNum(zones.hr_zone_5_anaerobic_sec, 0),
      };
      const tempoSec = z.z3;
      const z4z5Sec = z.z4 + z.z5;
      if (tempoSec > 60 && tempoSec >= z4z5Sec) {
        sentence += ` You spent ${fmtMin(tempoSec)} grinding in your tempo zone with steady power output around ${np || toNum(zones.peak_power_5m, 0) || 180} watts — that's perfect aerobic work.`;
      } else if (z4z5Sec > 60) {
        sentence += ` You spent ${fmtMin(z4z5Sec)} pushing into your threshold and anaerobic zones, so you definitely dug deep today.`;
      } else if (z.z2 > 60) {
        sentence += ` Most of your effort stayed smooth and aerobic, with ${fmtMin(z.z2)} in that comfortable endurance rhythm.`;
      } else if (hasPower) {
        sentence += ` Your power was steady around ${np} watts with a peak burst near ${toNum(zones.peak_power_5s, 0) || toNum(zones.max_power, 0)} watts.`;
      }
    } else if (hasPower) {
      sentence += ` You held steady power around ${np} watts and even touched about ${toNum(zones.peak_power_5s, 0) || toNum(zones.max_power, 0)} watts at your peak — strong effort!`;
    }
    p1 = sentence;
  }

  // Build paragraph 2: insight about load / fatigue / HR nuance
  let p2 = '';
  const z4 = toNum(zones.hr_zone_4_threshold_sec, 0);
  const z5 = toNum(zones.hr_zone_5_anaerobic_sec, 0);
  const z4z5Pct = totalZoneSec > 0 ? ((z4 + z5) / totalZoneSec) * 100 : 0;
  const sevenRides = sevenDay ? sevenDay.ride_count : 0;
  const sevenDist = sevenDay ? sevenDay.total_distance_km : 0;
  const avgIF = sevenDay ? sevenDay.avg_intensity_factor : 0;

  if (hasHr && asksHr) {
    // Specific HR answer
    if (!hasHr) {
      p2 = `For heart rate today, we didn't get zone data from this ride, so I can't break it down yet — once your sensor syncs, I'll show you exactly how your time split between recovery and tempo.`;
    } else {
      const z1 = toNum(zones.hr_zone_1_recovery_sec, 0);
      const z2 = toNum(zones.hr_zone_2_aerobic_sec, 0);
      const z3 = toNum(zones.hr_zone_3_tempo_sec, 0);
      const pct = (v) => (totalZoneSec ? Math.round((v / totalZoneSec) * 100) : 0);
      p2 = `Your heart rate today lived mostly in tempo — about ${pct(z3)}% of your ride was right in that strong aerobic zone, with a nice mix of ${fmtMin(z2)} easy aerobic and ${fmtMin(z1)} gentle recovery. You barely touched threshold, so your cardio load stayed nicely controlled.`;
      if (z4z5Pct > 20) p2 = `Today your heart rate shows you were working hard — about ${Math.round(z4z5Pct)}% of your time was up in threshold and anaerobic, which explains why that ride felt spicy. Great stimulus, but it does add fatigue.`;
    }
  } else if (hasPower || hasHr) {
    if (ifVal > 0.9) {
      p2 = `That was a seriously hard effort, ${firstName} — your intensity was right up near race level, so your body will need a little extra care tonight. Across the last week you've logged ${sevenRides} ride${sevenRides === 1 ? '' : 's'} and ${sevenDist} km, so overall fatigue is building.`;
    } else if (ifVal > 0.85 || z4z5Pct > 25) {
      p2 = `You pushed into those harder zones quite a bit today, which is great for fitness but also adds strain. With ${sevenDist} km over the last ${sevenRides || 1} ride${sevenRides === 1 ? '' : 's'} this week, you're sitting at a solid, steady workload — not overdoing it, just enough to keep adapting.`;
    } else if (sevenRides <= 1) {
      p2 = `Overall your week has been light with just ${sevenDist} km, so this was a perfect stimulus to keep momentum without piling on fatigue. Your effort stayed nicely in that sustainable range where you build fitness without burning out.`;
    } else {
      p2 = `Your workload this week has been steady at ${sevenDist} km across ${sevenRides} rides, averaging an easy-to-moderate intensity around ${avgIF}. That tells me you're balancing effort and recovery really well right now.`;
    }
  } else {
    p2 = `With ${sevenDist} km in the last week, you're building consistency, and that's the most important foundation. Keep stacking those regular spins and the fitness will follow quickly.`;
  }

  // Build paragraph 3: forward-looking recommendation, answering tomorrow question
  let p3 = '';
  if (asksTomorrow || lowerMsg.includes('tomorrow') || lowerMsg.includes('should i')) {
    if (ifVal > 0.85 || z4z5Pct > 25 || avgIF > 0.8) {
      p3 = `Looking ahead to tomorrow, ${firstName}, since your recent effort was on the high side, I'd recommend an easy recovery spin to keep your legs fresh — think 30 to 40 minutes super easy, just spinning and breathing. It'll flush the fatigue and set you up perfectly for intervals the day after.`;
    } else if (sevenRides <= 1 || sevenDist < 20) {
      p3 = `Looking ahead to tomorrow, you're fresh enough to add a little spice, ${firstName} — try a fun interval set, like 4 times 3 minutes at a comfortably hard pace with full recoveries. It'll nudge your fitness forward without wiping you out.`;
    } else {
      p3 = `Looking ahead to tomorrow, a balanced day would be ideal, ${firstName} — maybe 35 to 45 minutes mixing easy pedaling with a couple of short tempo bursts. It keeps you moving without adding extra fatigue.`;
    }
  } else if (lowerMsg.includes('recovery')) {
    p3 = `For recovery, ${firstName}, give yourself tonight to recharge — good sleep, plenty of water and protein, and a gentle 30-minute spin tomorrow will do wonders for your legs.`;
  } else if (!latestRide) {
    p3 = `When you're ready, start with a relaxed 20-minute ride to establish your baseline, then we can build from there together — you've got this!`;
  } else {
    p3 = `For your next ride, keep it enjoyable, ${firstName} — a 40-minute easy endurance spin with maybe two short tempo efforts will build on today perfectly. Listen to your legs, stay hydrated, and you'll be ready to push again soon.`;
  }

  return `${p1}\n\n${p2}\n\n${p3}`;
};

const callGemini = async (systemPrompt) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
  const body = {
    contents: [{ parts: [{ text: systemPrompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      console.warn('[aiCoach] Gemini error', res.status, JSON.stringify(json).slice(0, 500));
      return null;
    }
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text && typeof text === 'string' && text.trim()) return text.trim();
    return null;
  } catch (e) {
    console.warn('[aiCoach] Gemini fetch failed', e.message);
    return null;
  }
};

export const getChatReply = async ({ user_id, message }) => {
  const uid = String(user_id || '').trim();
  const msg = String(message || '').trim();
  if (!UUID_REGEX.test(uid)) {
    const err = new Error('user_id must be a valid UUID');
    err.status = 400;
    throw err;
  }
  if (!msg) {
    const err = new Error('message is required');
    err.status = 400;
    throw err;
  }

  // Step 1: Context Retrieval
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, age, weight, height, level, xp')
    .eq('id', uid)
    .single();

  if (profileError || !profile) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const { data: latestRide } = await supabase
    .from('rides')
    .select('ride_id, user_id, start_time, end_time, duration, distance, avg_speed, calories')
    .eq('user_id', uid)
    .order('start_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  let latestAnalytics = null;
  if (latestRide?.ride_id) {
    const { data: analytics } = await supabase
      .from('ride_analytics')
      .select(
        'ride_id, hr_zone_1_recovery_sec, hr_zone_2_aerobic_sec, hr_zone_3_tempo_sec, hr_zone_4_threshold_sec, hr_zone_5_anaerobic_sec, peak_power_5s, peak_power_1m, peak_power_5m, normalized_power, intensity_factor, avg_cadence, max_heart_rate, max_power'
      )
      .eq('ride_id', latestRide.ride_id)
      .maybeSingle();
    latestAnalytics = analytics || null;
  }

  // 7-day summary via ml pipeline (reuse, fallback to computed summary if fails)
  let sevenDay = null;
  try {
    sevenDay = await get7DaySummary(uid);
  } catch {
    sevenDay = { total_distance_km: 0, total_duration_min: 0, total_calories: 0, ride_count: 0, avg_intensity_factor: 0, total_work_kj: 0 };
  }

  const context = { profile, latestRide, latestAnalytics, sevenDay, userMessage: msg };
  const context_used = {
    profile: { id: profile.id, name: profile.name, weight: profile.weight, level: profile.level },
    latest_ride: latestRide
      ? { ride_id: latestRide.ride_id, duration_sec: latestRide.duration, distance_km: latestRide.distance, avg_speed: latestRide.avg_speed }
      : null,
    latest_analytics: latestAnalytics
      ? {
          hr_zones_sec: {
            z1: latestAnalytics.hr_zone_1_recovery_sec,
            z2: latestAnalytics.hr_zone_2_aerobic_sec,
            z3: latestAnalytics.hr_zone_3_tempo_sec,
            z4: latestAnalytics.hr_zone_4_threshold_sec,
            z5: latestAnalytics.hr_zone_5_anaerobic_sec,
          },
          peak_power_5s: latestAnalytics.peak_power_5s,
          peak_power_1m: latestAnalytics.peak_power_1m,
          peak_power_5m: latestAnalytics.peak_power_5m,
          normalized_power: latestAnalytics.normalized_power,
          intensity_factor: latestAnalytics.intensity_factor,
        }
      : null,
    seven_day_summary: sevenDay,
  };

  // Step 2: Prompt Orchestration
  const systemPrompt = buildSystemPrompt(context);

  // Step 3: Execution with Zero-Cost Fallback
  let reply = null;
  if (process.env.GEMINI_API_KEY) {
    reply = await callGemini(systemPrompt);
  }
  if (!reply) {
    reply = ruleBasedCoach(context);
  }

  return { reply, context_used };
};
