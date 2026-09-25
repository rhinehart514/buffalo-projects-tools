import { z } from "zod";

export const opportunityKinds = [
  "accelerator",
  "capital",
  "grant",
  "permit",
  "procurement",
  "technical-assistance",
  "resource-directory",
] as const;

export type OpportunityKind = (typeof opportunityKinds)[number];

export const projectStages = [
  "idea",
  "prototype",
  "early-revenue",
  "growing",
  "established",
  "any",
] as const;

export type ProjectStage = (typeof projectStages)[number];

/**
 * open: a window is open now. closed: not accepting. rolling: accepted at
 * any time. unknown: the catalog makes no claim; the official page decides.
 */
export const availabilityStatuses = ["open", "closed", "rolling", "unknown"] as const;

export type AvailabilityStatus = (typeof availabilityStatuses)[number];

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Use YYYY-MM-DD");
const httpsUrlSchema = z.url({ protocol: /^https$/u });

export const opportunitySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/u),
    name: z.string().min(1),
    provider: z.string().min(1),
    geography: z.string().min(1),
    summary: z.string().min(1),
    kinds: z.array(z.enum(opportunityKinds)).min(1),
    stages: z.array(z.enum(projectStages)).min(1),
    signals: z.array(z.string().min(1)).min(1),
    officialUrl: httpsUrlSchema,
    /** Date a person last reviewed this entry against the official source. */
    reviewedAt: isoDateSchema,
    availability: z.object({
      status: z.enum(availabilityStatuses),
      /** Application deadline stated by the official source, if any. */
      deadline: isoDateSchema.nullable(),
      note: z.string().min(1),
    }),
    registration: z.object({
      mode: z.enum(["browser-form", "official-starting-point"]),
      startUrl: httpsUrlSchema,
      allowedOrigins: z.array(httpsUrlSchema).min(1),
      note: z.string().min(1),
    }),
    caution: z.string().min(1),
  })
  .refine(
    (entry) =>
      entry.registration.allowedOrigins.includes(new URL(entry.registration.startUrl).origin),
    { message: "registration.startUrl must be on an allowed origin" },
  );

export type Opportunity = z.infer<typeof opportunitySchema>;
export type RegistrationMode = Opportunity["registration"]["mode"];

const sharedCaution =
  "This is a reviewed starting point, not an eligibility determination. Confirm current requirements, availability, and deadlines on the official site before acting.";

