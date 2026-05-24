import { supabase } from '../config/supabaseClient.js';

const FALLBACK_PHOTO = 'https://i.pravatar.cc/150?img=14';
const ACCENTS = ['#fb7185', '#4ade80', '#60a5fa', '#f59e0b', '#c084fc'];
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUuid = (value) => UUID_REGEX.test(String(value || ''));

const toProfileIds = (friendships, userId) =>
  friendships
    .map((friendship) =>
      friendship.requester_id === userId
        ? friendship.addressee_id
        : friendship.requester_id,
    )
    .filter(Boolean);

const formatProfileAsFriend = (profile, index = 0) => ({
  id: profile.id,
  name: profile.name || profile.username || profile.email?.split('@')[0] || 'Rider',
  email: profile.email || '',
  photo: profile.avatar_url || FALLBACK_PHOTO,
  status: 'Active',
  rides: 0,
  accent: ACCENTS[index % ACCENTS.length],
  summary: 'Ready to ride and share progress with your cycling network.',
  latestWorkout: {
    title: 'No recent ride',
    type: 'Cycling',
    distance: '0.0 km',
    duration: '0 min',
    calories: '0 kcal',
    averageSpeed: '0.0 km/h',
    date: new Date().toISOString().slice(0, 10),
    intensity: 'Pending',
  },
  weeklyActivity: WEEK_DAYS.map((day, dayIndex) => ({
    id: `${profile.id}-${day}`,
    day,
    minutes: 0,
  })),
  recentActivities: [],
  engagement: {
    likes: 0,
    comments: 0,
    note: 'No recent engagement yet.',
  },
});

const fetchProfiles = async (ids) => {
  let query = supabase
    .from('profiles')
    .select('id,email,name,username,avatar_url')
    .order('created_at', { ascending: false })
    .limit(50);

  if (ids?.length) {
    query = query.in('id', ids);
  }

  return query;
};

export const getFriends = async (req, res) => {
  const userId = req.query.user_id;

  if (userId && !isValidUuid(userId)) {
    return res.status(400).json({ message: 'user_id must be a valid UUID' });
  }

  try {
    let friendIds = null;

    if (userId) {
      const { data: friendships, error: friendshipsError } = await supabase
        .from('friendships')
        .select('requester_id,addressee_id,status')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

      if (friendshipsError) {
        console.error('Supabase friendships query failed:', friendshipsError);
        return res.status(500).json({ message: 'Failed to fetch friends' });
      }

      friendIds = toProfileIds(friendships || [], userId);

      if (friendIds.length === 0) {
        return res.json([]);
      }
    }

    const { data: profiles, error: profilesError } = await fetchProfiles(friendIds);

    if (profilesError) {
      console.error('Supabase profiles query failed:', profilesError);
      return res.status(500).json({ message: 'Failed to fetch friends' });
    }

    return res.json((profiles || []).map(formatProfileAsFriend));
  } catch (error) {
    console.error('Friends endpoint failed:', error);
    return res.status(500).json({ message: 'Failed to fetch friends' });
  }
};

const findExistingFriendship = async (requesterId, addresseeId) =>
  supabase
    .from('friendships')
    .select('id,requester_id,addressee_id,status')
    .or(
      `and(requester_id.eq.${requesterId},addressee_id.eq.${addresseeId}),and(requester_id.eq.${addresseeId},addressee_id.eq.${requesterId})`,
    )
    .limit(1);

