import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../services/api';

export interface LicensePayload {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  type: 'trial' | 'standard' | 'enterprise';
  features: string[];
  limits: {
    maxNodes: number;
    maxVms: number;
    maxCloudAccounts?: number;
  };
}

export interface LicenseStatus {
  status: 'valid' | 'expired' | 'invalid' | 'missing';
  active: boolean;
  message?: string;
  payload?: LicensePayload;
  daysRemaining?: number;
}

interface LicenseContextType {
  license: LicenseStatus;
  loading: boolean;
  refresh: () => Promise<void>;
  activate: (key: string) => Promise<void>;
  hasFeature: (feature: string) => boolean;
}

const LicenseContext = createContext<LicenseContextType | undefined>(undefined);

export const useLicense = () => {
  const context = useContext(LicenseContext);
  if (context === undefined) {
    throw new Error('useLicense must be used within a LicenseProvider');
  }
  return context;
};

const DEFAULT_STATUS: LicenseStatus = {
  status: 'missing',
  active: false,
  message: 'Initializing...',
};

export const LicenseProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [license, setLicense] = useState<LicenseStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      // 不需要 Auth Token 也可以获取状态
      const res = await axios.get(`${API_BASE_URL}/api/system/license`);
      setLicense(res.data);
    } catch (error) {
      console.error('Failed to fetch license status:', error);
      setLicense({
        status: 'missing', // 或者 network_error?
        active: false,
        message: 'Failed to connect to license server',
      });
    } finally {
      setLoading(false);
    }
  };

  const activate = async (key: string) => {
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Please login first to activate license');
    }
    
    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/system/license/activate`,
        { licenseKey: key },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setLicense(res.data);
    } catch (error: any) {
      const msg = error.response?.data?.message || error.message || 'Activation failed';
      throw new Error(msg);
    }
  };

  const hasFeature = (feature: string): boolean => {
    if (!license.active || !license.payload) return false;
    return license.payload.features.includes(feature);
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <LicenseContext.Provider value={{ license, loading, refresh, activate, hasFeature }}>
      {children}
    </LicenseContext.Provider>
  );
};
