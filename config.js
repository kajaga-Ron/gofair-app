/**
 * Country configuration — the single place currency, fare rates, and
 * minimum wallet balance are defined per country. Adding Zambia or
 * Malawi later means adding an entry here; nothing else in the codebase
 * should ever hardcode a currency symbol or a fare rate again.
 *
 * Only Uganda is "real" today — the others are placeholder rates so the
 * architecture is proven out before real numbers matter. Update the
 * rates with real local pricing before actually launching in a new
 * country.
 */

const COUNTRIES = {
  UG: {
    name: 'Uganda',
    currency: 'UGX',
    flag: '🇺🇬',
    dialPrefix: '256',
    minWalletBalance: 5000,
    mapCenter: [0.3476, 32.5825], // Kampala
    documentLabels: { national_id: 'National ID', driving_license: 'Driving Permit / Licence' },
    rates: {
      motorcycle: { base: 1000, perKm: 700 },
      car: { base: 2000, perKm: 1300 }
    },
    // Placeholder — not researched against real Uganda waste-management
    // pricing the way ride rates were. Confirm real numbers (e.g. against
    // KCCA-registered private collectors in Kampala) before this category
    // ever goes live for real money.
    wasteRates: { collectionFee: 5000, recyclingPerKg: 200 }
  },
  ZM: {
    // Calibrated against Yango's own published Lusaka pricing (~$2/km
    // for short trips, tapering for longer ones; typical short rides
    // $1.50-3 total) at roughly 25 ZMW/USD. GoFair's formula is linear
    // (no distance-based taper like Yango's), so long trips will price
    // somewhat higher here than Yango's own app — worth watching once
    // real rides start happening and adjusting if it feels off.
    name: 'Zambia',
    currency: 'ZMW',
    flag: '🇿🇲',
    dialPrefix: '260',
    documentLabels: { national_id: 'National Registration Card (NRC)', driving_license: 'Driving Licence' },
    minWalletBalance: 50,
    mapCenter: [-15.3875, 28.3228], // Lusaka
    // Recalibrated after real testing feedback flagged fares as too high
    // across Uganda, Zambia, and Malawi. Car rate grounded in a specific
    // real data point: Lusaka taxi rides run roughly $2.70 (≈67 ZMW) for
    // 5km. Motorcycle kept proportional to car, since Zambia doesn't have
    // Uganda's well-documented boda-boda pricing to solve against directly.
    rates: {
      motorcycle: { base: 13, perKm: 5 }, // motorcycle-taxi culture isn't well documented in Zambia the way it is in Uganda — confirm riders/drivers actually want this option before real launch
      car: { base: 22, perKm: 9 }
    },
    wasteRates: { collectionFee: 40, recyclingPerKg: 2 } // placeholder — not researched against real Zambia waste-management pricing
  },
  MW: {
    // Calibrated against a published Blantyre taxi rate of roughly
    // MWK 200/km — the earlier placeholder here was 5-8x too high,
    // a good reason this got checked against real data before
    // actually launching rather than left as a guess.
    name: 'Malawi',
    currency: 'MWK',
    flag: '🇲🇼',
    dialPrefix: '265',
    documentLabels: { national_id: 'National Identity Card', driving_license: 'Driving Licence' },
    minWalletBalance: 5000,
    mapCenter: [-13.9626, 33.7741], // Lilongwe
    // Recalibrated after real testing feedback flagged fares as too high.
    // Honest note: research turned up conflicting real data for Malawi —
    // one source gives an explicit taxi-calculator formula (5,000 MWK
    // base + 400 MWK/km, implying ~7,000 MWK for 5km) while another
    // (Blantyre-specific) suggests a much cheaper ~200 MWK/km with
    // almost no base fee — nearly a 10x gap between two "real" sources.
    // Kept this LOWER, since actual tester feedback (real usage
    // behavior) is stronger evidence than either published rate card,
    // and both sources agree the calculator figure may be skewed toward
    // a premium/airport-transfer tier rather than everyday local pricing.
    rates: {
      motorcycle: { base: 250, perKm: 60 },
      car: { base: 400, perKm: 100 }
    },
    wasteRates: { collectionFee: 800, recyclingPerKg: 30 } // placeholder — not researched against real Malawi waste-management pricing
  },
  BW: {
    name: 'Botswana',
    currency: 'BWP',
    flag: '🇧🇼',
    dialPrefix: '267',
    documentLabels: { national_id: 'Omang (National ID)', driving_license: 'Driving Licence' },
    minWalletBalance: 50,
    mapCenter: [-24.6282, 25.9231], // Gaborone
    rates: {
      motorcycle: { base: 15, perKm: 8 }, // placeholder — motorcycle-taxi culture is far less common in Botswana than Uganda; verify this vehicle type is even wanted here before launch
      car: { base: 25, perKm: 15 }
    },
    wasteRates: { collectionFee: 40, recyclingPerKg: 2 } // placeholder — not researched against real Botswana waste-management pricing
  },
  ZW: {
    // Zimbabwe officially uses the ZiG (Zimbabwe Gold, introduced 2024),
    // but the US dollar accounts for roughly 70% of real transactions —
    // set to USD deliberately for that reason. Confirm this matches
    // reality on the ground before real money moves through it; switch
    // the `currency` value to 'ZWG' if you'd rather follow the official
    // currency instead.
    name: 'Zimbabwe',
    currency: 'USD',
    flag: '🇿🇼',
    dialPrefix: '263',
    documentLabels: { national_id: 'National Identity Card', driving_license: 'Driving Licence' },
    minWalletBalance: 2,
    mapCenter: [-17.8292, 31.0522], // Harare
    rates: {
      motorcycle: { base: 0.5, perKm: 0.3 },
      car: { base: 1, perKm: 0.6 }
    },
    wasteRates: { collectionFee: 3, recyclingPerKg: 0.15 } // placeholder — not researched against real Zimbabwe waste-management pricing
  }
};

const DEFAULT_COUNTRY = 'UG';
// Only countries actually ready to operate — others exist in COUNTRIES
// above so their config is ready, but won't show as a choice in the app
// until you're actually ready to launch there.
const ACTIVE_COUNTRIES = ['UG', 'ZM', 'MW'];

function isValidCountry(code) {
  return Object.prototype.hasOwnProperty.call(COUNTRIES, code);
}
function getCountry(code) {
  return COUNTRIES[code] || COUNTRIES[DEFAULT_COUNTRY];
}
function publicCountryList() {
  return ACTIVE_COUNTRIES.map(code => ({
    code, name: COUNTRIES[code].name, currency: COUNTRIES[code].currency, flag: COUNTRIES[code].flag,
    mapCenter: COUNTRIES[code].mapCenter, documentLabels: COUNTRIES[code].documentLabels,
    minWalletBalance: COUNTRIES[code].minWalletBalance
  }));
}
// Includes countries that exist in config but aren't launched yet — used
// so the app can tell "we don't operate here yet" apart from "we've
// never heard of this country," when detecting location via GPS.
function fullCountryList() {
  return Object.keys(COUNTRIES).map(code => ({
    code, name: COUNTRIES[code].name, currency: COUNTRIES[code].currency, flag: COUNTRIES[code].flag,
    mapCenter: COUNTRIES[code].mapCenter, active: ACTIVE_COUNTRIES.includes(code)
  }));
}

module.exports = { COUNTRIES, DEFAULT_COUNTRY, ACTIVE_COUNTRIES, isValidCountry, getCountry, publicCountryList, fullCountryList };
