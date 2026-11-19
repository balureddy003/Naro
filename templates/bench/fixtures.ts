/**
 * Labeled fixture set for the transaction-categorizer benchmark —
 * PRD-002 milestone 2.
 *
 * Synthetic but realistic SMB card/bank transactions. Deliberately mixes
 * obvious vendors, ambiguous ones (AMAZON, APPLE), and descriptions a
 * history lookup should disambiguate. Labels are the ground truth a
 * reasonable bookkeeper would assign given the same history.
 */

export interface LabeledTransaction {
  readonly id: string;
  readonly description: string;
  readonly amount: number;
  readonly expected: string;
}

export const BENCH_CATEGORIES = [
  'Meals & Entertainment',
  'Travel',
  'Office Supplies',
  'Software & Subscriptions',
  'Utilities',
  'Marketing & Advertising',
  'Professional Services',
  'Equipment',
] as const;

/** Shared history the template consults — how this business filed
 *  similar vendors before. */
export const BENCH_HISTORY = [
  { description: 'UBER *TRIP', category: 'Travel' },
  { description: 'DELTA AIR', category: 'Travel' },
  { description: 'STAPLES #441', category: 'Office Supplies' },
  { description: 'GITHUB INC', category: 'Software & Subscriptions' },
  { description: 'COMCAST CABLE', category: 'Utilities' },
  { description: 'GOOGLE ADS', category: 'Marketing & Advertising' },
  { description: 'SMITH & ASSOC CPA', category: 'Professional Services' },
  { description: 'DELL TECHNOLOGIES', category: 'Equipment' },
];

export const TRANSACTIONS: readonly LabeledTransaction[] = [
  // Travel
  { id: 't01', description: 'UBER *TRIP 8832', amount: 24.50, expected: 'Travel' },
  { id: 't02', description: 'DELTA AIR 0067455', amount: 412.00, expected: 'Travel' },
  { id: 't03', description: 'MARRIOTT HOTELS 8821', amount: 289.00, expected: 'Travel' },
  { id: 't04', description: 'LYFT *RIDE WED', amount: 18.75, expected: 'Travel' },
  { id: 't05', description: 'SOUTHWEST AIRLINES', amount: 198.00, expected: 'Travel' },
  { id: 't06', description: 'HERTZ RENT-A-CAR', amount: 156.40, expected: 'Travel' },
  // Meals & Entertainment
  { id: 't07', description: 'CHIPOTLE 0934', amount: 42.30, expected: 'Meals & Entertainment' },
  { id: 't08', description: 'STARBUCKS STORE 11221', amount: 8.95, expected: 'Meals & Entertainment' },
  { id: 't09', description: 'BLUE RIBBON SUSHI', amount: 187.00, expected: 'Meals & Entertainment' },
  { id: 't10', description: 'PANERA BREAD #3344', amount: 61.20, expected: 'Meals & Entertainment' },
  { id: 't11', description: 'DOORDASH*OLIVE GARDEN', amount: 78.45, expected: 'Meals & Entertainment' },
  { id: 't12', description: 'THE CAPITAL GRILLE', amount: 312.00, expected: 'Meals & Entertainment' },
  // Office Supplies
  { id: 't13', description: 'STAPLES #441', amount: 89.99, expected: 'Office Supplies' },
  { id: 't14', description: 'OFFICE DEPOT #1187', amount: 45.30, expected: 'Office Supplies' },
  { id: 't15', description: 'ULINE SHIPPING SUPPLY', amount: 134.00, expected: 'Office Supplies' },
  { id: 't16', description: 'WB MASON CO', amount: 67.50, expected: 'Office Supplies' },
  { id: 't17', description: 'AMZN MKTP US*RT4H2', amount: 38.99, expected: 'Office Supplies' },
  { id: 't18', description: 'FEDEX OFFICE 5521', amount: 22.10, expected: 'Office Supplies' },
  // Software & Subscriptions
  { id: 't19', description: 'GITHUB INC', amount: 44.00, expected: 'Software & Subscriptions' },
  { id: 't20', description: 'ADOBE *CREATIVE CLD', amount: 59.99, expected: 'Software & Subscriptions' },
  { id: 't21', description: 'NOTION LABS INC', amount: 96.00, expected: 'Software & Subscriptions' },
  { id: 't22', description: 'SLACK TECHNOLOGIES', amount: 135.00, expected: 'Software & Subscriptions' },
  { id: 't23', description: 'AWS*SERVICES', amount: 287.33, expected: 'Software & Subscriptions' },
  { id: 't24', description: 'ZOOM.US 888-799-9666', amount: 15.99, expected: 'Software & Subscriptions' },
  // Utilities
  { id: 't25', description: 'COMCAST CABLE', amount: 119.85, expected: 'Utilities' },
  { id: 't26', description: 'PG&E ELECTRIC', amount: 243.10, expected: 'Utilities' },
  { id: 't27', description: 'CITY WATER DEPT', amount: 87.40, expected: 'Utilities' },
  { id: 't28', description: 'VERIZON WIRELESS', amount: 178.22, expected: 'Utilities' },
  { id: 't29', description: 'WASTE MANAGEMENT WM', amount: 95.00, expected: 'Utilities' },
  { id: 't30', description: 'AT&T*BUSINESS FIBER', amount: 145.00, expected: 'Utilities' },
  // Marketing & Advertising
  { id: 't31', description: 'GOOGLE ADS 321-555', amount: 500.00, expected: 'Marketing & Advertising' },
  { id: 't32', description: 'FACEBK*ADS MANAGER', amount: 250.00, expected: 'Marketing & Advertising' },
  { id: 't33', description: 'LINKEDIN ADS', amount: 175.00, expected: 'Marketing & Advertising' },
  { id: 't34', description: 'VISTAPRINT', amount: 89.99, expected: 'Marketing & Advertising' },
  { id: 't35', description: 'CANVA PRO', amount: 12.99, expected: 'Marketing & Advertising' },
  { id: 't36', description: 'MAILCHIMP *MONTHLY', amount: 45.00, expected: 'Marketing & Advertising' },
  // Professional Services
  { id: 't37', description: 'SMITH & ASSOC CPA', amount: 1200.00, expected: 'Professional Services' },
  { id: 't38', description: 'JONES LAW FIRM LLC', amount: 850.00, expected: 'Professional Services' },
  { id: 't39', description: 'QUICKBOOKS PAYROLL FEE', amount: 75.00, expected: 'Professional Services' },
  { id: 't40', description: 'UPWORK FREELANCERS', amount: 320.00, expected: 'Professional Services' },
  { id: 't41', description: 'NOTARY PUBLIC SERVICE', amount: 45.00, expected: 'Professional Services' },
  { id: 't42', description: 'BENCH ACCOUNTING', amount: 299.00, expected: 'Professional Services' },
  // Equipment
  { id: 't43', description: 'DELL TECHNOLOGIES', amount: 1299.00, expected: 'Equipment' },
  { id: 't44', description: 'APPLE STORE #R234', amount: 1999.00, expected: 'Equipment' },
  { id: 't45', description: 'BEST BUY #582', amount: 449.99, expected: 'Equipment' },
  { id: 't46', description: 'GRAINGER INDUSTRIAL', amount: 267.50, expected: 'Equipment' },
  { id: 't47', description: 'IKEA BUSINESS', amount: 823.00, expected: 'Equipment' },
  { id: 't48', description: 'LOGITECH DIRECT', amount: 129.99, expected: 'Equipment' },
];