export const createFriendRequest = async (req, res) => {
  const { requester_id: requesterId, addressee_id: addresseeId } = req.body || {};

  if (!requesterId || !addresseeId) {
    return res.status(400).json({
      message: 'requester_id and addressee_id are required',
    });
  }

  if (!isValidUuid(requesterId) || !isValidUuid(addresseeId)) {
    return res.status(400).json({
      message: 'requester_id and addressee_id must be valid UUIDs',
    });
  }

  if (requesterId === addresseeId) {
    return res.status(400).json({
      message: 'You cannot send a friend request to yourself',
    });
  }

  try {
    const { data: existingFriendships, error: existingError } =
      await findExistingFriendship(requesterId, addresseeId);

    if (existingError) {
      console.error('Friendship duplicate check failed:', existingError);
      return res.status(500).json({ message: 'Failed to create friend request' });
    }

    const existingFriendship = existingFriendships?.[0];

    if (existingFriendship) {
      return res.status(409).json({
        message: 'A friendship or request already exists',
        friendship: existingFriendship,
      });
    }

    const { data, error } = await supabase
      .from('friendships')
      .insert({
        requester_id: requesterId,
        addressee_id: addresseeId,
        status: 'pending',
      })
      .select('id,requester_id,addressee_id,status,created_at,updated_at')
      .single();

    if (error) {
      console.error('Friend request insert failed:', error);
      return res.status(500).json({ message: 'Failed to create friend request' });
    }

    return res.status(201).json(data);
  } catch (error) {
    console.error('Friend request endpoint failed:', error);
    return res.status(500).json({ message: 'Failed to create friend request' });
  }
};

export const respondToFriendRequest = async (req, res) => {
  const { friendship_id: friendshipId, action } = req.body || {};

  if (!friendshipId || !action) {
    return res.status(400).json({
      message: 'friendship_id and action are required',
    });
  }

  if (!isValidUuid(friendshipId)) {
    return res.status(400).json({
      message: 'friendship_id must be a valid UUID',
    });
  }

  if (!['accept', 'reject', 'block'].includes(action)) {
    return res.status(400).json({
      message: 'action must be accept, reject, or block',
    });
  }

  try {
    if (action === 'reject') {
      const { error } = await supabase
        .from('friendships')
        .delete()
        .eq('id', friendshipId);

      if (error) {
        console.error('Friend request reject failed:', error);
        return res.status(500).json({ message: 'Failed to respond to request' });
      }

      return res.json({ id: friendshipId, status: 'rejected' });
    }

    const status = action === 'accept' ? 'accepted' : 'blocked';
    const { data, error } = await supabase
      .from('friendships')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', friendshipId)
      .select('id,requester_id,addressee_id,status,created_at,updated_at')
      .single();

    if (error) {
      console.error('Friend request response failed:', error);
      return res.status(500).json({ message: 'Failed to respond to request' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Friend request response endpoint failed:', error);
    return res.status(500).json({ message: 'Failed to respond to request' });
  }
};

export const getFriendRequests = async (req, res) => {
  const { user_id: userId } = req.query;

  if (!userId) {
    return res.status(400).json({ message: 'user_id is required' });
  }

  if (!isValidUuid(userId)) {
    return res.status(400).json({ message: 'user_id must be a valid UUID' });
  }

  try {
    const { data: requests, error: requestsError } = await supabase
      .from('friendships')
      .select('id,requester_id,addressee_id,status,created_at')
      .eq('addressee_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (requestsError) {
      console.error('Friend requests query failed:', requestsError);
      return res.status(500).json({ message: 'Failed to fetch friend requests' });
    }

    const requesterIds = [...new Set((requests || []).map((request) => request.requester_id))];

    if (requesterIds.length === 0) {
      return res.json([]);
    }

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id,email,name,username,avatar_url')
      .in('id', requesterIds);

    if (profilesError) {
      console.error('Friend request profiles query failed:', profilesError);
      return res.status(500).json({ message: 'Failed to fetch friend requests' });
    }

    const profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));

    return res.json(
      (requests || []).map((request, index) => ({
        id: request.id,
        friendship_id: request.id,
        status: request.status,
        created_at: request.created_at,
        requester: formatProfileAsFriend(profilesById.get(request.requester_id) || {}, index),
      })),
    );
  } catch (error) {
    console.error('Friend requests endpoint failed:', error);
    return res.status(500).json({ message: 'Failed to fetch friend requests' });
  }
};
