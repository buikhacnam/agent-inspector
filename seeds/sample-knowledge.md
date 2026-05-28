# Acme Corp — Company & Product FAQ

## About Acme
Acme Corp is a B2B SaaS company founded in 2017, headquartered in Lisbon with
remote teams across the EU and Americas. We build a unified customer
intelligence platform that helps revenue teams unify their CRM, product
analytics, and conversation data into a single source of truth. Roughly 1,200
companies use Acme today, including teams at mid-market and enterprise SaaS,
fintech, and B2B marketplaces.

## What we sell
Acme has three products that can be bought standalone or together:
- **Acme Pulse** — a customer data platform (CDP) that ingests events from your
  product, CRM, billing, and support tools and resolves them to unified user
  and account profiles in near-real-time (under 30 seconds end-to-end).
- **Acme Signal** — an AI scoring engine that runs on top of Pulse. It surfaces
  expansion, churn, and PQL signals as webhooks, Slack alerts, or Salesforce
  tasks. Models are tuned per workspace; we never train on customer data.
- **Acme Reach** — a lightweight outbound workspace with email sequencing, a
  shared inbox, and AI reply drafting. Reach plugs directly into Pulse audiences,
  so list-building is just a filter, not an export.

Pricing tiers, add-ons, and seat counts are managed in our pricing system —
the assistant should call `search_products` rather than quote numbers from
memory.

## Security & compliance
Acme is **SOC 2 Type II** (renewed annually, latest report Jan 2026), **GDPR**
compliant, and **HIPAA** ready under a signed BAA on the Enterprise tier.
All data is encrypted at rest with AES-256 and in transit with TLS 1.3. EU
customers can elect EU-only data residency (Frankfurt region, hosted on GCP).
We support SSO (SAML 2.0 + OIDC) on the Growth tier and above, SCIM provisioning
on Enterprise, and customer-managed encryption keys (CMEK) on Enterprise.
Audit logs are retained for 13 months and exportable to S3 or BigQuery.

## Onboarding
Standard onboarding is **3 weeks**: week 1 is data source connection and
identity resolution review, week 2 is model tuning and alert routing, week 3 is
team training and go-live. Enterprise customers get a named CSM, a Slack
Connect channel, and a co-built rollout plan. There is **no professional
services fee** on Growth or Enterprise; Starter is self-serve with async
support. We provide a sandbox workspace at no extra cost for the first 60 days.

## Integrations
Native integrations available out of the box:
- **CRM**: Salesforce, HubSpot, Pipedrive, Close, Attio
- **Product analytics**: Segment, Rudderstack, Snowplow, native SDKs (JS, iOS, Android, Python, Go)
- **Warehouses**: Snowflake, BigQuery, Databricks, Redshift (reverse ETL supported, no Hightouch needed)
- **Comms**: Slack, MS Teams, Gmail, Outlook
- **Support**: Zendesk, Intercom, Help Scout, Front
- **Billing**: Stripe, Chargebee, Recurly
Anything not on the list can be connected via webhooks, a generic SQL connector,
or our REST/GraphQL APIs. SLA on connector reliability is 99.9% on Growth, 99.99%
on Enterprise.

## How we compare
- **vs Segment**: Segment is great at *event collection*. Acme Pulse ingests
  Segment streams and adds identity resolution, account-level rollups, AI
  scoring, and reverse-ETL — Segment doesn't do the last three natively.
- **vs HubSpot/Salesforce alone**: CRMs store the *deal*; Acme stores the
  *behaviour* around the deal. Most customers run Acme alongside their CRM
  and sync scored accounts back into it.
- **vs Customer.io / Braze**: Those are messaging tools. Reach handles outbound,
  but for in-app/lifecycle messaging we recommend keeping your existing tool
  and using Pulse audiences as the source of truth.
- **vs building in-house on dbt + reverse ETL**: Cheaper-looking on paper,
  but customers typically tell us the maintenance cost (identity resolution,
  schema drift, model retraining) outweighs the licence within 18 months.

## Support & SLAs
- **Starter**: email support, < 24h response, business hours (CET + PT).
- **Growth**: email + chat, < 4h response, extended hours.
- **Enterprise**: 24/7 support, < 1h response on P1, named CSM, dedicated
  Slack Connect channel. 99.9% uptime SLA with service credits.

## Common questions
- *Can I trial Acme?* Yes — 14-day free trial on Starter, no card required; or
  a 30-day proof-of-value on Growth with a CSM, if you can share a use case.
- *Do you offer discounts?* Annual prepay gets you 2 months free across all
  tiers. Startups under 2 years old and < $5M ARR qualify for 30% off the first
  year — apply via the form on acmecorp.example/startups.
- *How long is the contract?* Monthly or annual on Starter/Growth; annual only
  on Enterprise. No multi-year lock-in required.
- *Can I cancel?* Yes, any time, no fees. Annual plans are non-refundable but
  remain active through the term.
- *Do you train AI on customer data?* No. Models are scoped to your workspace
  and are not used to improve cross-customer models. You can disable AI features
  entirely in workspace settings.
- *Who owns the data?* You do. We're a processor under GDPR; you can export or
  delete your workspace data at any time via API or a one-click workspace
  delete.

## Booking a demo
Demos run 30 minutes with a solutions engineer, ideally with at least one
person from RevOps and one from product. Bring a sample question you'd like
answered live (e.g. "what does churn risk look like for accounts < $10k MRR?").
Slots are available Mon–Thu, 9:00–18:00 in the requester's local timezone.