import React from 'react';
import { useLicense } from '../contexts/LicenseContext';

interface FeatureGateProps {
  feature: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

const FeatureGate: React.FC<FeatureGateProps> = ({ feature, children, fallback }) => {
  const { hasFeature } = useLicense();

  if (hasFeature(feature)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
};

export default FeatureGate;
