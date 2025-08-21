/**
 * Utility functions for string manipulation
 */

/**
 * Converts a string to title case (capitalizes first letter of each word)
 * @param str - The string to convert
 * @returns The string in title case format
 */
export const toTitleCase = (str: string): string => {
  if (!str || typeof str !== 'string') {
    return '';
  }
  
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * Generates initials from a name (first letter of each word, max 2 letters)
 * @param name - The name to generate initials from
 * @returns The initials in uppercase
 */
export const getInitials = (name: string): string => {
  if (!name || typeof name !== 'string') {
    return 'U';
  }
  
  return name
    .split(' ')
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
};