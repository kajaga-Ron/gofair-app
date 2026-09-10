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
    name: 'Zambia',
    currency: 'ZMW',
    flag: '🇿🇲',
    dialPrefix: '260',
    minWalletBalance: 50,
    mapCenter: [-15.3875, 28.3228], // Lusaka
    rates: {
      motorcycle: { base: 15, perKm: 8 },
      car: { base: 25, perKm: 15 }
    }
  },
  MW: {
    name: 'Malawi',
    currency: 'MWK',
    flag: '🇲🇼',
    dialPrefix: '265',
    minWalletBalance: 5000,
    mapCenter: [-13.9626, 33.7741], // Lilongwe
    rates: {
      motorcycle: { base: 1500, perKm: 900 },
      car: { base: 2500, perKm: 1600 }
    }
  }
};

const DEFAULT_COUNTRY = 'UG';
// Only countries actually ready to operate — others exist in COUNTRIES
// above so their config is ready, but won't show as a choice in the app
// until you're actually ready to launch there.
const ACTIVE_COUNTRIES = ['UG'];

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
