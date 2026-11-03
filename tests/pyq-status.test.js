const test = require("node:test");
const assert = require("node:assert/strict");
const { resolvePdfStatus, applyPdfStatuses, normalizePdfIdentifier } = require("../pyq-status.js");

test("processed PDF matched by filename returns completed", () => {
    const pdfs = [{ filename: "operating_systems_regular.pdf" }];
    const records = [{ filename: "operating_systems_regular.pdf", status: "completed" }];
    const result = applyPdfStatuses(pdfs, records, "OperatingSys");
    assert.equal(result[0].status, "completed");
});

test("processed PDF matched by relative path returns completed", () => {
    const pdfs = [{ filename: "paper.pdf", relative_path: "OperatingSys/source/paper.pdf" }];
    const records = [{ relative_path: "OperatingSys/source/paper.pdf", status: "completed" }];
    const result = applyPdfStatuses(pdfs, records, "OperatingSys");
    assert.equal(result[0].status, "completed");
});

test("unprocessed PDF absent from records returns not_processed", () => {
    const pdfs = [{ filename: "unprocessed.pdf" }];
    const records = [{ filename: "other.pdf", status: "completed" }];
    const result = applyPdfStatuses(pdfs, records, "OperatingSys");
    assert.equal(result[0].status, "not_processed");
});

test("failed PDF returns failed", () => {
    const pdfs = [{ filename: "failed.pdf" }];
    const records = [{ filename: "failed.pdf", status: "failed" }];
    const result = applyPdfStatuses(pdfs, records, "OperatingSys");
    assert.equal(result[0].status, "failed");
});

test("processing PDF returns processing", () => {
    const pdfs = [{ filename: "running.pdf" }];
    const records = [{ filename: "running.pdf", status: "processing" }];
    const result = applyPdfStatuses(pdfs, records, "OperatingSys");
    assert.equal(result[0].status, "processing");
});

test("similarly named PDFs do not false match", () => {
    const pdfs = [
        { filename: "paper_mid.pdf" },
        { filename: "paper_end.pdf" }
    ];
    const records = [{ filename: "paper_mid.pdf", status: "completed" }];
    const result = applyPdfStatuses(pdfs, records, "OperatingSys");
    assert.equal(result[0].status, "completed");
    assert.equal(result[1].status, "not_processed");
});

test("MID and END papers are distinguished", () => {
    const pdfs = [{ filename: "2024_MID.pdf" }, { filename: "2024_END.pdf" }];
    const records = [
        { filename: "2024_MID.pdf", status: "completed" },
        { filename: "2024_END.pdf", status: "failed" }
    ];
    const result = applyPdfStatuses(pdfs, records, "OperatingSys");
    assert.equal(result[0].status, "completed");
    assert.equal(result[1].status, "failed");
});

test("different subjects do not false match", () => {
    const pdfs = [{ filename: "paper.pdf" }];
    const records = [{ subject: "Maths", filename: "paper.pdf", status: "completed" }];
    const result = applyPdfStatuses(pdfs, records, "OperatingSys");
    assert.equal(result[0].status, "not_processed");
});

test("normalization trims whitespace and slashes", () => {
    assert.equal(normalizePdfIdentifier("  ./a//b.pdf  "), "a/b.pdf");
    const pdfs = [{ filename: "  paper.pdf " }];
    const records = [{ filename: "paper.pdf", status: "completed" }];
    const result = applyPdfStatuses(pdfs, records, "OperatingSys");
    assert.equal(result[0].status, "completed");
});

test("resolvePdfStatus direct", () => {
    const status = resolvePdfStatus({ filename: "x.pdf" }, [{ filename: "x.pdf", status: "completed" }], "S");
    assert.equal(status, "completed");
});