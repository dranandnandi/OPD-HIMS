/**
 * Phone number utilities for WhatsApp integration
 */

/**
 * Formats a phone number for WhatsApp API
 * Converts various formats to international format (e.g., 918780465286)
 * 
 * @param phone - Raw phone number string (can include spaces, dashes, parentheses, etc.)
 * @param defaultCountryCode - Country code to use if none present (default: '91' for India)
 * @returns Formatted phone number with country code
 * 
 * @example
 * formatPhoneForWhatsApp('08780465286') // returns '918780465286'
 * formatPhoneForWhatsApp('8780465286') // returns '918780465286'
 * formatPhoneForWhatsApp('918780465286') // returns '918780465286'
 * formatPhoneForWhatsApp('+91 8780465286') // returns '918780465286'
 * formatPhoneForWhatsApp('(878) 046-5286') // returns '918780465286'
 */
export function formatPhoneForWhatsApp(phone: string, defaultCountryCode: string = '91'): string {
  if (!phone) return '';
  
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  
  // Remove leading zeros
  cleaned = cleaned.replace(/^0+/, '');
  
  // If already has country code, return as is
  if (cleaned.startsWith(defaultCountryCode)) {
    return cleaned;
  }
  
  // If it's a 10-digit number (typical Indian mobile), add country code
  if (cleaned.length === 10) {
    return `${defaultCountryCode}${cleaned}`;
  }
  
  // If it's 11 digits and starts with country code without the first digit
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `9${cleaned}`;
  }
  
  // Return with country code prepended for other cases
  return `${defaultCountryCode}${cleaned}`;
}

/**
 * Validates if a phone number is properly formatted for WhatsApp
 * 
 * @param phone - Phone number to validate
 * @returns true if valid, false otherwise
 */
export function isValidWhatsAppPhone(phone: string): boolean {
  if (!phone) return false;
  
  const cleaned = phone.replace(/\D/g, '');
  
  // Should be at least 10 digits (without country code) or 12 digits (with country code)
  if (cleaned.length < 10 || cleaned.length > 15) {
    return false;
  }
  
  return true;
}

/**
 * Formats phone number for display
 * 
 * @param phone - Phone number to format
 * @returns Formatted phone number for display (e.g., +91 87804 65286)
 */
export function formatPhoneForDisplay(phone: string): string {
  if (!phone) return '';
  
  const cleaned = phone.replace(/\D/g, '');
  
  // Indian format: +91 XXXXX XXXXX
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    const countryCode = cleaned.substring(0, 2);
    const part1 = cleaned.substring(2, 7);
    const part2 = cleaned.substring(7);
    return `+${countryCode} ${part1} ${part2}`;
  }
  
  // Generic format with country code
  if (cleaned.length >= 10) {
    const countryCode = cleaned.substring(0, cleaned.length - 10);
    const mainNumber = cleaned.substring(cleaned.length - 10);
    return countryCode ? `+${countryCode} ${mainNumber}` : mainNumber;
  }
  
  return phone;
}
