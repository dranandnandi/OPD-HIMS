/**
 * White-label branding.
 *
 * The active brand is chosen by hostname, so a single build + single Netlify
 * site can serve several branded domains (add each one as a domain alias).
 * Hostname is the only key available on the login screen — no user is signed in
 * yet at that point, so brand cannot come from the DB.
 *
 * To add a brand: add an entry to BRANDS, then map its domain in HOST_BRANDS.
 */

export interface Brand {
  key: string;
  /** Full company name, e.g. "The Doctorpreneur Academy" */
  company: string;
  /** Shorter form used in tight spaces (mobile header) */
  companyShort: string;
  /** Legal entity used in the copyright line */
  legalName: string;
  /** Product name shown under the login heading */
  productName: string;
  loginHeading: string;
  /** Full "Powered by ..." string */
  poweredBy: string;
  /** Sentence fragment for upgrade/support CTAs, e.g. "Contact The Doctorpreneur Academy" */
  supportContact: string;
  logoUrl: string;
  logoLoginUrl: string;
  /**
   * Logo presentation differs per brand: a square white-on-dark mark wants the
   * dark circle, a wide wordmark on a light background wants to sit bare.
   */
  loginLogoWrapperClass: string;
  loginLogoClass: string;
  navLogoClass: string;
  navLogoClassSmall: string;
  documentTitle: string;
  website: string;
  /** Safe prefix for generated file names */
  fileSlug: string;
}

const BRANDS: Record<string, Brand> = {
  doctorpreneur: {
    key: 'doctorpreneur',
    company: 'The Doctorpreneur Academy',
    companyShort: 'Doctorpreneur Academy',
    legalName: 'The Doctorpreneur Technologies',
    productName: 'Clinic Suite',
    loginHeading: 'Welcome to The Doctorpreneur Academy',
    poweredBy: 'Powered by The Doctorpreneur Academy',
    supportContact: 'Contact The Doctorpreneur Academy',
    logoUrl: 'https://i.ibb.co/XxgNyzFj/DC-logo.png',
    logoLoginUrl: 'https://i.ibb.co/8Lm1rMhv/DC-logo.png',
    loginLogoWrapperClass: 'w-24 h-24 bg-black rounded-full flex items-center justify-center shadow-md',
    loginLogoClass: 'w-12 h-12 object-contain',
    navLogoClass: 'w-6 h-6 object-contain',
    navLogoClassSmall: 'w-5 h-5 object-contain',
    documentTitle: 'The Doctorpreneur Academy - Clinic Suite',
    website: 'docpreneur.academy',
    fileSlug: 'Doctorpreneur',
  },
  anpro: {
    key: 'anpro',
    company: 'Anpro Healthtech',
    companyShort: 'Anpro Healthtech',
    legalName: 'Anpro Healthtech',
    productName: 'Clinic Suite',
    loginHeading: 'Welcome to Anpro Healthtech',
    poweredBy: 'Powered by Anpro Healthtech',
    supportContact: 'Contact Anpro Healthtech',
    logoUrl: 'https://ik.imagekit.io/18tsendxqy/Anpro%20OPD/Screenshot%202025-12-22%20144441.png',
    logoLoginUrl: 'https://ik.imagekit.io/18tsendxqy/Anpro%20OPD/Screenshot%202025-12-22%20144441.png',
    loginLogoWrapperClass: 'flex items-center justify-center',
    loginLogoClass: 'h-16 w-auto max-w-[240px] object-contain',
    navLogoClass: 'h-6 w-auto max-w-[120px] object-contain',
    navLogoClassSmall: 'h-5 w-auto max-w-[100px] object-contain',
    documentTitle: 'Anpro Healthtech - Clinic Suite',
    website: 'anprohealthtech.com',
    fileSlug: 'Anpro',
  },
};

const DEFAULT_BRAND = 'doctorpreneur';

const HOST_BRANDS: Record<string, string> = {
  'opdapp.anprohealthtech.com': 'anpro',
};

function resolveBrand(): Brand {
  if (typeof window === 'undefined') return BRANDS[DEFAULT_BRAND];

  // ?brand=anpro lets us preview any brand on any domain (sticky for the tab)
  const requested = new URLSearchParams(window.location.search).get('brand');
  if (requested && BRANDS[requested]) {
    sessionStorage.setItem('brandOverride', requested);
    return BRANDS[requested];
  }
  const stored = sessionStorage.getItem('brandOverride');
  if (stored && BRANDS[stored]) return BRANDS[stored];

  // Build-time pin, useful for local dev: VITE_BRAND=anpro npm run dev
  const envBrand = import.meta.env.VITE_BRAND as string | undefined;
  if (envBrand && BRANDS[envBrand]) return BRANDS[envBrand];

  const host = window.location.hostname.toLowerCase();
  return BRANDS[HOST_BRANDS[host] ?? DEFAULT_BRAND];
}

export const brand: Brand = resolveBrand();

/** Applies brand title + favicon to the document. Called once from main.tsx. */
export function applyBrandToDocument(): void {
  document.title = brand.documentTitle;

  let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement('link');
    icon.rel = 'icon';
    document.head.appendChild(icon);
  }
  icon.type = 'image/png';
  icon.href = brand.logoUrl;
}
