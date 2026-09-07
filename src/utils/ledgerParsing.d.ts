interface ParsingIssue { code: string; field: string; level: 'warning' | 'error'; message: string; }
export function empty(value: unknown): boolean;
export function text(value: unknown): string;
export function normalizeLookup(value: unknown): string;
export function parseNumber(value: unknown, field?: string): { value?: number; issue?: ParsingIssue };
export function parseHours(value: unknown): { value?: number; issue?: ParsingIssue };
export function parseDate(value: unknown, field: string): { value?: string; issue?: ParsingIssue };
export function parseExternalId(value: unknown): { value?: string; issue?: ParsingIssue };
export function parseDifficulty(value: unknown): { value?: number; issue?: ParsingIssue };
export function parseAcceptance(value: unknown): { value?: boolean; issue?: ParsingIssue };
export function splitPeople(value: unknown): string[];
