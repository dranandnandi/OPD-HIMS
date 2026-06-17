const HEADING_PREFIX_PATTERN = /^\s*(?:\[[^\]]+\]\s*:?\s*)?(impression|findings?)\s*[:\-]?\s*/i;

const splitClinicalSummary = (text: string): string[] => {
  return text
    .split(/\r?\n+|\/|;|(?<=\.)\s+(?=[A-Z])/g)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
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
