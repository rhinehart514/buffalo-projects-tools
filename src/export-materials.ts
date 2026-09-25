import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import PDFDocument from "pdfkit";
import type { LiveJob } from "./jobs.js";
import {
  reviewApplicationMaterials,
  type ProposedMaterialClaim,
} from "./materials.js";
import type { ResumeEvidence } from "./resume.js";
import { loadCandidateProfile, localDataDir } from "./storage.js";

function safeSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return normalized || "material";
}

function cleanText(value: string): string {
  return value.replace(/\u0000/gu, "").replace(/\r\n?/gu, "\n").trim();
}

function renderLines(doc: PDFKit.PDFDocument, value: string, documentType: "resume" | "cover-letter") {
  const lines = cleanText(value).split("\n");
  let firstContent = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      doc.moveDown(0.45);
      continue;
    }
    const sectionHeading =
      line.length <= 60 &&
      (/^[A-Z0-9 &/+.-]{3,}$/u.test(line) || /^[\p{L}][\p{L} &/+.-]+:$/u.test(line));
    const bullet = /^[-•*]\s+/u.test(line);
    if (firstContent && documentType === "resume") {
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#111111").text(line, {
        align: "left",
      });
      doc.moveDown(0.2);
    } else if (sectionHeading) {
      doc.moveDown(0.35);
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#111111").text(
        line.replace(/:$/u, ""),
        { characterSpacing: 0.3 },
      );
      doc.moveTo(doc.x, doc.y + 2).lineTo(558, doc.y + 2).strokeColor("#BBBBBB").stroke();
      doc.moveDown(0.35);
    } else if (bullet) {
      doc.font("Helvetica").fontSize(10).fillColor("#222222").text(
        `• ${line.replace(/^[-•*]\s+/u, "")}`,
        { indent: 8, paragraphGap: 2, lineGap: 1 },
      );
    } else {
      doc.font("Helvetica").fontSize(10).fillColor("#222222").text(line, {
        paragraphGap: documentType === "cover-letter" ? 8 : 3,
        lineGap: 1,
      });
    }
    firstContent = false;
  }
}

async function pdfBuffer(
  text: string,
  metadata: { Title: string; Author: string; Subject: string },
  documentType: "resume" | "cover-letter",
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 48, right: 54, bottom: 48, left: 54 },
      info: metadata,
      tagged: true,
      lang: "en-US",
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    renderLines(doc, text, documentType);
    doc.end();
  });
}

async function atomicWrite(path: string, data: Buffer | string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
  const temporary = join(directory, `.${basename(path)}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
    if (process.platform !== "win32") await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function exportApprovedMaterials(
  input: {
    profileId: string;
    job: LiveJob;
    jobDescriptionText: string;
    originalResumeText: string;
    tailoredResumeText: string;
    coverLetter?: string | undefined;
    proposedClaims: ProposedMaterialClaim[];
    approvedByUser?: boolean | undefined;
  },
  dataDir?: string,
) {
  if (!input.approvedByUser) {
    throw new Error("Exporting application materials requires applicant approval of the diff.");
  }
  if (!input.tailoredResumeText.trim()) throw new Error("Tailored resume text is empty.");
  const profile = await loadCandidateProfile(input.profileId, dataDir);
  const review = reviewApplicationMaterials({
    passport: profile.passport,
    job: input.job,
    jobDescriptionText: input.jobDescriptionText,
    originalResumeText: input.originalResumeText,
    tailoredResumeText: input.tailoredResumeText,
    ...(input.coverLetter ? { coverLetter: input.coverLetter } : {}),
    proposedClaims: input.proposedClaims,
  });
  if (review.decision === "blocked") {
    throw new Error(
      `Application materials failed evidence review: ${review.evidenceReview.blockingReasons.join("; ")}`,
    );
  }
  const createdAt = new Date().toISOString();
  const directory = join(
    localDataDir(dataDir),
    "materials",
    safeSegment(profile.profileId),
    `${safeSegment(input.job.employer)}-${safeSegment(input.job.title)}-${createHash("sha256").update(input.job.id).digest("hex").slice(0, 8)}`,
  );
  const resumePath = join(directory, "resume.pdf");
  const resumeSourcePath = join(directory, "resume-reviewed.txt");
  const manifestPath = join(directory, "evidence-manifest.json");
  const resumeText = cleanText(input.tailoredResumeText);
  const resumePdf = await pdfBuffer(
    resumeText,
    {
      Title: `${profile.label} — ${input.job.title}`,
      Author: profile.label,
      Subject: `Tailored resume for ${input.job.employer}`,
    },
    "resume",
  );
  await atomicWrite(resumePath, resumePdf);
  await atomicWrite(resumeSourcePath, `${resumeText}\n`);

  let coverLetterPath: string | null = null;
  if (input.coverLetter?.trim()) {
    coverLetterPath = join(directory, "cover-letter.pdf");
    await atomicWrite(
      coverLetterPath,
      await pdfBuffer(
        input.coverLetter,
        {
          Title: `${profile.label} — cover letter for ${input.job.title}`,
          Author: profile.label,
          Subject: `Cover letter for ${input.job.employer}`,
        },
        "cover-letter",
      ),
    );
  }
  const contentSha256 = createHash("sha256").update(resumeText).digest("hex");
  const evidence: ResumeEvidence = {
    kind: "resume",
    documentId: `resume_${contentSha256.slice(0, 16)}`,
    fileName: "resume.pdf",
    format: "pdf",
    localPath: resumePath,
    byteLength: resumePdf.byteLength,
    characterCount: resumeText.length,
    pageCount: null,
    contentSha256,
    importedAt: createdAt,
  };
  await atomicWrite(
    manifestPath,
    `${JSON.stringify(
      {
        version: "buffalo-materials-manifest/v1",
        createdAt,
        approvedByApplicant: true,
        profileId: profile.profileId,
        job: {
          id: input.job.id,
          employer: input.job.employer,
          title: input.job.title,
          officialJobUrl: input.job.officialJobUrl,
        },
        resume: evidence,
        coverLetterPath,
        evidenceReview: review.evidenceReview,
      },
      null,
      2,
    )}\n`,
  );
  return {
    status: "approved-materials-exported" as const,
    resume: evidence,
    coverLetterPath,
    resumeSourcePath,
    manifestPath,
    review,
    uploadInstruction:
      "Upload these exact reviewed files to this job only. If any material changes after export, review and export again before upload.",
  };
}
