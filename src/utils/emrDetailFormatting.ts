const HEADING_PREFIX_PATTERN = /^\s*(?:\[[^\]]+\]\s*:?\s*)?(impression|findings?)\s*[:\-]?\s*/i;

const splitClinicalSummary = (text: string): string[] => {
  return text
    .split(/\r?\n+|\/|;|(?<=\.)\s+(?=[A-Z])/g)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
};

const AI_BLOCK_HEADER_PATTERN = /^\[[^\]]+\]$/;

/**
 * Drops the "[Voice dictation]" / "[Case paper]" blocks that applyAiExtraction appends
 * to Doctor Notes. They are working notes for the doctor inside the app (echoed chief
 * complaint, AI differentials to review) and do not belong on a printed copy.
 */
export const stripAiNoteBlocks = (doctorNotes?: string | null): string => {
  let inAiBlock = false;
  return (doctorNotes || '')
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (AI_BLOCK_HEADER_PATTERN.test(trimmed)) {
        inAiBlock = true;
        return false;
      }
      if (!inAiBlock) return true;
      if (!trimmed || trimmed.startsWith('•')) return false;
      inAiBlock = false;
      return true;
    })
    .join('\n')
    .trim();
};

export const extractImpressionDetails = (doctorNotes?: string | null) => {
  const notes = doctorNotes?.trim() || '';
  if (!notes) {
    return {
      impressionItems: [] as string[],
      remainingNotes: ''
    };
  }

  const lines = notes
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const impressionLines: string[] = [];
  const remainingLines: string[] = [];

  lines.forEach((line) => {
    if (HEADING_PREFIX_PATTERN.test(line)) {
      impressionLines.push(line.replace(HEADING_PREFIX_PATTERN, '').trim());
      return;
    }

    remainingLines.push(line);
  });

  const collapsedNotes = lines.join(' ');
  if (impressionLines.length === 0 && HEADING_PREFIX_PATTERN.test(collapsedNotes)) {
    const extracted = collapsedNotes.replace(HEADING_PREFIX_PATTERN, '').trim();
    return {
      impressionItems: splitClinicalSummary(extracted),
      remainingNotes: ''
    };
  }

  return {
    impressionItems: splitClinicalSummary(impressionLines.join('\n')),
    remainingNotes: remainingLines.join('\n').trim()
  };
};

export const formatTestTypeLabel = (testType?: string | null) => {
  switch ((testType || '').toLowerCase()) {
    case 'lab':
      return 'Lab';
    case 'radiology':
      return 'Radiology';
    case 'procedure':
      return 'Procedure';
    case 'other':
      return 'Other';
    default:
      return testType || 'Other';
  }
};
