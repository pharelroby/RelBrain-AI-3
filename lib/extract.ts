/* ═══════════════════════════════════════════════════════════════════════════
   Validation MIME (par signature binaire, pas par extension) et extraction
   du texte : PDF (pdf-parse), DOCX (mammoth), PPTX (jszip), TXT/MD,
   images (OCR via le modèle vision d'OpenAI).
   ═══════════════════════════════════════════════════════════════════════════ */
import { HttpError } from './http';
import { ocrImage } from './ai/openai';

export const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;
export const ALLOWED_MIME = new Set<string>(Object.values(MIME));
export const MAX_BYTES = 20 * 1024 * 1024;

const starts = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

/** Détermine le type réel du fichier à partir de ses premiers octets. */
export function sniffMime(buf: Buffer, fileName = ''): string | null {
  if (buf.length < 4) return null;
  if (starts(buf, [0x25, 0x50, 0x44, 0x46])) return MIME.pdf; // %PDF
  if (starts(buf, [0x89, 0x50, 0x4e, 0x47])) return MIME.png;
  if (starts(buf, [0xff, 0xd8, 0xff])) return MIME.jpeg;
  if (starts(buf, [0x52, 0x49, 0x46, 0x46]) && buf.toString('ascii', 8, 12) === 'WEBP') return MIME.webp;
  if (starts(buf, [0x50, 0x4b, 0x03, 0x04])) {
    // Archive OOXML : on cherche les entrées caractéristiques
    if (buf.includes('word/')) return MIME.docx;
    if (buf.includes('ppt/')) return MIME.pptx;
    return null;
  }
  // Texte : UTF-8 valide, sans octet nul
  const head = buf.subarray(0, Math.min(buf.length, 64 * 1024));
  if (!head.includes(0)) {
    const decoded = head.toString('utf8');
    if (!decoded.includes('�')) return /\.md$/i.test(fileName) ? MIME.md : MIME.txt;
  }
  return null;
}

export interface Extracted {
  text: string;
  pages?: number;
  warning?: string;
}

function clean(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export async function extractText(buf: Buffer, mime: string, userId: string | null): Promise<Extracted> {
  switch (mime) {
    case MIME.pdf: {
      // Import direct du module interne : évite le code de débogage de pdf-parse/index.js
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse: (b: Buffer) => Promise<{ text: string; numpages: number }> = require('pdf-parse/lib/pdf-parse.js');
      const out = await pdfParse(buf);
      const text = clean(out.text || '');
      const warning =
        text.length < 200 * Math.max(1, out.numpages) * 0.2
          ? 'Ce PDF semble scanné (peu de texte détecté). Pour un meilleur résultat, importe les pages en photos : RelBrain les lira par OCR.'
          : undefined;
      return { text, pages: out.numpages, warning };
    }
    case MIME.docx: {
      const mammoth = await import('mammoth');
      const out = await mammoth.extractRawText({ buffer: buf });
      return { text: clean(out.value || '') };
    }
    case MIME.pptx: {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(buf);
      const slides = Object.keys(zip.files)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
      const parts: string[] = [];
      for (const [i, name] of slides.entries()) {
        const xml = await zip.files[name].async('string');
        const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1]));
        if (runs.length) parts.push(`— Diapositive ${i + 1} —\n${runs.join(' ')}`);
      }
      return { text: clean(parts.join('\n\n')), pages: slides.length };
    }
    case MIME.txt:
    case MIME.md:
      return { text: clean(buf.toString('utf8')) };
    case MIME.png:
    case MIME.jpeg:
    case MIME.webp: {
      const text = await ocrImage(buf, mime, userId);
      return { text: clean(text), pages: 1, warning: text ? undefined : 'Aucun texte lisible détecté sur cette image.' };
    }
    default:
      throw new HttpError(415, 'unsupported_type', 'Format non pris en charge. Formats acceptés : PDF, DOCX, PPTX, TXT, MD, PNG, JPG, WEBP.');
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
