/**
 * Service categories — the single place that defines what's required to
 * provide each kind of service on GoFair, and how money moves for it.
 *
 * This exists because GoFair started as a single-category app (rides),
 * with a fixed two-option vehicleType baked fairly specifically into
 * matching and registration. Every category below shares the same core
 * engine (negotiate a price, verify identity, dispatch, pay, rate) —
 * this file is what lets that one engine serve five different kinds of
 * work without the code itself needing to know about each one by name.
 *
 * Adding a sixth category later means adding an entry here and to the
 * sub-type list — not touching matching, payments, or registration.
 */

const CATEGORIES = {
  ride: {
    label: 'Ride',
    negotiationLabel: 'fare',              // what the app calls the negotiated price to this category's users
    pricingModel: 'negotiate',             // rider proposes, driver counters — GoFair's real point of difference from Uber/Bolt
    commissionRate: null,                  // null = use the global COMMISSION_RATE env var, unchanged from before categories existed
    requiresVehicle: true,
    requiresDeposit: true,
    requiresTrustReferee: false,
    moneyDirection: 'requester_pays_provider',
    subTypes: [
      { value: 'motorcycle', label: '🏍 Motorcycle' },
      { value: 'car', label: '🚗 Car' }
    ]
  },
  delivery: {
    label: 'Delivery',
    negotiationLabel: 'delivery fee',
    pricingModel: 'negotiate',             // same reasoning as rides — delivery fee genuinely varies with distance and demand
    commissionRate: null,                  // defers to the global COMMISSION_RATE env var — same as rides
    requiresVehicle: true,
    requiresDeposit: true,
    requiresTrustReferee: false,
    moneyDirection: 'requester_pays_provider',
    minDepositMultiplier: 0.4,             // fraction of the country's ride deposit — couriers carry lower per-trip risk than a ride driver
    subTypes: [
      { value: 'motorcycle', label: '🏍 Motorcycle' },
      { value: 'bicycle', label: '🚲 Bicycle' },
      { value: 'on_foot', label: '🚶 On foot' }
    ]
  },
  household: {
    label: 'Household service',
    negotiationLabel: 'service rate',
    // Fixed, provider-set pricing — NOT negotiated. Lynk (Kenya) started
    // with almost exactly GoFair's negotiate-a-quote model for household
    // services and deliberately abandoned it: negotiated quotes created
    // quality-control problems and didn't scale, so they moved to
    // standardized upfront pricing. Following that real, hard-won lesson
    // rather than repeating it. The provider sets their own rate (hourly
    // or flat callout) on their profile; a requester sees it upfront and
    // books at that price, or doesn't.
    pricingModel: 'fixed_by_provider',
    commissionRate: 0.07,
    requiresVehicle: false,
    requiresDeposit: false,                // no per-job deposit — the trust referee is the safeguard here instead, same reasoning TaskRabbit uses background checks rather than a cash bond
    requiresTrustReferee: true,            // enters someone's home — the highest-trust category on the platform, not the lowest
    moneyDirection: 'requester_pays_provider',
    subTypes: [
      { value: 'plumbing', label: '🔧 Plumbing' },
      { value: 'electrical', label: '💡 Electrical' },
      { value: 'cleaning', label: '🧹 Cleaning' },
      { value: 'other', label: '🛠 Other household work' }
    ]
  },
  waste: {
    label: 'Waste & recycling',
    negotiationLabel: 'collection fee',
    requiresVehicle: true,
    requiresDeposit: true,
    requiresTrustReferee: false,
    moneyDirection: 'varies_by_subtype',   // 'collection' = requester pays; 'recycling' = provider pays the requester — see subType-level moneyDirection below
    subTypes: [
      // Fixed platform-set pricing for both — TakaTaka Solutions (Kenya)
      // uses a fixed subscription/collection fee, and Wecyclers (Nigeria)
      // pays a fixed rate per kilogram for recyclables. Neither real
      // African success story in this category negotiates; following
      // that rather than inventing a different model for no reason.
      { value: 'collection', label: '🗑 Garbage collection', moneyDirection: 'requester_pays_provider', pricingModel: 'fixed_platform_rate', commissionRate: 0.07 },
      { value: 'recycling', label: '♻️ Recyclables (get paid)', moneyDirection: 'provider_pays_requester', pricingModel: 'fixed_per_kg', commissionRate: 0.01 }
    ]
  },
  gig: {
    label: 'Gig work',
    negotiationLabel: 'rate',
    pricingModel: 'negotiate',             // genuinely mixed globally (Upwork-style bidding vs. fixed gig menus) — kept as negotiate since it's closest in spirit to how a worker proposes a rate for a one-off task
    commissionRate: 0.05,
    requiresVehicle: false,
    requiresDeposit: false,
    requiresTrustReferee: false,           // optional, not required — lower-trust-bar tasks (errands, digital work) vs. entering someone's home
    moneyDirection: 'requester_pays_provider',
    subTypes: [
      { value: 'errands', label: '🏃 Errands' },
      { value: 'manual_labor', label: '💪 Manual labour' },
      { value: 'digital', label: '💻 Digital / remote task' }
    ]
  }
};

