import axios from 'axios';

// Create axios instance
const instance = axios.create();

// Add a request interceptor to inject the auth token
instance.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('labstock_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

export interface Reagent {
  itemId: string;
  qrCode: string;
  name: string;
  reagentType: string;
  jobType: string;
  machineType: string;
  unit: string;
  minThreshold: number;
  weeklyTarget: number;
  vendor?: string;
  quantity: number;
  lots: Lot[];
}

export interface Lot {
  rowIndex: number;
  lotNo: string;
  expDate: string;
  qty: number;
}

export interface UsageData {
  itemId: string;
  name: string;
  dispensed: number;
  adjusted: number;
  received: number;
}

export interface DailyStat {
  date: string;
  totalDispensed: number;
  items: Record<string, number>;
}

export interface UsageResponse {
  summary: UsageData[];
  dailyStats?: DailyStat[];
  weeklyStats?: { week: string; totalDispensed: number }[];
  expiringSoon?: { itemId: string; name: string; lotNo: string; expDate: string; quantity: number }[];
  slowMoving?: { itemId: string; name: string; stock: number }[];
}

export const apiClient = {
  getDashboard: async () => {
    const res = await instance.get<Reagent[]>('/api/dashboard');
    return res.data;
  },

  receiveBatch: async (batchItems: any[]) => {
    const res = await instance.post('/api/receive', { batchItems });
    return res.data;
  },

  dispenseBatch: async (batchItems: any[]) => {
    const res = await instance.post('/api/dispense', { batchItems });
    return res.data;
  },

  getLogs: async (limit: number = 100, filters?: { search?: string, action?: string, startDate?: string, endDate?: string }) => {
    let url = `/api/logs?limit=${limit}`;
    if (filters) {
      if (filters.search) url += `&search=${encodeURIComponent(filters.search)}`;
      if (filters.action) url += `&action=${encodeURIComponent(filters.action)}`;
      if (filters.startDate) url += `&startDate=${filters.startDate}`;
      if (filters.endDate) url += `&endDate=${filters.endDate}`;
    }
    const res = await instance.get(url);
    return res.data;
  },

  getUsage: async (startDate: string, endDate: string) => {
    const res = await instance.get<UsageResponse>(`/api/usage?startDate=${startDate}&endDate=${endDate}`);
    return res.data;
  },

  // Auth & Users
  login: async (credentials: any) => {
    const res = await instance.post('/api/auth/login', credentials);
    return res.data;
  },

  getUsers: async () => {
    const res = await instance.get('/api/users');
    return res.data;
  },

  addUser: async (userData: any) => {
    const res = await instance.post('/api/users', userData);
    return res.data;
  },

  updateUser: async (username: string, userData: any) => {
    const res = await instance.put(`/api/users/${username}`, userData);
    return res.data;
  },

  deleteUser: async (username: string) => {
    const res = await instance.delete(`/api/users/${username}`);
    return res.data;
  },

  saveMaster: async (data: any) => {
    const res = await instance.post('/api/master', data);
    return res.data;
  },

  getSettings: async () => {
    const res = await instance.get('/api/settings');
    return res.data;
  },

  updateSettings: async (data: { action: 'add' | 'delete', type: 'reagent' | 'job' | 'machine', value: string }) => {
    const res = await instance.post('/api/settings', data);
    return res.data;
  },

  reconcileInventory: async (data: { itemId: string, lotNo: string, newQty: number }) => {
    const res = await instance.post('/api/inventory/reconcile', data);
    return res.data;
  },

  // Vendor Supply Chain
  getShipments: async () => {
    const res = await instance.get('/api/vendor/shipments');
    return res.data;
  },

  updateShipment: async (id: number, action: 'receive' | 'cancel') => {
    const res = await instance.patch(`/api/vendor/shipments/${id}`, { action });
    return res.data;
  },

  uploadShipments: async (items: any[], referenceNo: string) => {
    const res = await instance.post('/api/vendor/shipments', { items, referenceNo });
    return res.data;
  },

  runRawQuery: async (query: string, params?: any[]) => {
    const res = await instance.post('/api/raw-query', { query, params });
    return res.data;
  }
};