export const opportunities: Opportunity[] = z.array(opportunitySchema).parse([
  {
    id: "launch-ny",
    name: "Launch NY assistance application",
    provider: "Launch NY",
    geography: "Upstate New York, including Buffalo and Western New York",
    summary:
      "Official starting point for entrepreneurs seeking Launch NY mentoring and venture-development assistance.",
    kinds: ["accelerator", "capital", "technical-assistance"],
    stages: ["idea", "prototype", "early-revenue", "growing"],
    signals: [
      "startup",
      "founder",
      "scalable",
      "venture",
      "technology",
      "product",
      "mentoring",
      "investment",
      "capital",
      "software",
      "hardware",
    ],
    officialUrl: "https://launchny.org/entrepreneurs/apply-now/",
    reviewedAt: "2026-08-12",
    availability: {
      status: "unknown",
      deadline: null,
      note: "The official Apply Now page currently presents an application for assistance.",
    },
    registration: {
      mode: "browser-form",
      startUrl: "https://launchny.org/entrepreneurs/apply-now/",
      allowedOrigins: ["https://launchny.org", "https://forms.office.com"],
      note: "The official page embeds a Microsoft form. Read the live form before mapping answers because its fields can change.",
    },
    caution: sharedCaution,
  },
  {
    id: "ub-cultivator",
    name: "UB Cultivator",
    provider: "University at Buffalo Business and Entrepreneur Partnerships",
    geography: "Western New York",
    summary:
      "A cohort-based startup program with mentorship, workshops, and milestone-based support for founders building scalable companies.",
    kinds: ["accelerator", "capital", "technical-assistance"],
    stages: ["idea", "prototype", "early-revenue"],
    signals: [
      "startup",
      "founder",
      "scalable",
      "cohort",
      "mentor",
      "venture",
      "technology",
      "research",
      "commercialization",
      "prototype",
      "customer discovery",
    ],
    officialUrl:
      "https://www.buffalo.edu/partnerships/about/programs/ub-cultivator.html",
    reviewedAt: "2026-08-12",
    availability: {
      status: "rolling",
      deadline: null,
      note: "The official program page says applications are accepted on a rolling basis and cohort deadlines are announced separately.",
    },
    registration: {
      mode: "browser-form",
      startUrl: "https://bep.formstack.com/forms/cultivator_apply",
      allowedOrigins: [
        "https://www.buffalo.edu",
        "https://bep.formstack.com",
      ],
      note: "Use the live Formstack application as the source of truth for questions and required fields.",
    },
    caution: sharedCaution,
  },
  {
    id: "buffalo-business-assistance-grant",
    name: "City of Buffalo Business Assistance Grant",
    provider: "City of Buffalo / Erie County Business Hub",
    geography: "City of Buffalo",
    summary:
      "Official information page for a City of Buffalo small-business assistance grant program.",
    kinds: ["grant"],
    stages: ["early-revenue", "growing", "established"],
    signals: [
      "small business",
      "grant",
      "buffalo business",
      "storefront",
      "commercial",
      "expenses",
    ],
    officialUrl:
      "https://www3.erie.gov/businesshub/press/city-buffalo-business-assistance-grant",
    reviewedAt: "2026-08-03",
    availability: {
      status: "unknown",
      deadline: null,
      note: "Grant windows change. Check the official page for current availability before preparing an application.",
    },
    registration: {
      mode: "official-starting-point",
      startUrl:
        "https://www3.erie.gov/businesshub/press/city-buffalo-business-assistance-grant",
      allowedOrigins: ["https://www3.erie.gov"],
      note: "Follow only the current application route named on the official page.",
    },
    caution: sharedCaution,
  },
  {
    id: "buffalo-permits",
    name: "City of Buffalo permits and licenses",
    provider: "City of Buffalo",
    geography: "City of Buffalo",
    summary:
      "Official city portal for starting permit and license records when opening or changing a physical business location.",
    kinds: ["permit"],
    stages: ["idea", "prototype", "early-revenue", "growing", "established"],
    signals: [
      "permit",
      "license",
      "construction",
      "renovation",
      "sign",
      "restaurant",
      "retail",
      "physical location",
      "zoning",
      "occupancy",
    ],
    officialUrl: "https://epermits.buffalony.gov/submit-record",
    reviewedAt: "2026-08-03",
    availability: {
      status: "unknown",
      deadline: null,
      note: "The portal is a starting point; the correct record type depends on the project and location.",
    },
    registration: {
      mode: "official-starting-point",
      startUrl: "https://epermits.buffalony.gov/submit-record",
      allowedOrigins: ["https://epermits.buffalony.gov"],
      note: "Do not choose a permit type or make a compliance claim without user confirmation or official guidance.",
    },
    caution: sharedCaution,
  },
  {
    id: "erie-funding-directory",
    name: "Erie County funding opportunities directory",
    provider: "Erie County Business Hub",
    geography: "Erie County",
    summary:
      "Official county directory of funding starting points for businesses seeking capital or assistance.",
    kinds: ["resource-directory", "capital", "grant"],
    stages: ["idea", "prototype", "early-revenue", "growing", "established"],
    signals: ["funding", "grant", "loan", "capital", "small business"],
    officialUrl: "https://www3.erie.gov/businesshub/funding-opportunities",
    reviewedAt: "2026-08-03",
    availability: {
      status: "unknown",
      deadline: null,
      note: "Individual programs have their own windows and requirements.",
    },
    registration: {
      mode: "official-starting-point",
      startUrl: "https://www3.erie.gov/businesshub/funding-opportunities",
      allowedOrigins: ["https://www3.erie.gov"],
      note: "Use the directory to locate a current official program before preparing any form.",
    },
    caution: sharedCaution,
  },
  {
    id: "erie-microenterprise",
    name: "Erie County microenterprise loan and grant program",
    provider: "Erie County",
    geography: "Eligible Erie County communities described by the official program",
    summary:
      "County loan and grant starting point for qualifying microenterprises, with details provided in the official program material.",
    kinds: ["capital", "grant", "technical-assistance"],
    stages: ["idea", "early-revenue", "growing", "established"],
    signals: [
      "microenterprise",
      "small business",
      "loan",
      "grant",
      "equipment",
      "working capital",
    ],
    officialUrl:
      "https://www3.erie.gov/economicdevelopment/businesshub/sites/www3.erie.gov.economicdevelopment/files/2025-07/microenterprise-loan-grant-flyer-rev-may-2025.pdf",
    reviewedAt: "2026-08-03",
    availability: {
      status: "unknown",
      deadline: null,
      note: "Confirm that the program and intake path remain current with the county contact listed in the official material.",
    },
    registration: {
      mode: "official-starting-point",
      startUrl:
        "https://www3.erie.gov/economicdevelopment/businesshub/sites/www3.erie.gov.economicdevelopment/files/2025-07/microenterprise-loan-grant-flyer-rev-may-2025.pdf",
      allowedOrigins: ["https://www3.erie.gov"],
      note: "Review the official material and contact route before gathering an application packet.",
    },
    caution: sharedCaution,
  },
  {
    id: "erie-procurement",
    name: "Sell to Erie County",
    provider: "Erie County",
    geography: "Erie County",
    summary:
      "Official starting point for vendors that want to understand or pursue Erie County purchasing opportunities.",
    kinds: ["procurement"],
    stages: ["early-revenue", "growing", "established"],
    signals: [
      "sell to government",
      "vendor",
      "procurement",
      "contract",
      "county",
      "bid",
      "rfp",
    ],
    officialUrl: "https://www4.erie.gov/doing-business",
    reviewedAt: "2026-08-03",
    availability: {
      status: "unknown",
      deadline: null,
      note: "Current solicitations and vendor steps are controlled by the official county pages linked here.",
    },
    registration: {
      mode: "official-starting-point",
      startUrl: "https://www4.erie.gov/doing-business",
      allowedOrigins: ["https://www4.erie.gov"],
      note: "Confirm the specific vendor or solicitation route before entering business information.",
    },
    caution: sharedCaution,
  },
  {
    id: "nys-contract-reporter",
    name: "New York State Contract Reporter",
    provider: "New York State",
    geography: "New York State",
    summary:
      "Official state system for finding procurement opportunities and starting vendor registration.",
    kinds: ["procurement"],
    stages: ["early-revenue", "growing", "established"],
    signals: [
      "state contract",
      "vendor",
      "procurement",
      "bid",
      "rfp",
      "government customer",
    ],
    officialUrl: "https://www.nyscr.ny.gov/home/contracts",
    reviewedAt: "2026-08-03",
    availability: {
      status: "unknown",
      deadline: null,
      note: "Listings and registration requirements change in the official system.",
    },
    registration: {
      mode: "official-starting-point",
      startUrl: "https://www.nyscr.ny.gov/home/contracts",
      allowedOrigins: ["https://www.nyscr.ny.gov"],
      note: "Account creation and submission may create legal representations; stop for user approval at each commitment boundary.",
    },
    caution: sharedCaution,
  },
  {
    id: "nys-small-business-hub",
    name: "New York State Small Business Hub",
    provider: "Empire State Development",
    geography: "New York State",
    summary:
      "Official state program finder and starting point for small-business assistance.",
    kinds: ["resource-directory", "capital", "grant", "technical-assistance"],
    stages: ["idea", "prototype", "early-revenue", "growing", "established"],
    signals: [
      "small business",
      "state program",
      "funding",
      "assistance",
      "business help",
    ],
    officialUrl: "https://esd.ny.gov/doing-business-ny/small-business-hub",
    reviewedAt: "2026-08-03",
    availability: {
      status: "unknown",
      deadline: null,
      note: "Use the hub to identify a current official program; each program controls its own requirements.",
    },
    registration: {
      mode: "official-starting-point",
      startUrl: "https://esd.ny.gov/doing-business-ny/small-business-hub",
      allowedOrigins: ["https://esd.ny.gov"],
      note: "Treat finder results as leads to verify, not eligibility decisions.",
    },
    caution: sharedCaution,
  },
  {
    id: "nys-ssbci-technical-assistance",
    name: "NYS SSBCI Technical Assistance Program",
    provider: "Empire State Development",
    geography: "New York State",
    summary:
      "Official starting point for business legal, accounting, and financial technical assistance connected to capital readiness.",
    kinds: ["technical-assistance", "capital"],
    stages: ["idea", "prototype", "early-revenue", "growing", "established"],
    signals: [
      "legal help",
      "accounting",
      "financial assistance",
      "capital readiness",
      "technical assistance",
    ],
    officialUrl: "https://www.esd.ny.gov/ssbci-technical-assistance-program",
    reviewedAt: "2026-08-03",
    availability: {
      status: "unknown",
      deadline: null,
      note: "Confirm the current intake route and service fit on the official page.",
    },
    registration: {
      mode: "official-starting-point",
      startUrl: "https://www.esd.ny.gov/ssbci-technical-assistance-program",
      allowedOrigins: ["https://www.esd.ny.gov"],
      note: "Do not characterize this resource as legal, accounting, or financial advice from this tool.",
    },
    caution: sharedCaution,
  },
  {
    id: "nys-pre-seed-seed-fund",
    name: "NYS Pre-Seed and Seed Matching Fund Program",
    provider: "Empire State Development / NY Ventures",
    geography: "New York State",
    summary:
      "Official program page for a state early-stage equity investment program.",
    kinds: ["capital"],
    stages: ["prototype", "early-revenue"],
    signals: [
      "pre-seed",
      "seed",
      "venture",
      "equity",
      "startup",
      "scalable",
      "investment",
      "matching fund",
    ],
    officialUrl:
      "https://esd.ny.gov/pre-seed-and-seed-matching-fund-program",
    reviewedAt: "2026-08-03",
    availability: {
      status: "unknown",
      deadline: null,
      note: "Confirm current intake status, requirements, and investment terms on the official page.",
    },
    registration: {
      mode: "official-starting-point",
      startUrl:
        "https://esd.ny.gov/pre-seed-and-seed-matching-fund-program",
      allowedOrigins: ["https://esd.ny.gov"],
      note: "Investment applications can involve material financial and legal commitments; prepare only and require user control over submission.",
    },
    caution: sharedCaution,
  },
] satisfies z.input<typeof opportunitySchema>[]);

export function getOpportunity(id: string): Opportunity | undefined {
  return opportunities.find((opportunity) => opportunity.id === id);
}
