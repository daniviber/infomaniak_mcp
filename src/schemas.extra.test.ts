/**
 * Tests for the kDrive and Calendar validation schemas.
 */

import { describe, it, expect } from "vitest";
import {
  validate,
  KDriveListFilesSchema,
  KDriveSearchSchema,
  KDriveCreateDirectorySchema,
  KDriveUploadSchema,
  KDriveCreateShareLinkSchema,
  KDriveInviteAccessSchema,
  RenameKDriveFileSchema,
  CalendarListEventsSchema,
  CalendarCreateEventSchema,
  CalendarUpdateEventSchema,
  CalendarEventIdSchema,
} from "./schemas.js";

describe("kDrive schemas", () => {
  it("accepts a minimal list request", () => {
    expect(validate(KDriveListFilesSchema, { drive_id: 1 })).toEqual({ drive_id: 1 });
  });

  it("rejects out-of-range limits and unknown types", () => {
    expect(() => validate(KDriveListFilesSchema, { drive_id: 1, limit: 0 })).toThrow(/limit/);
    expect(() => validate(KDriveListFilesSchema, { drive_id: 1, limit: 201 })).toThrow(/limit/);
    expect(() => validate(KDriveListFilesSchema, { drive_id: 1, type: "vault" })).toThrow(/type/);
  });

  it("requires a query for search", () => {
    expect(() => validate(KDriveSearchSchema, { drive_id: 1 })).toThrow(/query is required/);
    expect(validate(KDriveSearchSchema, { drive_id: 1, query: "x", depth: "child" }).depth).toBe("child");
  });

  it("rejects names containing path separators", () => {
    expect(() => validate(KDriveCreateDirectorySchema, { drive_id: 1, name: "a/b" })).toThrow(/path separators/);
    expect(() => validate(RenameKDriveFileSchema, { drive_id: 1, file_id: 2, name: ".." })).toThrow(/path separators/);
    expect(validate(RenameKDriveFileSchema, { drive_id: 1, file_id: 2, name: "rapport final.pdf" }).name).toBe("rapport final.pdf");
  });

  it("requires exactly one content field for uploads", () => {
    expect(() => validate(KDriveUploadSchema, { drive_id: 1, file_name: "a.txt" })).toThrow(/exactly one/);
    expect(() => validate(KDriveUploadSchema, { drive_id: 1, file_name: "a.txt", text_content: "x", base64_content: "eA==" })).toThrow(/exactly one/);
    expect(() => validate(KDriveUploadSchema, { drive_id: 1, file_name: "a.bin", base64_content: "not base64!!" })).toThrow(/base64/);
    expect(validate(KDriveUploadSchema, { drive_id: 1, file_name: "a.txt", text_content: "hello" }).text_content).toBe("hello");
  });

  it("requires a password for password protected links", () => {
    expect(() => validate(KDriveCreateShareLinkSchema, { drive_id: 1, file_id: 2, right: "password" })).toThrow(/password is required/);
    expect(validate(KDriveCreateShareLinkSchema, { drive_id: 1, file_id: 2, right: "public", can_download: true }).can_download).toBe(true);
  });

  it("validates invitation e-mails and rights", () => {
    expect(() => validate(KDriveInviteAccessSchema, { drive_id: 1, file_id: 2, emails: ["nope"], right: "read" })).toThrow(/email/);
    expect(() => validate(KDriveInviteAccessSchema, { drive_id: 1, file_id: 2, emails: ["a@b.ch"], right: "owner" })).toThrow(/right/);
    expect(() => validate(KDriveInviteAccessSchema, { drive_id: 1, file_id: 2, emails: [], right: "read" })).toThrow(/emails/);
  });
});

describe("Calendar schemas", () => {
  it("requires from/to for listing", () => {
    expect(() => validate(CalendarListEventsSchema, { from: "2025-05-28" })).toThrow(/to/);
    expect(validate(CalendarListEventsSchema, { from: "2025-05-28", to: "2025-05-29", calendar_id: "abc" }).calendar_id).toBe("abc");
  });

  it("accepts numeric or string ids", () => {
    expect(validate(CalendarEventIdSchema, { event_id: 12 }).event_id).toBe(12);
    expect(validate(CalendarEventIdSchema, { event_id: "12" }).event_id).toBe("12");
    expect(() => validate(CalendarEventIdSchema, {})).toThrow(/event_id/);
  });

  it("validates event creation", () => {
    const ok = validate(CalendarCreateEventSchema, {
      title: "Réunion",
      start: "2025-05-28 10:00:00",
      end: "2025-05-28 11:00:00",
      attendees: ["a@example.com"],
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    });
    expect(ok.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(() => validate(CalendarCreateEventSchema, { start: "2025-05-28 10:00:00", end: "2025-05-28 11:00:00" })).toThrow(/title is required/);
    expect(() => validate(CalendarCreateEventSchema, { title: "x", start: "2025-05-28 10:00:00", end: "2025-05-28 11:00:00", attendees: ["bad"] })).toThrow(/attendees/);
    expect(() => validate(CalendarCreateEventSchema, { title: "x", start: "2025-05-28 10:00:00", end: "2025-05-28 11:00:00", rrule: "every monday" })).toThrow(/rrule/);
  });

  it("allows clearing the recurrence on update", () => {
    expect(validate(CalendarUpdateEventSchema, { event_id: 1, rrule: "" }).rrule).toBe("");
  });
});
