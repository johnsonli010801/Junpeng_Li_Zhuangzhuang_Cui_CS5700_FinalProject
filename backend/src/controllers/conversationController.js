import { nanoid } from 'nanoid';
import { db, persist } from '../db.js';
import { sanitizeInput } from '../security.js';
import { recordLog } from '../auth.js';
import { findConversation, createMessage } from '../utils/conversationUtils.js';

export function createConversationController(io) {
  const listConversations = (req, res) => {
    const conversations = db.data.conversations.filter((c) =>
      c.members.includes(req.user.id)
    );
    res.json({ conversations });
  };

  const createConversationHandler = (req, res) => {
    const { name, memberIds = [], isGroup = true } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Conversation name is required' });
    }

    // Sanitize conversation name
    const cleanName = sanitizeInput(name);
    if (!cleanName) {
      return res.status(400).json({ message: 'Conversation name cannot be empty' });
    }

    const participants = Array.from(new Set([req.user.id, ...memberIds]));

    // Direct conversation validation
    if (!isGroup) {
      if (memberIds.length === 0) {
        return res.status(400).json({
          message: 'Direct chat requires a target user id',
        });
      }
      if (participants.length !== 2) {
        return res.status(400).json({
          message: 'Direct chat must have exactly two members',
        });
      }

      // Check whether a direct conversation between the two users already exists
      const existing = db.data.conversations.find(
        (conv) =>
          !conv.isGroup &&
          conv.members.length === participants.length &&
          participants.every((id) => conv.members.includes(id))
      );
      if (existing) {
        return res.json({ conversation: existing });
      }
    }

    const conversation = {
      id: nanoid(),
      name: cleanName,
      isGroup,
      members: participants,
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
    };
    db.data.conversations.push(conversation);
    persist();
    recordLog('info', 'Conversation created', { conversationId: conversation.id });
    return res.status(201).json({ conversation });
  };

  const getMessages = (req, res) => {
    const conversation = findConversation(req.params.id);
    if (!conversation || !conversation.members.includes(req.user.id)) {
      return res.status(404).json({ message: 'Conversation does not exist or you lack permission' });
    }
    const messages = db.data.messages
      .filter((m) => m.conversationId === conversation.id)
      .slice(-200);
    return res.json({ messages });
  };

  const addMembers = (req, res) => {
    const conversation = findConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Ensure this is a group conversation
    if (!conversation.isGroup) {
      return res.status(400).json({ message: 'Direct chats do not support adding members' });
    }

    // Permission check: creator, admins or existing members can invite
    if (!conversation.members.includes(req.user.id) && !req.user.roles?.includes('admin')) {
      return res.status(403).json({ message: 'You are not allowed to add members to this conversation' });
    }

    const { memberIds = [] } = req.body;
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ message: 'Please specify members to add' });
    }

    // Ensure users to be added all exist
    const validMemberIds = memberIds.filter((id) =>
      db.data.users.some((u) => u.id === id)
    );

    conversation.members = Array.from(
      new Set([...conversation.members, ...validMemberIds]),
    );
    persist();

    // Notify all members
    io.to(conversation.id).emit('conversation:updated', { conversation });

    recordLog('info', 'Added members to group', {
      conversationId: conversation.id,
      addedBy: req.user.id,
      newMembers: validMemberIds,
    });

    return res.json({ conversation });
  };

  const leaveConversation = (req, res) => {
    const conversation = findConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    if (!conversation.isGroup) {
      return res.status(400).json({ message: 'Direct chats do not support leaving' });
    }

    if (!conversation.members.includes(req.user.id)) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }

    // If the owner leaves, dissolve the group
    if (conversation.createdBy === req.user.id) {
      // Delete group
      const index = db.data.conversations.findIndex((c) => c.id === conversation.id);
      if (index !== -1) {
        db.data.conversations.splice(index, 1);
      }
      persist();

      // Notify all members that the group is dissolved
      io.to(conversation.id).emit('conversation:dissolved', {
        conversationId: conversation.id,
        message: 'Group owner left, group has been dissolved',
      });

      recordLog('info', 'Group owner left, group dissolved', {
        conversationId: conversation.id,
        creatorId: req.user.id,
      });

      return res.json({ message: 'You left the group and it was dissolved' });
    }

    // Regular member leaves
    conversation.members = conversation.members.filter((id) => id !== req.user.id);
    persist();

    // Notify remaining members
    io.to(conversation.id).emit('conversation:updated', { conversation });

    recordLog('info', 'User left group', {
      conversationId: conversation.id,
      userId: req.user.id,
    });

    return res.json({ message: 'You left the group' });
  };

  const deleteConversationHandler = (req, res) => {
    const conversation = findConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    if (!conversation.isGroup) {
      return res.status(400).json({ message: 'Direct chats cannot be deleted' });
    }

    // Only the creator can delete the group
    if (conversation.createdBy !== req.user.id) {
      return res.status(403).json({ message: 'Only the group owner can delete this group' });
    }

    // Delete group
    const index = db.data.conversations.findIndex((c) => c.id === conversation.id);
    if (index !== -1) {
      db.data.conversations.splice(index, 1);
    }
    persist();

    // Notify all members
    io.to(conversation.id).emit('conversation:deleted', {
      conversationId: conversation.id,
      message: 'Group chat has been deleted',
    });

    recordLog('info', 'Group chat deleted', {
      conversationId: conversation.id,
      deletedBy: req.user.id,
    });

    return res.json({ message: 'Group chat deleted' });
  };

  const getConversationMessages = getMessages;

  return {
    listConversations,
    createConversation: createConversationHandler,
    getConversationMessages,
    addMembers,
    leaveConversation,
    deleteConversation: deleteConversationHandler,
  };
}


