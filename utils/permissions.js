// Role-based access control: the single list of what can be protected.
//
// A MODULE is one area of the app (usually one menu page). Each has the actions `view` and `edit`, plus any
// extra actions listed. A permission is "<module>.<action>", e.g. "inventory.edit", "transfers.approve".
//
// api: path prefixes (under /api) the module protects. GET/HEAD need `view`, anything else needs `edit`.
//      When several modules list the same prefix, `view` on ANY of them allows reading it (a report that
//      reads budgets) while writing needs `edit` on the FIRST module that lists it (its owner).
// pages: frontend path prefixes, so the menu and route guard can follow the same rules.
//
// Paths not covered here are refused for everyone except Super Admin — new routes must be added below.

const MODULES = [
  // Executive & core
  { key: 'dashboard', group: 'core', en: 'Executive dashboard', bn: 'নির্বাহী ড্যাশবোর্ড', pages: ['/apartment/dashboard'],
    api: ['/apartment/dashboard', '/apartment/export-project-backup'] },
  { key: 'units', group: 'core', en: 'Flats / units', bn: 'ফ্ল্যাট / ইউনিট', pages: ['/apartment/units'], api: ['/apartment/units', '/apartment/payment-schedules', '/apartment/preview-allocation'] },
  { key: 'owners', group: 'core', en: 'Owners & ledgers', bn: 'মালিক ও লেজার', pages: ['/apartment/owners'], api: ['/apartment/owners', '/apartment/owner-portal'] },
  { key: 'masters', group: 'core', en: 'Masters & settings data', bn: 'মাস্টার ডেটা', pages: ['/apartment/masters'], api: ['/apartment/masters', '/apartment/universal-masters'] },
  { key: 'shopno_bilash', group: 'core', en: 'Shopno Bilash hub', bn: 'স্বপ্ন বিলাস হাব', pages: ['/apartment/shopno-bilash'], api: ['/apartment/shopno-bilash'] },
  { key: 'compliance', group: 'core', en: 'Bangladesh compliance hub', bn: 'বাংলাদেশ কমপ্লায়েন্স হাব', pages: ['/apartment/compliance'], api: ['/apartment/compliance'] },
  { key: 'bd_toolkit', group: 'core', en: 'BD toolkit (deed, bKash, VAT, holding)', bn: 'বিডি টুলকিট', pages: ['/apartment/bd-toolkit'], api: ['/bd-local'] },
  { key: 'collections', group: 'core', en: 'Receipts, SMS & online pay', bn: 'রসিদ, এসএমএস ও অনলাইন পেমেন্ট', pages: ['/apartment/collections'], api: ['/collections'],
    extra: [{ action: 'settings', en: 'Change organisation settings', bn: 'প্রতিষ্ঠানের সেটিংস পরিবর্তন' }] },
  { key: 'buildings', group: 'core', en: 'Buildings (classic module)', bn: 'ভবন (পুরোনো মডিউল)', pages: ['/buildings'], api: ['/buildings', '/units', '/costing', '/shareholders', '/payments'] },

  // Building operations
  { key: 'tenants', group: 'operations', en: 'Tenants & rent', bn: 'ভাড়াটিয়া ও ভাড়া', pages: ['/operations/tenants', '/print/tenant-form'], api: ['/ops/tenants'] },
  { key: 'billing', group: 'operations', en: 'Service charge billing', bn: 'সার্ভিস চার্জ বিল', pages: ['/operations/billing'], api: ['/ops/billing'] },
  { key: 'staff_payroll', group: 'operations', en: 'Building staff & payroll', bn: 'কর্মচারী ও বেতন', pages: ['/operations/staff'], api: ['/ops/staff'] },
  { key: 'gate', group: 'operations', en: 'Gate, parking & notices', bn: 'গেট, পার্কিং ও নোটিশ', pages: ['/operations/gate'], api: ['/ops/gate'] },
  { key: 'helpdesk', group: 'operations', en: 'Resident helpdesk', bn: 'বাসিন্দা হেল্পডেস্ক', pages: ['/operations/helpdesk'], api: ['/ops/helpdesk'] },
  { key: 'renewals', group: 'operations', en: 'Renewals & upkeep', bn: 'নবায়ন ও রক্ষণাবেক্ষণ', pages: ['/operations/renewals'], api: ['/ops/compliance', '/ops/upkeep'] },
  { key: 'association', group: 'operations', en: "Owners' association & elections", bn: 'মালিক সমিতি ও নির্বাচন', pages: ['/operations/association'], api: ['/ops/association', '/ops/elections'] },
  { key: 'transfers', group: 'operations', en: 'Flat & share transfer', bn: 'ফ্ল্যাট ও শেয়ার হস্তান্তর', pages: ['/operations/transfers', '/print/transfer'], api: ['/ops/transfers'],
    extra: [{ action: 'approve', en: 'Approve, complete or cancel transfers', bn: 'হস্তান্তর অনুমোদন, সম্পন্ন বা বাতিল' }] },
  { key: 'automation', group: 'operations', en: 'Automation (scheduled jobs)', bn: 'স্বয়ংক্রিয় কাজ', pages: ['/operations/automation'], api: ['/ops/automation'] },

  // Engineering
  { key: 'works', group: 'engineering', en: 'Works & allocations', bn: 'কাজ ও বরাদ্দ', pages: ['/apartment/works'], api: ['/apartment/works'] },
  { key: 'drawings', group: 'engineering', en: 'Blueprints & revisions', bn: 'নকশা ও সংশোধন', pages: ['/apartment/drawings'], api: ['/apartment/drawings'] },
  { key: 'boq', group: 'engineering', en: 'BOQ & materials', bn: 'বিওকিউ ও মালামাল', pages: ['/apartment/boq'], api: ['/apartment/boq', '/apartment/materials'] },
  { key: 'inventory', group: 'engineering', en: 'Inventory & material plan', bn: 'মজুদ ও মালামাল পরিকল্পনা', pages: ['/apartment/inventory'], api: ['/inventory'] },

  // Contractors & site
  { key: 'contractors', group: 'site', en: 'Contractors & progress bills', bn: 'ঠিকাদার ও প্রগতি বিল', pages: ['/apartment/contractors'], api: ['/apartment/contractors'] },
  { key: 'site', group: 'site', en: 'Site manager (labour, expenses, photos)', bn: 'সাইট ম্যানেজার', pages: ['/apartment/site-manager'], api: ['/apartment/labour', '/apartment/site-expenses', '/apartment/site-photos', '/apartment/inventory'] },
  { key: 'procurement', group: 'site', en: 'Procurement & vendors', bn: 'ক্রয় ও সরবরাহকারী', pages: ['/apartment/procurement'], api: ['/apartment/vendors', '/apartment/vendor-invoices', '/apartment/vendor-payments'] },

  // Finance
  { key: 'finance', group: 'finance', en: 'Finance (budgets, bank, contributions, loans)', bn: 'অর্থ ব্যবস্থাপনা', pages: ['/apartment/finances'], api: ['/apartment/budgets', '/apartment/cash-bank', '/apartment/contributions', '/apartment/loans'] },
  { key: 'cashflow', group: 'finance', en: 'Cash-flow forecast', bn: 'নগদ প্রবাহ পূর্বাভাস', pages: ['/apartment/cashflow'], api: ['/apartment/cash-flow-forecast'] },
  { key: 'cost_sft', group: 'finance', en: 'Cost per sft analytics', bn: 'প্রতি বর্গফুট খরচ', pages: ['/apartment/cost-sft'], api: ['/apartment/cost-per-sft'] },
  { key: 'room_costing', group: 'finance', en: 'Room-level costing', bn: 'কক্ষভিত্তিক খরচ', pages: ['/apartment/room-costing'], api: ['/apartment/room-level-costing'] },
  { key: 'facilities', group: 'finance', en: 'Facilities & lifts', bn: 'সুবিধা ও লিফট', pages: ['/apartment/facilities'], api: ['/apartment/facilities'] },
  { key: 'reports', group: 'finance', en: 'Financial reports', bn: 'আর্থিক প্রতিবেদন', pages: ['/apartment/reports'],
    api: ['/apartment/dashboard', '/apartment/budgets', '/apartment/loans', '/apartment/owners', '/apartment/units', '/apartment/vendors'] },

  // Governance
  { key: 'voting', group: 'governance', en: 'Committee proposals & voting', bn: 'কমিটি প্রস্তাব ও ভোট', pages: ['/apartment/voting'], api: ['/apartment/proposals'] },
  { key: 'maintenance', group: 'governance', en: 'Post-handover maintenance', bn: 'হস্তান্তর-পরবর্তী রক্ষণাবেক্ষণ', pages: ['/apartment/maintenance'], api: ['/apartment/post-handover'] },
  { key: 'audit', group: 'governance', en: 'Approvals & audit log', bn: 'অনুমোদন ও অডিট লগ', pages: ['/apartment/audit'], api: ['/apartment/approvals', '/apartment/audit-logs'] },

  // System
  { key: 'users', group: 'system', en: 'Users, roles & permissions', bn: 'ব্যবহারকারী, রোল ও অনুমতি', pages: ['/admin/access'], api: ['/rbac'] },
];

