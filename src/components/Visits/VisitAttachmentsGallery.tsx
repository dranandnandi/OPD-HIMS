import React, { useState } from 'react';
import { Paperclip, Play, FileText, File as FileIcon, ExternalLink, X, Sparkles, Download } from 'lucide-react';
import { VisitImage } from '../../types';
import {
  getAttachmentKind,
  attachmentTypeLabel,
  formatFileSize,
  FALLBACK_THUMB,
  AttachmentKind
} from '../../utils/visitAttachments';

interface VisitAttachmentsGalleryProps {
  attachments?: VisitImage[];
  /** Compact tiles for dense lists such as the patient timeline. */
  compact?: boolean;
  /** Heading shown above the grid. Pass null to render the grid only. */
  title?: string | null;
}

/** Non-image tiles get an icon plate instead of a thumbnail. */
const IconPlate: React.FC<{ kind: AttachmentKind; compact?: boolean }> = ({ kind, compact }) => {
  const iconClass = compact ? 'w-6 h-6' : 'w-8 h-8';
  if (kind === 'pdf') {
    return (
      <div className="w-full h-full bg-red-50 flex flex-col items-center justify-center gap-1">
        <FileText className={`${iconClass} text-red-500`} />
        <span className="text-[10px] font-medium text-red-600">PDF</span>
      </div>
    );
  }
  return (
    <div className="w-full h-full bg-gray-100 flex flex-col items-center justify-center gap-1">
      <FileIcon className={`${iconClass} text-gray-400`} />
      <span className="text-[10px] font-medium text-gray-500">FILE</span>
    </div>
  );
};

/**
 * Read-only viewer for everything attached to a visit — images, videos, PDFs.
 * Shared by the patient timeline, the visit details page and the visit modal so
 * all three stay in step.
 */
const VisitAttachmentsGallery: React.FC<VisitAttachmentsGalleryProps> = ({
  attachments,
  compact = false,
  title = 'Attachments'
}) => {
  const [preview, setPreview] = useState<VisitImage | null>(null);

  if (!attachments || attachments.length === 0) return null;

  const thumbHeight = compact ? 'h-20' : 'h-32';
  const gridClass = compact
    ? 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2'
    : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3';

  const previewKind = preview ? getAttachmentKind(preview) : null;

  return (
    <div>
      {title && (
        <div className="flex items-center gap-2 mb-2">
          <Paperclip className={`${compact ? 'w-3.5 h-3.5' : 'w-5 h-5'} text-teal-600`} />
          <h5 className={compact ? 'text-sm font-semibold text-gray-700' : 'text-lg font-semibold text-gray-800'}>
            {title}
          </h5>
          <span className={compact ? 'text-xs text-gray-400' : 'text-sm text-gray-500'}>
            ({attachments.length})
          </span>
        </div>
      )}

      <div className={gridClass}>
        {attachments.map(attachment => {
          const kind = getAttachmentKind(attachment);
          return (
            <div
              key={attachment.id}
              className="group relative border border-gray-200 rounded-lg overflow-hidden bg-white"
            >
              <button
                type="button"
                onClick={() => setPreview(attachment)}
                className={`relative block w-full ${thumbHeight} cursor-pointer`}
                title={attachment.label || attachmentTypeLabel(attachment.imageType)}
              >
                {kind === 'image' ? (
                  <img
                    src={attachment.url}
                    alt={attachment.label || attachmentTypeLabel(attachment.imageType)}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={e => { (e.target as HTMLImageElement).src = FALLBACK_THUMB; }}
                  />
                ) : kind === 'video' ? (
                  <>
                    {/* Metadata-only preload keeps the timeline light; the frame is just a poster. */}
                    <video
                      src={attachment.url}
                      className="w-full h-full object-cover bg-black"
                      preload="metadata"
                      muted
                      playsInline
                    />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="bg-black/55 rounded-full p-2">
                        <Play className={`${compact ? 'w-4 h-4' : 'w-6 h-6'} text-white`} fill="white" />
                      </span>
                    </span>
                  </>
                ) : (
                  <IconPlate kind={kind} compact={compact} />
                )}
                <span className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all" />
              </button>

              <div className={compact ? 'px-1.5 py-1' : 'p-2'}>
                <p className={`${compact ? 'text-[10px]' : 'text-xs'} font-medium text-gray-700 truncate`}>
                  {attachmentTypeLabel(attachment.imageType)}
                </p>
                {!compact && attachment.label && (
                  <p className="text-xs text-gray-500 truncate" title={attachment.label}>{attachment.label}</p>
                )}
                {!compact && attachment.fileSize ? (
                  <p className="text-xs text-gray-400">{formatFileSize(attachment.fileSize)}</p>
                ) : null}
                {attachment.aiAnalysis && (
                  <p
                    className={`${compact ? 'text-[10px]' : 'text-xs'} text-purple-600 italic truncate`}
                    title={attachment.aiAnalysis}
                  >
                    AI analyzed
                  </p>
                )}
                {!compact && (
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 mt-1"
                  >
                    <ExternalLink className="w-3 h-3" /> Open full
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Preview overlay - player/viewer picked by file kind */}
      {preview && (
        <div
          className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="relative w-full max-w-5xl max-h-full flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 mb-2 text-white">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {attachmentTypeLabel(preview.imageType)}
                  {preview.label ? ` - ${preview.label}` : ''}
                </p>
                {preview.aiAnalysis && (
                  <p className="text-xs text-purple-200 flex items-start gap-1 mt-0.5">
                    <Sparkles className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{preview.aiAnalysis}</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm hover:text-gray-300"
                >
                  <Download className="w-4 h-4" /> Open
                </a>
                <button onClick={() => setPreview(null)} className="hover:text-gray-300">
                  <X className="w-7 h-7" />
                </button>
              </div>
            </div>

            {previewKind === 'image' && (
              <img
                src={preview.url}
                alt={preview.label || 'Attachment'}
                className="max-w-full max-h-[80vh] object-contain mx-auto rounded"
              />
            )}
            {previewKind === 'video' && (
              <video
                src={preview.url}
                controls
                autoPlay
                playsInline
                className="max-w-full max-h-[80vh] mx-auto rounded bg-black"
              />
            )}
            {previewKind === 'pdf' && (
              <iframe
                src={preview.url}
                title={preview.label || 'PDF attachment'}
                className="w-full h-[80vh] bg-white rounded"
              />
            )}
            {previewKind === 'other' && (
              <div className="bg-white rounded-lg p-8 text-center">
                <FileIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-sm text-gray-600 mb-3">This file type has no in-app preview.</p>
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-teal-600 hover:text-teal-700"
                >
                  <ExternalLink className="w-4 h-4" /> Open in a new tab
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VisitAttachmentsGallery;
