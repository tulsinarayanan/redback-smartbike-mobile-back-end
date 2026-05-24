import { supabase } from '../config/supabaseClient.js';

const formatName = (profile) =>
  profile?.name ||
  profile?.username ||
  profile?.email?.split('@')[0] ||
  'Rider';
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUuid = (value) => UUID_REGEX.test(String(value || ''));

const previewText = (value, maxLength = 80) => {
  const text = String(value || '').trim();

  if (text.length <= maxLength) return text;

  return `${text.slice(0, maxLength - 1)}...`;
};

export const getNotifications = async (req, res) => {
  const userId = req.query.user_id;

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
      console.error('Notifications friendship query failed:', requestsError);
      return res.status(500).json({ message: 'Failed to fetch notifications' });
    }

    const requesterIds = [
      ...new Set((requests || []).map((request) => request.requester_id)),
    ];
    let profilesById = new Map();

    if (requesterIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id,email,name,username,avatar_url')
        .in('id', requesterIds);

      if (profilesError) {
        console.error('Notifications profile query failed:', profilesError);
        return res.status(500).json({ message: 'Failed to fetch notifications' });
      }

      profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    }

    const requestNotifications = (requests || []).map((request) => {
      const profile = profilesById.get(request.requester_id);
      const body = `${formatName(profile)} wants to connect with you`;

      return {
        id: `friend-request-${request.id}`,
        type: 'friend_request',
        title: 'New friend request',
        body,
        message: body,
        created_at: request.created_at,
        related_id: request.id,
        friendship_id: request.id,
        requester_id: request.requester_id,
        requester: {
          id: profile?.id || request.requester_id,
          name: formatName(profile),
          email: profile?.email || '',
          photo: profile?.avatar_url || null,
        },
      };
    });

    const { data: participantRows, error: participantError } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', userId);

    if (participantError) {
      console.error('Notifications conversation query failed:', participantError);
      return res.status(500).json({ message: 'Failed to fetch notifications' });
    }

    const conversationIds = [
      ...new Set((participantRows || []).map((row) => row.conversation_id)),
    ];
    let messageNotifications = [];

    if (conversationIds.length > 0) {
      const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('id,conversation_id,sender_id,body,created_at')
        .in('conversation_id', conversationIds)
        .neq('sender_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (messagesError) {
        console.error('Notifications message query failed:', messagesError);
        return res.status(500).json({ message: 'Failed to fetch notifications' });
      }

      const senderIds = [
        ...new Set((messages || []).map((message) => message.sender_id)),
      ];
      let sendersById = new Map();

      if (senderIds.length > 0) {
        const { data: senders, error: sendersError } = await supabase
          .from('profiles')
          .select('id,email,name,username,avatar_url')
          .in('id', senderIds);

        if (sendersError) {
          console.error('Notifications sender query failed:', sendersError);
          return res.status(500).json({ message: 'Failed to fetch notifications' });
        }

        sendersById = new Map((senders || []).map((sender) => [sender.id, sender]));
      }

      messageNotifications = (messages || []).map((message) => {
        const sender = sendersById.get(message.sender_id);
        const senderName = formatName(sender);
        const body = `${senderName}: ${previewText(message.body)}`;

        return {
          id: `message-${message.id}`,
          type: 'message',
          title: 'New message',
          body,
          message: body,
          created_at: message.created_at,
          related_id: message.conversation_id,
          conversation_id: message.conversation_id,
          sender_id: message.sender_id,
          sender: {
            id: sender?.id || message.sender_id,
            name: senderName,
            email: sender?.email || '',
            photo: sender?.avatar_url || null,
          },
        };
      });
    }

    const { count: rideCount, error: ridesError } = await supabase
      .from('rides')
      .select('ride_id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (ridesError) {
      console.error('Notifications rides query failed:', ridesError);
    }

    const achievementNotifications =
      !ridesError && rideCount > 0
        ? [
            {
              id: 'achievement-first-ride',
              type: 'achievement',
              title: 'Ride progress',
              body:
                rideCount === 1
                  ? 'You completed your first ride.'
                  : `You have completed ${rideCount} rides.`,
              message:
                rideCount === 1
                  ? 'You completed your first ride.'
                  : `You have completed ${rideCount} rides.`,
              created_at: new Date().toISOString(),
              related_id: userId,
            },
          ]
        : [];

    return res.json(
      [
        ...requestNotifications,
        ...messageNotifications,
        ...achievementNotifications,
      ].sort((first, second) => {
        return new Date(second.created_at) - new Date(first.created_at);
      }),
    );
  } catch (error) {
    console.error('Notifications endpoint failed:', error);
    return res.status(500).json({ message: 'Failed to fetch notifications' });
  }
};
