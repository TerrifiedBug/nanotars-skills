"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAccounts = loadAccounts;
exports.listCalendars = listCalendars;
exports.getEvents = getEvents;
exports.deleteEvent = deleteEvent;
exports.createEvent = createEvent;
const tsdav_1 = require("tsdav");
const parser_1 = require("./parser");
const crypto_1 = require("crypto");
function loadAccounts() {
    const raw = process.env.CALDAV_ACCOUNTS;
    if (!raw) {
        console.error('Error: CALDAV_ACCOUNTS environment variable not set.');
        console.error('Configure it via the /add-cal skill or set it manually in .env');
        process.exit(1);
    }
    try {
        return JSON.parse(raw);
    }
    catch {
        console.error('Error: CALDAV_ACCOUNTS is not valid JSON');
        process.exit(1);
    }
}
async function createClient(account) {
    return (0, tsdav_1.createDAVClient)({
        serverUrl: account.serverUrl,
        credentials: { username: account.user, password: account.pass },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
    });
}
async function listCalendars(account) {
    const client = await createClient(account);
    const calendars = await client.fetchCalendars();
    return calendars.map((cal) => ({
        displayName: String(cal.displayName || cal.url),
        url: cal.url,
        account: account.name,
    }));
}
async function getEvents(account, from, to, calendarName) {
    const client = await createClient(account);
    let calendars = await client.fetchCalendars();
    if (calendarName) {
        calendars = calendars.filter((c) => String(c.displayName || '').toLowerCase() === calendarName.toLowerCase());
        if (calendars.length === 0) {
            console.error(`No calendar found matching "${calendarName}" in account "${account.name}"`);
            return [];
        }
    }
    const allEvents = [];
    for (const calendar of calendars) {
        const objects = await client.fetchCalendarObjects({
            calendar,
            timeRange: { start: from, end: to },
        });
        for (const obj of objects) {
            if (obj.data) {
                const events = (0, parser_1.parseICS)(obj.data, String(calendar.displayName || calendar.url), account.name);
                allEvents.push(...events);
            }
        }
    }
    return allEvents;
}
function toICSDate(iso) {
    return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function toICSDateOnly(iso) {
    // Extract YYYYMMDD from an ISO date string
    return iso.replace(/-/g, '').slice(0, 8);
}
function buildICalString(opts) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//NanoClaw//cal-cli//EN',
        'BEGIN:VEVENT',
        `UID:${opts.uid}`,
        `DTSTAMP:${toICSDate(new Date().toISOString())}`,
    ];
    if (opts.allDay) {
        lines.push(`DTSTART;VALUE=DATE:${toICSDateOnly(opts.start)}`);
        lines.push(`DTEND;VALUE=DATE:${toICSDateOnly(opts.end)}`);
    }
    else {
        lines.push(`DTSTART:${toICSDate(opts.start)}`);
        lines.push(`DTEND:${toICSDate(opts.end)}`);
    }
    lines.push(`SUMMARY:${opts.summary}`);
    if (opts.rrule)
        lines.push(opts.rrule.startsWith('RRULE:') ? opts.rrule : `RRULE:${opts.rrule}`);
    if (opts.location)
        lines.push(`LOCATION:${opts.location}`);
    if (opts.description)
        lines.push(`DESCRIPTION:${opts.description}`);
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n');
}
async function findCalendar(client, calendarName, accountName) {
    const calendars = await client.fetchCalendars();
    const match = calendars.find((c) => String(c.displayName || '').toLowerCase() === calendarName.toLowerCase());
    if (!match) {
        console.error(`No calendar found matching "${calendarName}" in account "${accountName}"`);
        console.error(`Available: ${calendars.map((c) => String(c.displayName || c.url)).join(', ')}`);
        return null;
    }
    return match;
}
async function deleteEvent(account, calendarName, search) {
    const client = await createClient(account);
    const calendar = await findCalendar(client, calendarName, account.name);
    if (!calendar)
        return false;
    // Fetch all objects from this calendar (wide time range to catch recurring events)
    const objects = await client.fetchCalendarObjects({ calendar });
    const searchLower = search.toLowerCase();
    const matches = objects.filter((obj) => {
        if (!obj.data)
            return false;
        const events = (0, parser_1.parseICS)(obj.data, calendarName, account.name);
        return events.some((e) => e.summary.toLowerCase().includes(searchLower) ||
            e.uid.toLowerCase() === searchLower);
    });
    if (matches.length === 0) {
        console.error(`No events matching "${search}" found in [${account.name}] ${calendarName}`);
        return false;
    }
    if (matches.length > 1) {
        console.error(`Multiple events match "${search}":`);
        for (const obj of matches) {
            const events = (0, parser_1.parseICS)(obj.data, calendarName, account.name);
            for (const e of events) {
                console.error(`  - "${e.summary}" (${e.start.toISOString()}) [uid: ${e.uid}]`);
            }
        }
        console.error('Please use a more specific title or the UID to match a single event.');
        return false;
    }
    const result = await client.deleteCalendarObject({ calendarObject: matches[0] });
    if (result.ok) {
        const events = (0, parser_1.parseICS)(matches[0].data, calendarName, account.name);
        const title = events[0]?.summary || search;
        console.log(`Deleted: "${title}" from [${account.name}] ${calendarName}`);
        return true;
    }
    else {
        console.error(`Failed to delete event: ${result.status} ${result.statusText}`);
        return false;
    }
}
async function createEvent(account, calendarName, title, start, end, options) {
    const client = await createClient(account);
    const calendar = await findCalendar(client, calendarName, account.name);
    if (!calendar)
        return false;
    const uid = `${(0, crypto_1.randomUUID)()}@nanoclaw`;
    const iCalString = buildICalString({
        uid,
        summary: title,
        start,
        end,
        allDay: options?.allDay,
        rrule: options?.rrule,
        location: options?.location,
        description: options?.description,
    });
    const result = await client.createCalendarObject({
        calendar,
        filename: `${uid}.ics`,
        iCalString,
    });
    if (result.ok) {
        console.log(`Event created: "${title}" on ${start}`);
        console.log(`Calendar: [${account.name}] ${calendarName}`);
        return true;
    }
    else {
        console.error(`Failed to create event: ${result.status} ${result.statusText}`);
        return false;
    }
}
