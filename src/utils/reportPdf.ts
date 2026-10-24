import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface ReportImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export const fitReportImage = (width: number, height: number, boxWidth: number, boxHeight: number) => {
  if (![width, height, boxWidth, boxHeight].every(n => Number.isFinite(n) && n > 0)) {
    throw new Error('Invalid report page dimensions.');
  }
  const scale = Math.min(boxWidth / width, boxHeight / height);
  return { width: width * scale, height: height * scale };
};

/** One source page per output page; the complete page is fitted, never cropped. */
export async function composeReportPdf(input: {
  pages: AsyncIterable<ReportImage>;
  header: ReportImage;
  footer?: ReportImage;
  letterhead?: ReportImage;
  topInset?: number;
  bottomInset?: number;
  title: string;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setCreator('Clinic Suite');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const header = await pdf.embedPng(input.header.bytes);
  const footer = input.footer ? await pdf.embedPng(input.footer.bytes) : null;
  const letterhead = input.letterhead ? await pdf.embedPng(input.letterhead.bytes) : null;
  const width = 595.28;
  const height = 841.89;
  const margin = 28;
  const bodyWidth = width - margin * 2;
  const headerHeight = input.header.height / input.header.width * bodyWidth;
  const footerHeight = input.footer ? Math.min(65, input.footer.height / input.footer.width * bodyWidth) : 0;
  const top = input.topInset ?? 0;
  const bottom = Math.max(input.bottomInset ?? 0, footerHeight);
  const bodyTop = height - margin - top - headerHeight - 12;
  const bodyBottom = margin + bottom + 20;
  const bodyHeight = bodyTop - bodyBottom;
  if (bodyHeight < 300) throw new Error('Letterhead leaves too little space for the report. Reduce the letterhead margins.');

  for await (const source of input.pages) {
    const page = pdf.addPage([width, height]);
    if (letterhead) page.drawImage(letterhead, { x: 0, y: 0, width, height });
    page.drawImage(header, { x: margin, y: height - margin - top - headerHeight, width: bodyWidth, height: headerHeight });
    const image = await pdf.embedPng(source.bytes);
    const fit = fitReportImage(source.width, source.height, bodyWidth, bodyHeight);
    page.drawImage(image, { x: margin + (bodyWidth - fit.width) / 2, y: bodyTop - fit.height, ...fit });
    if (footer) page.drawImage(footer, { x: margin, y: margin, width: bodyWidth, height: footerHeight });
  }
  if (!pdf.getPageCount()) throw new Error('The report has no pages.');
  pdf.getPages().forEach((page, index) => page.drawText(`Page ${index + 1} of ${pdf.getPageCount()}`, {
    x: width - 85, y: 14, size: 8, font, color: rgb(0.35, 0.35, 0.35),
  }));
  return pdf.save();
}
