import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { db, persist } from '../db.js';
import { validateFileUpload, sanitizeInput } from '../security.js';
import { recordLog } from '../auth.js';
import { sanitizeUser } from '../utils/userUtils.js';
import { createMessage, findConversation } from '../utils/conversationUtils.js';

// 聊天里的文件上传/下载
export function createFileController(io, uploadDir) {
  const uploadFile = (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: 'No file detected in upload' });
    }

    const { conversationId } = req.body;
    if (!conversationId) {
      return res.status(400).json({ message: 'Conversation id is required' });
    }

    const conversation = findConversation(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    if (!conversation.members.includes(req.user.id)) {
      return res.status(403).json({ message: 'You are not allowed to upload to this conversation' });
    }

    const validation = validateFileUpload(req.file);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }

    const fileEntry = {
      id: nanoid(),
      conversationId,
      uploaderId: req.user.id,
      path: req.file.filename,
      originalName: sanitizeInput(req.file.originalname),
      mimeType: req.file.mimetype,
      size: req.file.size,
      createdAt: new Date().toISOString(),
    };
    db.data.files.push(fileEntry);

    const message = createMessage({
      conversationId,
      senderId: req.user.id,
      type: 'file',
      content: `${req.user.name} shared a file: ${fileEntry.originalName}`,
      fileId: fileEntry.id,
    });
    persist();

    const messageWithSender = {
      ...message,
      sender: sanitizeUser(req.user),
    };

    // eslint-disable-next-line no-console
    console.log('[Server] broadcasting file message:', messageWithSender);
    io.to(conversationId).emit('message:new', messageWithSender);

    recordLog('info', 'File uploaded', {
      conversationId,
      fileId: fileEntry.id,
      uploaderId: req.user.id,
      fileName: fileEntry.originalName,
    });
    return res.status(201).json({ file: fileEntry, message: messageWithSender });
  };

  const getFile = (req, res) => {
    const file = db.data.files.find((f) => f.id === req.params.fileId);
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }
    const conversation = findConversation(file.conversationId);
    if (!conversation || !conversation.members.includes(req.user.id)) {
      return res.status(403).json({ message: 'You are not allowed to access this file' });
    }
    return res.sendFile(join(uploadDir, file.path));
  };

  return {
    uploadFile,
    getFile,
  };
}


