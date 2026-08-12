import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { importResume } from "../src/resume.js";

function minimalPdf(text: string): Buffer {
  const escaped = text.replace(/\\/gu, "\\\\").replace(/\(/gu, "\\(").replace(/\)/gu, "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

async function minimalDocx(text: string): Promise<Buffer> {
  const escaped = text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escaped}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

test("asks once for a resume when the host has no accessible file or text", async () => {
  const result = await importResume({});

  assert.equal(result.status, "needs-resume");
  assert.match(result.prompt, /upload a resume/);
  assert.deepEqual(result.acceptedFormats, ["pdf", "docx", "txt", "md"]);
});

test("imports pasted resume text locally and marks it as unconfirmed evidence", async () => {
  const result = await importResume({
    fileName: "resume.txt",
    text: [
      "Example Candidate",
      "candidate@example.com | (716) 555-0100",
      "https://www.linkedin.com/in/example",
      "Software Engineer — Example Company",
      "Built customer-facing TypeScript applications.",
    ].join("\n"),
  });

  assert.equal(result.status, "ready-for-fact-extraction");
  assert.equal(result.detectedFacts.possibleName, "Example Candidate");
  assert.deepEqual(result.detectedFacts.emails, ["candidate@example.com"]);
  assert.equal(result.trust.source, "resume-evidence");
  assert.equal(result.trust.confirmedByApplicant, false);
});

test("extracts readable text from local PDF and DOCX resumes", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "buffalo-resume-test-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const pdfPath = join(directory, "resume.pdf");
  const docxPath = join(directory, "resume.docx");
  await writeFile(
    pdfPath,
    minimalPdf("Example Candidate software engineer candidate@example.com Buffalo New York"),
  );
  await writeFile(
    docxPath,
    await minimalDocx(
      "Example Candidate software engineer candidate@example.com Buffalo New York",
    ),
  );

  const pdf = await importResume({ path: pdfPath });
  const docx = await importResume({ path: docxPath });

  assert.equal(pdf.status, "ready-for-fact-extraction");
  assert.match(pdf.extractedText, /software engineer/);
  assert.equal(pdf.evidence.format, "pdf");
  assert.equal(docx.status, "ready-for-fact-extraction");
  assert.match(docx.extractedText, /candidate@example\.com/);
  assert.equal(docx.evidence.format, "docx");
});
