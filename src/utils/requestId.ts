/** Generates a UUID v4 to use as REQUEST-ID header in every ABDM API call. */
export const generateRequestId = (): string => crypto.randomUUID();
