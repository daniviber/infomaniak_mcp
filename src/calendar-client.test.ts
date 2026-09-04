/**
 * Unit tests for CalendarClient and its date helpers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CalendarClient, formatInTimeZone, normalizeApiDate, toApiDateTime } from "./calendar-client.js";
import type { InfomaniakClient } from "./infomaniak-client.js";

describe("date helpers", () => {
  it("formats an instant as wall-clock time in a timezone", () => {
    expect(formatInTimeZone(new Date("2025-01-15T23:30:00Z"), "Asia/Tokyo")).toBe("2025-01-16 08:30:00");
    expect(formatInTimeZone(new Date("2025-07-01T00:00:00Z"), "Europe/Zurich")).toBe("2025-07-01 02:00:00");
    expect(formatInTimeZone(new Date("2025-07-01T00:00:00Z"), "UTC")).toBe("2025-07-01 00:00:00");
  });

  it("keeps wall-clock inputs untouched", () => {
    expect(toApiDateTime("2025-05-28 12:00:00", "Europe/Zurich")).toBe("2025-05-28 12:00:00");
    expect(toApiDateTime("2025-05-28T12:00", "Europe/Zurich")).toBe("2025-05-28 12:00:00");
    expect(toApiDateTime("2025-05-28 09:05", "Asia/Tokyo")).toBe("2025-05-28 09:05:00");
  });

  it("expands date-only inputs to the start or end of day", () => {
    expect(toApiDateTime("2025-05-28", "Europe/Zurich")).toBe("2025-05-28 00:00:00");
    expect(toApiDateTime("2025-05-28", "Europe/Zurich", true)).toBe("2025-05-28 23:59:59");
  });

  it("converts inputs with an explicit offset into the target timezone", () => {
    expect(toApiDateTime("2025-05-28T10:00:00Z", "Europe/Zurich")).toBe("2025-05-28 12:00:00");
    expect(toApiDateTime("2025-05-28T10:00:00+02:00", "Europe/Zurich")).toBe("2025-05-28 10:00:00");
    expect(toApiDateTime("2025-12-01T10:00:00-05:00", "Europe/Zurich")).toBe("2025-12-01 16:00:00");
  });

  it("rejects garbage", () => {
    expect(() => toApiDateTime("tomorrow at noon", "Europe/Zurich")).toThrow(/Invalid date/);
    expect(() => toApiDateTime("2025-13-45T99:00:00Z", "Europe/Zurich")).toThrow(/Invalid date/);
  });

  it("normalizes API dates", () => {
    expect(normalizeApiDate("2025-05-28T12:00:00+02:00")).toBe("2025-05-28 12:00:00");
    expect(normalizeApiDate("2025-05-28 12:00:00")).toBe("2025-05-28 12:00:00");
    expect(normalizeApiDate("2025-05-28T12:00:00Z")).toBe("2025-05-28 12:00:00");
  });
});

describe("CalendarClient", () => {
  const call = vi.fn();
  const api = { call } as unknown as InfomaniakClient;
  let client: CalendarClient;

  const profile = { result: "success", data: { id: 1, email: "me@example.com", display_name: "Me", preferences: { timezone: { name: "Europe/Zurich" } } } };
  const calendars = { result: "success", data: { calendars: [{ id: 5, name: "Other" }, { id: 7, name: "Perso", default: true }] } };

  beforeEach(() => {
    call.mockReset();
    client = new CalendarClient(api);
  });

  it("lists calendars from /1/calendar/pim/calendar", async () => {
    call.mockResolvedValueOnce(calendars);
    const list = await client.listCalendars();
    expect(call).toHaveBeenCalledWith("GET", "/1/calendar/pim/calendar");
    expect(list.map((c) => c.id)).toEqual([5, 7]);
  });

  it("lists events on the default calendar with normalized dates", async () => {
    call.mockResolvedValueOnce(profile).mockResolvedValueOnce(calendars).mockResolvedValueOnce({ result: "success", data: [] });
    await client.listEvents({ from: "2025-05-28", to: "2025-05-29" });
    expect(call).toHaveBeenLastCalledWith("GET", "/1/calendar/pim/event", undefined, {
      calendar_id: "7",
      from: "2025-05-28 00:00:00",
      to: "2025-05-29 23:59:59",
    });
  });

  it("uses an explicit calendar and timezone", async () => {
    call.mockResolvedValueOnce({ result: "success", data: [] });
    await client.listEvents({ from: "2025-05-28T10:00:00Z", to: "2025-05-28T12:00:00Z", calendar_id: 5, timezone: "Asia/Tokyo" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("GET", "/1/calendar/pim/event", undefined, {
      calendar_id: "5",
      from: "2025-05-28 19:00:00",
      to: "2025-05-28 21:00:00",
    });
  });

  it("creates an event with attendees and the organizer", async () => {
    call.mockResolvedValueOnce(profile).mockResolvedValueOnce(calendars).mockResolvedValueOnce({ result: "success", data: { id: 99 } });
    await client.createEvent({
      title: "Réunion",
      start: "2025-05-28 10:00:00",
      end: "2025-05-28 11:00:00",
      attendees: ["a@example.com"],
      location: "Genève",
      rrule: "FREQ=WEEKLY;BYDAY=WE",
    });
    const [method, path, body] = call.mock.calls[2] as [string, string, Record<string, unknown>];
    expect(method).toBe("POST");
    expect(path).toBe("/1/calendar/pim/event");
    expect(body).toMatchObject({
      title: "Réunion",
      start: "2025-05-28 10:00:00",
      end: "2025-05-28 11:00:00",
      calendar_id: "7",
      timezone_start: "Europe/Zurich",
      timezone_end: "Europe/Zurich",
      location: "Genève",
      rrule: "FREQ=WEEKLY;BYDAY=WE",
      fullday: false,
      freebusy: "busy",
      type: "event",
    });
    const attendees = body.attendees as Array<{ address: string; organizer: boolean; state: string }>;
    expect(attendees).toHaveLength(2);
    expect(attendees[0]).toMatchObject({ address: "a@example.com", organizer: false, state: "NEEDS-ACTION" });
    expect(attendees[1]).toMatchObject({ address: "me@example.com", organizer: true, state: "ACCEPTED" });
  });

  it("does not send location or rrule when not provided", async () => {
    call.mockResolvedValueOnce(profile).mockResolvedValueOnce(calendars).mockResolvedValueOnce({ result: "success", data: {} });
    await client.createEvent({ title: "x", start: "2025-05-28 10:00:00", end: "2025-05-28 11:00:00" });
    const body = call.mock.calls[2][2] as Record<string, unknown>;
    expect(body).not.toHaveProperty("location");
    expect(body).not.toHaveProperty("rrule");
    expect(body.attendees).toEqual([]);
  });

  it("merges updates into the existing event", async () => {
    const existing = {
      result: "success",
      data: {
        id: 42,
        calendar_id: 7,
        title: "Old",
        description: "desc",
        start: "2025-05-28T10:00:00+02:00",
        end: "2025-05-28T11:00:00+02:00",
        timezone_start: "Europe/Zurich",
        attendees: [{ address: "keep@example.com" }],
        alarms: [{ trigger: "-PT10M" }],
        rrule: "FREQ=DAILY",
      },
    };
    call.mockResolvedValueOnce(existing).mockResolvedValueOnce(profile).mockResolvedValueOnce({ result: "success", data: {} });
    await client.updateEvent(42, { title: "New", end: "2025-05-28 12:00:00" });
    const [method, path, body] = call.mock.calls[2] as [string, string, Record<string, unknown>];
    expect(method).toBe("PUT");
    expect(path).toBe("/1/calendar/pim/event/42");
    expect(body).toMatchObject({
      id: 42,
      calendar_id: "7",
      title: "New",
      description: "desc",
      start: "2025-05-28 10:00:00",
      end: "2025-05-28 12:00:00",
      attendees: [{ address: "keep@example.com" }],
      alarms: [{ trigger: "-PT10M" }],
      rrule: "FREQ=DAILY",
      notifyAttendees: false,
    });
  });

  it("removes the recurrence when rrule is an empty string", async () => {
    call
      .mockResolvedValueOnce({ result: "success", data: { id: 1, calendar_id: 7, title: "t", start: "2025-01-01 10:00:00", end: "2025-01-01 11:00:00", rrule: "FREQ=DAILY" } })
      .mockResolvedValueOnce(profile)
      .mockResolvedValueOnce({ result: "success", data: {} });
    await client.updateEvent("1", { rrule: "" });
    expect((call.mock.calls[2][2] as Record<string, unknown>).rrule).toBe("");
  });

  it("looks up the calendar before deleting when not provided", async () => {
    call.mockResolvedValueOnce({ result: "success", data: { id: 9, calendar_id: 5 } }).mockResolvedValueOnce({ result: "success", data: true });
    await client.deleteEvent(9);
    expect(call).toHaveBeenLastCalledWith("DELETE", "/1/calendar/pim/event/9", undefined, { calendar_id: "5" });
  });

  it("encodes event ids in the path", async () => {
    call.mockResolvedValueOnce({ result: "success", data: {} });
    await client.getEvent("../evil");
    expect(call).toHaveBeenCalledWith("GET", "/1/calendar/pim/event/..%2Fevil");
  });

  it("fails clearly when the token has no calendar", async () => {
    call.mockResolvedValueOnce(profile).mockResolvedValueOnce({ result: "success", data: { calendars: [] } });
    await expect(client.listEvents({ from: "2025-05-28", to: "2025-05-28" })).rejects.toThrow(/No calendar found/);
  });

  it("rejects invalid timezones", async () => {
    await expect(client.listEvents({ from: "2025-05-28", to: "2025-05-28", calendar_id: 1, timezone: "Mars/Olympus" })).rejects.toThrow(/Invalid IANA timezone/);
  });
});
