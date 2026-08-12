import { createHash } from "node:crypto";
import { basename, extname, resolve } from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import JSZip from "jszip";

export const resumeFormats = ["pdf", "docx", "txt", "md"] as const;
export type ResumeFormat = (typeof resumeFormats)[number];

export interface ImportResumeInput {
  path?: string | undefined;
  text?: string | undefined;
  fileName?: string | undefined;
}

export interface ResumeEvidence {
  kind: "resume";
  documentId: string;
  fileName: string;
  format: ResumeFormat | "text-input";
  localPath: string | null;
  byteLength: number;
  characterCount: number;
  pageCount: number | null;
  contentSha256: string;
  importedAt: string;
}

const maxResumeBytes = 10 * 1024 * 1024;
const maxResumeCharacters = 200_000;
const maxPdfPages = 10;
const maxDocxExpandedBytes = 25 * 1024 * 1024;

function normalizeText(value: string): string {
  return value
    .replace(/\u0000/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t ]+\n/gu, "\n")
    .replace(/\n{4,}/gu, "\n\n\n")
    .trim();
}

function formatFromPath(filePath: string): ResumeFormat {
  const extension = extname(filePath).slice(1).toLowerCase();
  if (resumeFormats.includes(extension as ResumeFormat)) {
    return extension as ResumeFormat;
  }
  throw new Error(
    `Unsupported resume format .${extension || "unknown"}. Use PDF, DOCX, TXT, or Markdown.`,
  );
}

async function extractPdf(buffer: Buffer) {
  const parser = new PDFParse({
    data: buffer,
    isEvalSupported: false,
    useWasm: false,
    stopAtErrors: false,
    maxImageSize: 0,
  });
  try {
    const result = await parser.getText({ first: maxPdfPages });
    return {
      text: result.text,
      pageCount: result.total,
      warnings:
        result.total > maxPdfPages
          ? [`Only the first ${maxPdfPages} PDF pages were read.`]
          : [],
    };
  } finally {
    await parser.destroy();
  }
}

async function extractBuffer(buffer: Buffer, format: ResumeFormat) {
  if (format === "pdf") return extractPdf(buffer);
  if (format === "docx") {
    const archive = await JSZip.loadAsync(buffer, { checkCRC32: false });
    const expandedBytes = Object.values(archive.files).reduce((total, entry) => {
      const data = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
      return total + (data?.uncompressedSize ?? 0);
    }, 0);
    if (expandedBytes > maxDocxExpandedBytes) {
      throw new Error("The DOCX expands beyond the 25 MB safety limit.");
    }
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: result.value,
      pageCount: null,
      warnings: result.messages.map((message) => message.message),
    };
  }
  return { text: buffer.toString("utf8"), pageCount: null, warnings: [] };
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function detectedFacts(text: string) {
  const emails = unique(
    text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) ?? [],
  );
  const phones = unique(
    (text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/gu) ?? [])
      .map((value) => value.trim()),
  );
  const urls = unique(
    (text.match(/https?:\/\/[^\s<>()\[\]{}]+/giu) ?? []).map((value) =>
      value.replace(/[.,;:!?]+$/gu, ""),
    ),
  );
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const possibleName =
    lines.find(
      (line) =>
        line.length >= 3 &&
        line.length <= 80 &&
        !line.includes("@") &&
        !/https?:|resume|curriculum|phone|email/iu.test(line) &&
        /^[\p{L} .,'’\-]+$/u.test(line),
    ) ?? null;

  return {
    possibleName,
    emails,
    phones,
    linkedInUrls: urls.filter((url) => /linkedin\.com/iu.test(url)),
    githubUrls: urls.filter((url) => /github\.com/iu.test(url)),
    portfolioUrls: urls.filter(
      (url) => !/linkedin\.com|github\.com/iu.test(url),
    ),
  };
}

function needsResumeResult() {
  return {
    status: "needs-resume" as const,
    prompt:
      "I do not have readable resume content yet. Please upload a resume or give the host access to its local attachment path.",
    acceptedFormats: resumeFormats,
    next:
      "Call buffalo.import_resume again with the attachment's local path or extracted text. Do not ask the applicant to retype the resume.",
  };
}

export async function importResume(input: ImportResumeInput) {
  const hasPath = Boolean(input.path?.trim());
  const hasText = Boolean(input.text?.trim());
  if (!hasPath && !hasText) return needsResumeResult();
  if (hasPath && hasText) {
    throw new Error("Provide either a resume path or resume text, not both.");
  }

  let text: string;
  let fileName: string;
  let format: ResumeEvidence["format"];
  let localPath: string | null = null;
  let byteLength: number;
  let pageCount: number | null = null;
  let warnings: string[] = [];

  if (hasPath) {
    const requestedPath = resolve(input.path!.trim());
    const canonicalPath = await realpath(requestedPath);
    const file = await stat(canonicalPath);
    if (!file.isFile()) throw new Error("The selected resume path is not a file.");
    if (file.size > maxResumeBytes) {
      throw new Error("The selected resume is larger than the 10 MB safety limit.");
    }
    format = formatFromPath(canonicalPath);
    const buffer = await readFile(canonicalPath);
    const extracted = await extractBuffer(buffer, format);
    text = normalizeText(extracted.text);
    fileName = basename(canonicalPath);
    localPath = canonicalPath;
    byteLength = buffer.byteLength;
    pageCount = extracted.pageCount;
    warnings = extracted.warnings;
  } else {
    text = normalizeText(input.text!);
    fileName = input.fileName?.trim() || "pasted-resume.txt";
    format = "text-input";
    byteLength = Buffer.byteLength(text, "utf8");
  }

  if (text.length > maxResumeCharacters) {
    text = text.slice(0, maxResumeCharacters);
    warnings.push(
      `Extracted text was truncated to ${maxResumeCharacters.toLocaleString("en-US")} characters.`,
    );
  }
  const contentSha256 = createHash("sha256").update(text).digest("hex");
  const evidence: ResumeEvidence = {
    kind: "resume",
    documentId: `resume_${contentSha256.slice(0, 16)}`,
    fileName,
    format,
    localPath,
    byteLength,
    characterCount: text.length,
    pageCount,
    contentSha256,
    importedAt: new Date().toISOString(),
  };

  if (text.length < 40) {
    return {
      status: "needs-readable-resume" as const,
      evidence,
      warnings,
      prompt:
        "The file did not contain enough readable text. If it is a scanned resume, use the host's vision/OCR capability or upload a text-based PDF, DOCX, or TXT copy.",
    };
  }

  return {
    status: "ready-for-fact-extraction" as const,
    evidence,
    extractedText: text,
    detectedFacts: detectedFacts(text),
    warnings,
    trust: {
      source: "resume-evidence" as const,
      confirmedByApplicant: false,
      instruction:
        "Map only facts explicitly present in this text. Build the passport with candidateFactsSource=resume-evidence, show the extracted facts to the applicant once, then rebuild with factsConfirmedByUser=true after corrections are confirmed.",
    },
    privacy:
      "The resume was read locally. Its contents were not uploaded to Buffalo Projects or any employer.",
  };
}
