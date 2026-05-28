import { tool } from 'ai';
import { z } from 'zod';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const bookDemoTool = tool({
  description:
    'Book a sales demo for a prospect. Requires their email and a preferred date/time (ISO 8601). ' +
    'Returns a stub confirmation id and a Calendly-style URL.',
  parameters: z.object({
    email: z.string().describe('Prospect email address'),
    preferredAt: z
      .string()
      .describe('Preferred date/time in ISO 8601, e.g. 2026-06-01T15:00:00Z'),
    notes: z.string().optional().describe('Optional context for the sales team'),
  }),
  execute: async ({ email, preferredAt, notes }) => {
    if (!EMAIL_RE.test(email)) {
      return { ok: false as const, error: `invalid email: ${email}` };
    }
    const when = new Date(preferredAt);
    if (Number.isNaN(when.getTime())) {
      return { ok: false as const, error: `invalid preferredAt: ${preferredAt}` };
    }
    const id = `demo_${Math.random().toString(36).slice(2, 10)}`;
    return {
      ok: true as const,
      confirmationId: id,
      scheduledFor: when.toISOString(),
      email,
      notes: notes ?? null,
      calendarUrl: `https://acme.example/demos/${id}`,
    };
  },
});
