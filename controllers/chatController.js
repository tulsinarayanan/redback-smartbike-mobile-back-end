import { supabase } from '../config/supabaseClient.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FALLBACK_PHOTO = 'https://i.pravatar.cc/150?img=14';

const isValidUuid = (value) => UUID_REGEX.test(String(value || ''));

const formatProfile = (profile) => ({
  id: profile?.id || '',
  name:
    profile?.name ||
    profile?.username ||
    profile?.email?.split('@')[0] ||
    'Rider',
  email: profile?.email || '',
  photo: profile?.avatar_url || FALLBACK_PHOTO,
});

const getProfilesByIds = async (ids) => {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,name,username,avatar_url')
    .in('id', uniqueIds);

  if (error) {
    throw error;
  }

  return new Map((data || []).map((profile) => [profile.id, profile]));
};

const getConversationParticipants = async (conversationIds) => {
  const { data, error } = await supabase
    .from('conversation_participants')
    .select('conversation_id,user_id,created_at')
    .in('conversation_id', conversationIds);

  if (error) {
    throw error;
  }

  return data || [];
};

const getLatestMessages = async (conversationIds) => {
  const { data, error } = await supabase
    .from('messages')
    .select('id,conversation_id,sender_id,body,created_at,updated_at')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const latestByConversation = new Map();

  (data || []).forEach((message) => {
    if (!latestByConversation.has(message.conversation_id)) {
      latestByConversation.set(message.conversation_id, message);
    }
  });

  return latestByConversation;
};

const formatConversation = ({
  conversation,
  participants,
  profilesById,
  latestMessage,
  currentUserId,
}) => {
  const participantProfiles = participants.map((participant) => ({
    user_id: participant.user_id,
    profile: formatProfile(profilesById.get(participant.user_id)),
  }));
  const otherParticipant =
    participantProfiles.find(
      (participant) => participant.user_id !== currentUserId,
    ) || participantProfiles[0];

  return {
    id: conversation.id,
    participants: participantProfiles,
    otherParticipant: otherParticipant?.profile || null,
    lastMessage: latestMessage
      ? {
          id: latestMessage.id,
          body: latestMessage.body,
          sender_id: latestMessage.sender_id,
          created_at: latestMessage.created_at,
        }
      : null,
    updatedAt: latestMessage?.created_at || conversation.created_at,
    unread: 0,
  };
};

const findExistingOneToOneConversation = async (userIds) => {
  const { data, error } = await supabase
    .from('conversation_participants')
    .select('conversation_id,user_id')
    .in('user_id', userIds);

  if (error) {
    throw error;
  }

  const candidateIds = [
    ...new Set((data || []).map((row) => row.conversation_id)),
  ];

  for (const conversationId of candidateIds) {
    const { data: participants, error: participantsError } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId);

    if (participantsError) {
      throw participantsError;
    }

    const participantIds = (participants || []).map((row) => row.user_id).sort();

    if (
      participantIds.length === userIds.length &&
      participantIds.join('|') === [...userIds].sort().join('|')
    ) {
      return conversationId;
    }
  }

  return null;
};

export const getConversations = async (req, res) => {
  const userId = req.query.user_id;

  if (!userId) {
    return res.status(400).json({ message: 'user_id is required' });
  }

  if (!isValidUuid(userId)) {
    return res.status(400).json({ message: 'user_id must be a valid UUID' });
  }

  try {
    const { data: userParticipants, error: userParticipantsError } =
      await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', userId);

    if (userParticipantsError) {
      throw userParticipantsError;
    }

    const conversationIds = [
      ...new Set((userParticipants || []).map((row) => row.conversation_id)),
    ];

    if (conversationIds.length === 0) {
      return res.json([]);
    }

    const { data: conversations, error: conversationsError } = await supabase
      .from('conversations')
      .select('id,created_at')
      .in('id', conversationIds);

    if (conversationsError) {
      throw conversationsError;
    }

    const participants = await getConversationParticipants(conversationIds);
    const profilesById = await getProfilesByIds(
      participants.map((participant) => participant.user_id),
    );
    const latestMessages = await getLatestMessages(conversationIds);

    const rows = (conversations || [])
      .map((conversation) =>
        formatConversation({
          conversation,
          participants: participants.filter(
            (participant) => participant.conversation_id === conversation.id,
          ),
          profilesById,
          latestMessage: latestMessages.get(conversation.id),
          currentUserId: userId,
        }),
      )
      .sort((first, second) => {
        return new Date(second.updatedAt) - new Date(first.updatedAt);
      });

    return res.json(rows);
  } catch (error) {
    console.error('Get conversations failed:', error);
    return res.status(500).json({ message: 'Failed to fetch conversations' });
  }
};