// Readable by every staff role (dropdown lists used across many pages). Writes still follow the owning module.
const STAFF_LOOKUPS = ['/apartment/projects', '/apartment/notifications', '/apartment/units', '/apartment/owners', '/apartment/vendors',
  '/apartment/works', '/apartment/materials', '/ops/units', '/ops/transfers/lookup'];

// Writes that need a special action instead of plain `edit`.
const SPECIAL = [
  { method: /^(POST)$/, path: /^\/ops\/transfers\/\d+\/(approve|complete|cancel)$/, perm: 'transfers.approve' },
  { method: /^(PUT|POST)$/, path: /^\/collections\/settings$/, perm: 'collections.settings' },
];

// Flat-owner logins reach only their own portal.
const OWNER_PORTAL_PATHS = ['/apartment/owner-portal', '/ops/gate/portal', '/ops/helpdesk/portal', '/ops/association/zakat/portal', '/ops/elections/portal'];

const GROUPS = {
  core: ['Executive & core', 'প্রধান'], operations: ['Building operations', 'ভবন পরিচালনা'], engineering: ['Engineering & drawings', 'প্রকৌশল ও নকশা'],
  site: ['Contractors & site', 'ঠিকাদার ও সাইট'], finance: ['Finance', 'অর্থ'], governance: ['Governance & handover', 'পরিচালনা ও হস্তান্তর'], system: ['System', 'সিস্টেম'],
};

