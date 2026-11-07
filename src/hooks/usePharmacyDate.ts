import { useEffect, useState } from 'react';
import { pharmacyDate } from '../utils/pharmacyExpiry';

/** Refresh open pharmacy screens when India's calendar day changes. */
export function usePharmacyDate() {
  const [today, setToday] = useState(() => pharmacyDate());
  useEffect(() => {
    const timer = setInterval(() => setToday(pharmacyDate()), 30000);
    return () => clearInterval(timer);
  }, []);
  return today;
}
