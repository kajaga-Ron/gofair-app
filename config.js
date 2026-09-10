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
    rates: {
      motorcycle: { base: 1000, perKm: 700 },
      car: { base: 2000, perKm: 1300 }
    }
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
    minWalletBalance: 50,
    mapCenter: [-15.3875, 28.3228], // Lusaka
    rates: {
      motorcycle: { base: 18, perKm: 7 }, // motorcycle-taxi culture isn't well documented in Zambia the way it is in Uganda — confirm riders/drivers actually want this option before real launch
      car: { base: 30, perKm: 12 }
    }
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
    minWalletBalance: 5000,
    mapCenter: [-13.9626, 33.7741], // Lilongwe
    rates: {
      motorcycle: { base: 300, perKm: 120 },
      car: { base: 500, perKm: 200 }
    }
  },
  BW: {
    name: 'Botswana',
    currency: 'BWP',
    flag: '🇧🇼',
    dialPrefix: '267',
    minWalletBalance: 50,
    mapCenter: [-24.6282, 25.9231], // Gaborone
    rates: {
      motorcycle: { base: 15, perKm: 8 }, // placeholder — motorcycle-taxi culture is far less common in Botswana than Uganda; verify this vehicle type is even wanted here before launch
      car: { base: 25, perKm: 15 }
    }
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
    minWalletBalance: 2,
    mapCenter: [-17.8292, 31.0522], // Harare
    rates: {
      motorcycle: { base: 0.5, perKm: 0.3 },
      car: { base: 1, perKm: 0.6 }
    }
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
    code, name: COUNTRIES[code].name, currency: COUNTRIES[code].currency, flag: COUNTRIES[code].flag, mapCenter: COUNTRIES[code].mapCenter
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