const actionsOf = m => ['view', 'edit', ...(m.extra || []).map(e => e.action)];
const ALL_PERMISSIONS = MODULES.flatMap(m => actionsOf(m).map(a => `${m.key}.${a}`));

// Default roles. SUPER_ADMIN bypasses every check; OWNER is the flat-owner portal login.
const view = keys => keys.map(k => `${k}.view`);
const full = keys => keys.flatMap(k => [`${k}.view`, `${k}.edit`]);
const ALL_KEYS = MODULES.map(m => m.key);
const DEFAULT_ROLES = [
  { role_key: 'SUPER_ADMIN', name_en: 'Super admin', name_bn: 'সুপার অ্যাডমিন', is_system: true, legacy: 'admin',
    description: 'Everything, including users and roles. Cannot be edited or deleted.', perms: [] },
  { role_key: 'MANAGER', name_en: 'Project manager', name_bn: 'প্রকল্প ব্যবস্থাপক', legacy: 'manager',
    description: 'Runs the whole project day to day. Everything except users, roles and organisation settings.',
    perms: [...full(ALL_KEYS.filter(k => k !== 'users')), 'transfers.approve'] },
  { role_key: 'ACCOUNTANT', name_en: 'Accountant', name_bn: 'হিসাবরক্ষক', legacy: 'manager',
    description: 'Collections, billing, payroll, vendor payments and finance. Reads the rest.',
    perms: [...full(['collections', 'billing', 'staff_payroll', 'finance', 'cashflow', 'procurement', 'bd_toolkit', 'tenants', 'reports']),
      ...view(['dashboard', 'units', 'owners', 'masters', 'cost_sft', 'room_costing', 'transfers', 'association', 'audit', 'inventory', 'contractors', 'compliance', 'facilities'])] },
  { role_key: 'SITE_ENGINEER', name_en: 'Site engineer', name_bn: 'সাইট ইঞ্জিনিয়ার', legacy: 'manager',
    description: 'Works, drawings, BOQ, inventory, contractors and the site diary.',
    perms: [...full(['works', 'drawings', 'boq', 'inventory', 'contractors', 'site']), ...view(['dashboard', 'units', 'procurement', 'masters', 'cost_sft', 'room_costing'])] },
  { role_key: 'STORE_KEEPER', name_en: 'Store keeper', name_bn: 'স্টোর কিপার', legacy: 'manager',
    description: 'Receives and issues materials in the site store.',
    perms: [...full(['inventory']), ...view(['works', 'boq', 'site', 'procurement'])] },
  { role_key: 'FRONT_DESK', name_en: 'Front desk / caretaker', name_bn: 'ফ্রন্ট ডেস্ক / কেয়ারটেকার', legacy: 'manager',
    description: 'Gate log, parking, notices, complaints, tenants and upkeep.',
    perms: [...full(['gate', 'helpdesk', 'tenants', 'renewals']), ...view(['units', 'owners', 'staff_payroll'])] },
  { role_key: 'COMMITTEE', name_en: 'Committee member', name_bn: 'কমিটি সদস্য', legacy: 'manager',
    description: "Association meetings and elections, proposals, transfer approval; reads the accounts.",
    perms: [...full(['association', 'voting']), 'transfers.view', 'transfers.approve',
      ...view(['dashboard', 'reports', 'finance', 'cashflow', 'billing', 'audit', 'units', 'owners', 'renewals', 'maintenance'])] },
  { role_key: 'AUDITOR', name_en: 'Auditor (read-only)', name_bn: 'নিরীক্ষক (শুধু দেখা)', legacy: 'manager',
    description: 'Can see everything except users and roles; cannot change anything.', perms: view(ALL_KEYS.filter(k => k !== 'users')) },
  { role_key: 'OWNER', name_en: 'Flat owner (portal)', name_bn: 'ফ্ল্যাট মালিক (পোর্টাল)', is_system: true, is_owner_portal: true, legacy: 'viewer',
    description: 'Own flat, payments, complaints, notices, elections and zakat statement only.', perms: [] },
];

