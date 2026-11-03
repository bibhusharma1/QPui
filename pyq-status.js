/* PYQ processing-status detection helpers.
   Pure, dependency-free utilities used by the PYQs page and by tests. */
(function (root) {
    "use strict";

    var IDENTIFIER_KEYS = [
        "filename", "file", "name", "relative_path", "relativePath",
        "path", "pdf", "pdf_path", "pdfPath", "source_file", "sourceFile", "source"
    ];

    function trimString(value) {
        return String(value == null ? "" : value).trim();
    }

    function normalizeSubject(value) {
        return trimString(value).toLowerCase();
    }

    function normalizePdfIdentifier(value) {
        if (value == null) return "";
        if (typeof value === "object") {
            // Try the most common identifier fields first.
            for (var i = 0; i < IDENTIFIER_KEYS.length; i++) {
                var key = IDENTIFIER_KEYS[i];
                if (value[key] != null) return normalizePdfIdentifier(value[key]);
            }
            return "";
        }
        var result = trimString(value);
        // Strip a "pyq:" source prefix if present.
        if (result.toLowerCase().indexOf("pyq:") === 0) {
            result = result.slice(4).trim();
        }
        result = result.replace(/\\/g, "/");
        result = result.replace(/^\.\//, "");
        result = result.replace(/\/{2,}/g, "/");
        result = result.replace(/\/+$/, "");
        result = result.trim();
        return result;
    }

    function basenameOf(value) {
        var normalized = normalizePdfIdentifier(value);
        if (!normalized) return "";
        var parts = normalized.split("/");
        return parts[parts.length - 1];
    }

    function collectIdentifiers(item) {
        if (item == null) return [];
        var out = [];
        if (typeof item === "string") {
            out.push(item);
        } else {
            for (var i = 0; i < IDENTIFIER_KEYS.length; i++) {
                var key = IDENTIFIER_KEYS[i];
                if (item[key] != null) {
                    var value = item[key];
                    if (key === "source" && typeof value === "string" &&
                        value.toLowerCase().indexOf("pyq:") === 0) {
                        value = value.slice(4);
                    }
                    out.push(value);
                }
            }
        }
        var normalized = out.map(normalizePdfIdentifier).filter(Boolean);
        // Also index by basename so a bare filename can match a relative path.
        var withBasenames = normalized.slice();
        normalized.forEach(function (id) {
            var base = basenameOf(id);
            if (base && withBasenames.indexOf(base) === -1) {
                withBasenames.push(base);
            }
        });
        return withBasenames;
    }

    function normalizeStatus(status) {
        if (status == null) return "";
        var value = trimString(status).toLowerCase().replace(/[\s-]+/g, "_");
        var map = {
            completed: "completed",
            complete: "completed",
            done: "completed",
            success: "succeeded",
            succeeded: "succeeded",
            ready: "succeeded",
            processing: "processing",
            running: "processing",
            queued: "queued",
            failed: "failed",
            error: "failed",
            errored: "failed",
            not_processed: "not_processed",
            notprocessed: "not_processed",
            unprocessed: "not_processed",
            pending: "not_processed"
        };
        return map[value] || value;
    }

    function isResultAvailable(status) {
        var normalized = normalizeStatus(status);
        return normalized === "completed" || normalized === "succeeded";
    }

    function findPdfRecord(pdf, records, subject) {
        var pdfIds = new Set(collectIdentifiers(pdf));
        var candidates = Array.isArray(records) ? records : [];
        var filtered = candidates;
        if (subject) {
            filtered = candidates.filter(function (record) {
                if (!record || record.subject == null) return true;
                return normalizeSubject(record.subject) === normalizeSubject(subject);
            });
        }
        for (var i = 0; i < filtered.length; i++) {
            var recordIds = collectIdentifiers(filtered[i]);
            if (recordIds.some(function (id) { return pdfIds.has(id); })) {
                return filtered[i];
            }
        }
        // If subject filtering removed everything, do not fall back across subjects.
        return null;
    }

    function resolvePdfStatus(pdf, records, subject) {
        if (records && Array.isArray(records) && records.length) {
            var record = findPdfRecord(pdf, records, subject);
            if (record) {
                var status = record.status != null ? record.status :
                    (record.processing_status != null ? record.processing_status :
                        (record.state != null ? record.state : "completed"));
                return normalizeStatus(status);
            }
            return "not_processed";
        }
        // No records supplied: rely on the PDF's own status / result flag.
        if (pdf && pdf.status != null && String(pdf.status).trim() !== "") {
            var own = normalizeStatus(pdf.status);
            if (own === "not_processed" && pdf.result_available) {
                return "completed";
            }
            return own;
        }
        if (pdf && pdf.result_available) return "completed";
        return "not_processed";
    }

    function applyPdfStatuses(pdfs, records, subject) {
        var list = Array.isArray(pdfs) ? pdfs : [];
        return list.map(function (pdf) {
            var status = resolvePdfStatus(pdf, records, subject);
            var merged = {};
            if (pdf && typeof pdf === "object") {
                for (var key in pdf) {
                    if (Object.prototype.hasOwnProperty.call(pdf, key)) merged[key] = pdf[key];
                }
            }
            merged.status = status;
            if (merged.result_available == null) {
                merged.result_available = isResultAvailable(status);
            } else if (isResultAvailable(status)) {
                merged.result_available = true;
            }
            return merged;
        });
    }

    var api = {
        normalizePdfIdentifier: normalizePdfIdentifier,
        normalizePath: normalizePdfIdentifier,
        normalizeFilename: normalizePdfIdentifier,
        normalizeSubject: normalizeSubject,
        normalizeStatus: normalizeStatus,
        collectIdentifiers: collectIdentifiers,
        findPdfRecord: findPdfRecord,
        resolvePdfStatus: resolvePdfStatus,
        detectPdfStatus: resolvePdfStatus,
        isResultAvailable: isResultAvailable,
        applyPdfStatuses: applyPdfStatuses,
        applyStatuses: applyPdfStatuses
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.PYQStatus = api;
        root.PYQStatusDetection = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));