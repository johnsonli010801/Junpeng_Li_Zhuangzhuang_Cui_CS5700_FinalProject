export function validateFileUpload(file) {
  const allowedTypes = [
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/svg+xml',
    
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    
    // Archives
    'application/zip',
    'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    
    // Audio
    'audio/mpeg',        // mp3
    'audio/mp3',         // mp3 alternative
    'audio/wav',         // wav
    'audio/wave',        // wav alternative
    'audio/x-wav',       // wav alternative
    'audio/ogg',         // ogg
    'audio/aac',         // aac
    'audio/mp4',         // m4a
    'audio/x-m4a',       // m4a alternative
    
    // Video
    'video/mp4',         // mp4
    'video/mpeg',        // mpeg
    'video/quicktime',   // mov
    'video/x-msvideo',   // avi
    'video/webm',        // webm
  ];
  
  const maxSize = 25 * 1024 * 1024; // 25MB
  
  if (!allowedTypes.includes(file.mimetype)) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.mimetype}. Allowed types: images, documents, audio, video and archives.`,
    };
  }
  
  if (file.size > maxSize) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(2);
    return {
      valid: false,
      error: `File size ${sizeMB}MB exceeds 25MB limit`,
    };
  }
  
  return { valid: true };
}

export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  return input
    // Strip all HTML tags
    .replace(/<[^>]*>/g, '')
    // Strip javascript: protocol
    .replace(/javascript:/gi, '')
    // Strip inline event handlers
    .replace(/on\w+\s*=/gi, '')
    // Strip dangerous characters
    .replace(/[<>'"]/g, '')
    // Strip control chars (keep newline and tab)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 5000);
}