export const createConversation = async (req, res) => {
  const { user_ids: userIds } = req.body || {};

  if (!Array.isArray(userIds) || userIds.length < 2) {
    return res
      .status(400)
      .json({ message: 'user_ids must include at least two users' });
  }

  const uniqueUserIds = [...new Set(userIds)];

  if (uniqueUserIds.length < 2) {
    return res
      .status(400)
      .json({ message: 'user_ids must include at least two different users' });
  }

  if (uniqueUserIds.some((userId) => !isValidUuid(userId))) {
    return res.status(400).json({ message: 'user_ids must be valid UUIDs' });
  }

  try {
    let conversationId = null;

    if (uniqueUserIds.length === 2) {
      conversationId = await findExistingOneToOneConversation(uniqueUserIds);
    }

    if (!conversationId) {
      const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .insert({})
        .select('id,created_at')
        .single();

      if (conversationError) {
        throw conversationError;
      }

      conversationId = conversation.id;

      const { error: participantsError } = await supabase
        .from('conversation_participants')
        .insert(
          uniqueUserIds.map((userId) => ({
            conversation_id: conversationId,
            user_id: userId,
          })),
        );

      if (participantsError) {
        throw participantsError;
      }
    }

    return res.status(201).json({ id: conversationId });
  } catch (error) {
    console.error('Create conversation failed:', error);
    return res.status(500).json({ message: 'Failed to create conversation' });
  }
};

export const getMessages = async (req, res) => {
  const { conversation_id: conversationId } = req.params;

  if (!conversationId) {
    return res.status(400).json({ message: 'conversation_id is required' });
  }

  if (!isValidUuid(conversationId)) {
    return res
      .status(400)
      .json({ message: 'conversation_id must be a valid UUID' });
  }

  try {
    const { data: messages, error } = await supabase
      .from('messages')
      .select('id,conversation_id,sender_id,body,created_at,updated_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    const profilesById = await getProfilesByIds(
      (messages || []).map((message) => message.sender_id),
    );

    return res.json(
      (messages || []).map((message) => ({
        ...message,
        sender: formatProfile(profilesById.get(message.sender_id)),
      })),
    );
  } catch (error) {
    console.error('Get messages failed:', error);
    return res.status(500).json({ message: 'Failed to fetch messages' });
  }
};

export const sendMessage = async (req, res) => {
  const { conversation_id: conversationId, sender_id: senderId, body } =
    req.body || {};

  if (!conversationId) {
    return res.status(400).json({ message: 'conversation_id is required' });
  }

  if (!senderId) {
    return res.status(400).json({ message: 'sender_id is required' });
  }

  if (!isValidUuid(conversationId) || !isValidUuid(senderId)) {
    return res
      .status(400)
      .json({ message: 'conversation_id and sender_id must be valid UUIDs' });
  }

  if (!String(body || '').trim()) {
    return res.status(400).json({ message: 'message body is required' });
  }

  try {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        body: String(body).trim(),
      })
      .select('id,conversation_id,sender_id,body,created_at,updated_at')
      .single();

    if (error) {
      throw error;
    }

    const profilesById = await getProfilesByIds([senderId]);

    return res.status(201).json({
      ...data,
      sender: formatProfile(profilesById.get(senderId)),
    });
  } catch (error) {
    console.error('Send message failed:', error);
    return res.status(500).json({ message: 'Failed to send message' });
  }
};
