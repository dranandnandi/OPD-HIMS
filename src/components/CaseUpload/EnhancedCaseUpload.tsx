import React from 'react';
import { useNavigate } from 'react-router-dom';
import AddVisitModal from '../Patients/AddVisitModal';

/**
 * Case-paper upload page.
 *
 * This now delegates to AddVisitModal, which drives the full flow — patient
 * selection, scan/upload or manual entry, AI extraction, and the rich EMRForm
 * (voice dictation, examination templates, clinical-image AI, allergy alerts) —
 * and persists the visit. Previously this route used a thinner, standalone EMR
 * form; unifying on AddVisitModal removes that downgraded path.
 */
const EnhancedCaseUpload: React.FC = () => {
  const navigate = useNavigate();

  return (
    <AddVisitModal
      onSave={() => navigate('/patients')}
      onClose={() => navigate('/patients')}
    />
  );
};

export default EnhancedCaseUpload;
