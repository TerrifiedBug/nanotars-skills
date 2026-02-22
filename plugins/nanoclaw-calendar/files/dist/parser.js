"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseICS = parseICS;
const ical = __importStar(require("node-ical"));
function parseICS(data, calendarName, accountName) {
    const parsed = ical.parseICS(data);
    const events = [];
    for (const [key, component] of Object.entries(parsed)) {
        if (component.type !== 'VEVENT')
            continue;
        const vevent = component;
        events.push({
            uid: vevent.uid || key,
            summary: vevent.summary || '(no title)',
            start: vevent.start instanceof Date ? vevent.start : new Date(vevent.start),
            end: vevent.end instanceof Date ? vevent.end : new Date(vevent.end),
            location: vevent.location || undefined,
            description: vevent.description || undefined,
            allDay: vevent.datetype === 'date',
            calendar: calendarName,
            account: accountName,
        });
    }
    return events;
}