const ACTIVE_CATEGORIES = ['ride']; // same "configured but not switched on" pattern as countries — flip these on deliberately, one at a time

function isValidCategory(code) {
  return Object.prototype.hasOwnProperty.call(CATEGORIES, code);
}
function getCategory(code) {
  return CATEGORIES[code] || CATEGORIES.ride;
}
function isValidSubType(categoryCode, subTypeValue) {
  const cat = CATEGORIES[categoryCode];
  return !!cat && cat.subTypes.some(s => s.value === subTypeValue);
}
// Resolves which direction money flows for a given category+subType —
// most categories have one fixed direction; waste varies by subType.
function moneyDirectionFor(categoryCode, subTypeValue) {
  const cat = getCategory(categoryCode);
  const sub = cat.subTypes.find(s => s.value === subTypeValue);
  return (sub && sub.moneyDirection) || cat.moneyDirection;
}
// Resolves which pricing model applies for a given category+subType —
// most categories have one fixed model; waste varies by subType (a flat
// collection fee vs. a per-kilogram recycling rate).
// Resolves the real commission rate for a category+subType. Returns
// null when it should defer to the global COMMISSION_RATE env var
// (rides and deliveries, unchanged from before categories existed) —
// the caller is responsible for applying that fallback, since
// categories.js is pure config and shouldn't read environment variables
// itself.
function commissionRateFor(categoryCode, subTypeValue) {
  const cat = getCategory(categoryCode);
  const sub = cat.subTypes.find(s => s.value === subTypeValue);
  const rate = (sub && sub.commissionRate !== undefined) ? sub.commissionRate : cat.commissionRate;
  return rate === undefined ? null : rate;
}
function pricingModelFor(categoryCode, subTypeValue) {
  const cat = getCategory(categoryCode);
  const sub = cat.subTypes.find(s => s.value === subTypeValue);
  return (sub && sub.pricingModel) || cat.pricingModel;
}
function publicCategoryList() {
  return ACTIVE_CATEGORIES.map(code => ({
    code, label: CATEGORIES[code].label, negotiationLabel: CATEGORIES[code].negotiationLabel,
    requiresVehicle: CATEGORIES[code].requiresVehicle, requiresDeposit: CATEGORIES[code].requiresDeposit,
    requiresTrustReferee: CATEGORIES[code].requiresTrustReferee,
    subTypes: CATEGORIES[code].subTypes.map(s => ({ ...s, pricingModel: s.pricingModel || CATEGORIES[code].pricingModel }))
  }));
}

module.exports = {
  CATEGORIES, ACTIVE_CATEGORIES,
  isValidCategory, getCategory, isValidSubType, moneyDirectionFor, pricingModelFor, commissionRateFor, publicCategoryList
};
