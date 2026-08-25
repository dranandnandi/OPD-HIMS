import { VisitImage } from '../types';

/**
 * A visit attachment is stored in the `visits.visit_images` JSONB column. The
 * column pre-dates video/PDF support, so the concrete file kind is derived from
 * the mime type when we have one and from the URL extension otherwise — old rows
 * carry neither `mimeType` nor a non-image `imageType`.
 */
export type AttachmentKind = 'image' | 'video' | 'audio' | 'pdf' | 'other';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'avi', 'mkv', '3gp', 'quicktime'];
const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav', 'opus'];

/** Extension of the file the URL points at, ignoring query strings and signed-URL params. */
const extensionOf = (url: string): string => {
  const path = (url || '').split(/[?#]/)[0];
  const lastSegment = path.substring(path.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');
  return dot === -1 ? '' : lastSegment.substring(dot + 1).toLowerCase();
};

export const getAttachmentKind = (attachment: Pick<VisitImage, 'url' | 'mimeType' | 'imageType'>): AttachmentKind => {
  const mime = (attachment.mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';

  const ext = extensionOf(attachment.url);
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';

  // .webm carries either audio or video; the category decides which.
  if (ext === 'webm') return attachment.imageType === 'voice_note' ? 'audio' : 'video';

  // No mime and no recognisable extension: fall back to the clinical category.
  if (attachment.imageType === 'voice_note') return 'audio';
  if (attachment.imageType === 'video') return 'video';
  if (attachment.imageType === 'document') return 'pdf';
  if (mime || ext) return 'other';

  // Legacy rows (bare URLs saved before mime types were recorded) are images.
  return 'image';
};

/** Only still images can go through Vision OCR / image AI analysis. */
export const isAnalyzable = (attachment: Pick<VisitImage, 'url' | 'mimeType' | 'imageType'>): boolean =>
  getAttachmentKind(attachment) === 'image';

export const ATTACHMENT_TYPE_LABELS: Record<VisitImage['imageType'], string> = {
  clinical_photo: 'Clinical Photo',
  lab_report: 'Lab Report',
  xray: 'X-Ray',
  case_paper: 'Case Paper',
  video: 'Video',
  voice_note: 'Voice Note',
  document: 'Document',
  other: 'Other'
};

export const attachmentTypeLabel = (imageType: VisitImage['imageType']): string =>
  ATTACHMENT_TYPE_LABELS[imageType] || String(imageType).replace(/_/g, ' ');

/** Accept list shared by the upload inputs. Keep in sync with `validateAttachmentFile`. */
export const ATTACHMENT_ACCEPT = 'image/*,video/*,application/pdf';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;   // 15 MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;  // 100 MB
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB

/** Seconds -> "m:ss", for audio/video durations. */
export const formatDuration = (seconds?: number): string => {
  if (!seconds || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

/** Returns an error message when the file cannot be attached, or null when it is fine. */
export const validateAttachmentFile = (file: File): string | null => {
  const mime = (file.type || '').toLowerCase();
  const ext = extensionOf(file.name);

  const isImage = mime.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext);
  const isVideo = mime.startsWith('video/') || VIDEO_EXTENSIONS.includes(ext) || ext === 'webm';
  const isPdf = mime === 'application/pdf' || ext === 'pdf';

  if (!isImage && !isVideo && !isPdf) {
    return 'Unsupported file. Attach an image (JPEG, PNG, HEIC, WebP), a video (MP4, MOV, WebM) or a PDF.';
  }

  const limit = isVideo ? MAX_VIDEO_BYTES : isPdf ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES;
  if (file.size > limit) {
    return `File is too large (${formatFileSize(file.size)}). Maximum is ${formatFileSize(limit)} for ${isVideo ? 'videos' : isPdf ? 'PDFs' : 'images'}.`;
  }

  return null;
};

/** Default clinical category for a freshly attached file. */
export const defaultImageTypeFor = (file: File): VisitImage['imageType'] => {
  const mime = (file.type || '').toLowerCase();
  const ext = extensionOf(file.name);
  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (mime === 'application/pdf' || ext === 'pdf') return 'document';
  return 'clinical_photo';
};

/** Grey placeholder used when a thumbnail fails to load (expired signed URL, deleted object). */
export const FALLBACK_THUMB =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23e5e7eb" width="100" height="100"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%239ca3af" font-size="12">No preview</text></svg>';

export const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