// "/api/apartment/works/5" → "/apartment/works/5"
const apiPath = fullPath => fullPath.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
const under = (path, prefix) => path === prefix || path.startsWith(prefix + '/');

// What a request needs: { anyOf: [...] } (any one permission is enough), { superOnly: true } for unmapped paths.
function requiredFor(method, fullPath) {
  const path = apiPath(fullPath);
  const read = method === 'GET' || method === 'HEAD';
  for (const s of SPECIAL) if (s.method.test(method) && s.path.test(path)) return { anyOf: [s.perm] };
  // Longest matching prefix decides which modules apply.
  let best = 0; let mods = [];
  for (const m of MODULES) for (const p of m.api) {
    if (!under(path, p)) continue;
    if (p.length > best) { best = p.length; mods = [m.key]; }
    else if (p.length === best && !mods.includes(m.key)) mods.push(m.key);
  }
  if (read && STAFF_LOOKUPS.some(p => under(path, p))) return { anyStaff: true };
  if (!mods.length) return { superOnly: true };
  return read ? { anyOf: mods.map(k => `${k}.view`) } : { anyOf: [`${mods[0]}.edit`] };
}

module.exports = { MODULES, GROUPS, ALL_PERMISSIONS, DEFAULT_ROLES, OWNER_PORTAL_PATHS, STAFF_LOOKUPS, actionsOf, requiredFor, apiPath, under };
