import { tool } from 'ai';
import { z } from 'zod';

interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  priceUsd: number;
  blurb: string;
}

const CATALOG: CatalogEntry[] = [
  {
    id: 'starter-plan',
    name: 'Starter Plan',
    category: 'plan',
    priceUsd: 29,
    blurb: '3 seats, 10 GB storage, community support. Best for solo founders.',
  },
  {
    id: 'pro-plan',
    name: 'Pro Plan',
    category: 'plan',
    priceUsd: 79,
    blurb:
      '10 seats, 100 GB, priority email + chat support, SSO. Best for growing teams.',
  },
  {
    id: 'enterprise-plan',
    name: 'Enterprise Plan',
    category: 'plan',
    priceUsd: 0,
    blurb:
      'Custom pricing. Unlimited seats, SLA, dedicated CSM, on-prem option.',
  },
  {
    id: 'addon-analytics',
    name: 'Analytics Add-on',
    category: 'addon',
    priceUsd: 19,
    blurb: 'Funnel + cohort dashboards, CSV export, 90-day retention.',
  },
];

export const searchProductsTool = tool({
  description:
    'Search the Acme product catalog for plans or add-ons. ' +
    'Pass an empty query to list all products (useful for "cheapest", "most expensive", "what do you offer"). ' +
    'Use sortBy=price_asc for cheapest, price_desc for most expensive. ' +
    'Returns id, name, category, monthly price (USD; 0 = custom/contact sales), and a short blurb.',
  parameters: z.object({
    query: z
      .string()
      .describe(
        'Free-text search, e.g. "pro plan", "analytics". Empty string = return all.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Max results (default 3)'),
    sortBy: z
      .enum(['relevance', 'price_asc', 'price_desc'])
      .optional()
      .describe(
        'Sort order. Default relevance. price_asc excludes custom-priced (0) entries.',
      ),
  }),
  execute: async ({ query, limit, sortBy }) => {
    const needle = query.toLowerCase().trim();
    const max = limit ?? 3;
    const order = sortBy ?? 'relevance';

    const scored = CATALOG.map((entry) => {
      const hay =
        `${entry.name} ${entry.category} ${entry.blurb}`.toLowerCase();
      let score = 0;
      if (needle) {
        for (const token of needle.split(/\s+/).filter(Boolean)) {
          if (hay.includes(token)) score += 1;
        }
      } else {
        score = 1;
      }
      return { entry, score };
    }).filter((r) => r.score > 0);

    if (order === 'price_asc') {
      scored.sort((a, b) => {
        const ap = a.entry.priceUsd === 0 ? Infinity : a.entry.priceUsd;
        const bp = b.entry.priceUsd === 0 ? Infinity : b.entry.priceUsd;
        return ap - bp;
      });
    } else if (order === 'price_desc') {
      scored.sort((a, b) => b.entry.priceUsd - a.entry.priceUsd);
    } else {
      scored.sort((a, b) => b.score - a.score);
    }

    const results = scored.slice(0, max).map((r) => r.entry);
    return { query, sortBy: order, count: results.length, results };
  },
});
