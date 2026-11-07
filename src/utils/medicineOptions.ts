/** Shared choices for every clinic's medicine master. Values preserve existing records. */
export const medicineCategories = [
  'analgesic', 'antibiotic', 'antihistamine', 'antiseptic', 'antipyretic',
  'antidiabetic', 'diabetes', 'antihypertensive', 'cardiovascular', 'anticoagulant',
  'antiplatelet', 'lipid_lowering', 'gastrointestinal', 'antacid', 'antiemetic',
  'antidiarrhoeal', 'laxative', 'respiratory', 'bronchodilator', 'cough_cold',
  'antifungal', 'antiviral', 'antiparasitic', 'anti_inflammatory', 'steroid',
  'thyroid', 'neurological', 'psychiatric', 'dermatological', 'ophthalmic',
  'otic', 'hormonal', 'vitamin', 'mineral', 'supplement', 'surgical', 'other',
];

export const dosageForms = [
  'tablet', 'capsule', 'syrup', 'injection', 'cream', 'ointment', 'drops',
  'inhaler', 'suppository', 'suspension', 'powder', 'sachet', 'gel', 'spray',
  'rotacap', 'respule', 'granules', 'soap', 'shampoo', 'lotion', 'gargle',
  'solution', 'mouthwash', 'patch', 'surgical', 'other',
];

export const stockedUnits = [
  'Blister', 'Aluminium foil', 'Strip', 'Bottle', 'Vial', 'Ampoule',
  'Injection', 'Box', 'Pack', 'Tube', 'Sachet', 'Canister', 'Piece',
];

export const optionLabel = (value: string): string => value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
