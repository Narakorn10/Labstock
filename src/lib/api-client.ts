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
  [key: string]: unknown;
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

export interface BatchItem {
  itemId: string;
  lotNo: string;
  qty: number;
  name?: string;
  unit?: string;
  expDate?: string;
  note?: string;
}

export interface User {
  username: string;
  name: string;
  role: string;
  company?: string;
  password?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
  user?: User;
  token?: string;
}

export interface ShipmentItem {
  itemId: string;
  lotNo: string;
  expDate: string;
  qty: number;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  itemId: string;
  name: string;
  lotNo: string;
  action: string;
  qty: number;
  user: string;
}

export interface SettingsResponse {
  reagentTypes: string[];
  jobTypes: string[];
  machineTypes: string[];
}

export interface Shipment {
  id: number;
  reference_no: string;
  vendor: string;
  item_id: string;
  lot_no: string;
  exp_date: string;
  quantity: number;
  status: 'In Transit' | 'Received' | 'Cancelled';
  created_at: string;
  reagent_name: string;
  unit: string;
}

export interface MasterReagentData {
  itemId?: string;
  qrCode?: string;
  barcode?: string;
  name?: string;
  reagentType?: string;
  jobType?: string;
  machineType?: string;
  unit?: string;
  minThreshold?: number | string;
  weeklyTarget?: number | string;
  vendor?: string;
  action?: 'add' | 'update' | 'bulk_add';
  items?: unknown[]; // For bulk_add
}

export const apiClient = {
  getDashboard: async () => {
    const res = await instance.get<Reagent[]>('/api/dashboard');
    return res.data;
  },

  receiveBatch: async (batchItems: BatchItem[]) => {
    const res = await instance.post<ApiResponse>('/api/receive', { batchItems });
    return res.data;
  },

  dispenseBatch: async (batchItems: BatchItem[]) => {
    const res = await instance.post<ApiResponse>('/api/dispense', { batchItems });
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
    const res = await instance.get<LogEntry[]>(url);
    return res.data;
  },

  getUsage: async (startDate: string, endDate: string) => {
    const res = await instance.get<UsageResponse>(`/api/usage?startDate=${startDate}&endDate=${endDate}`);
    return res.data;
  },

  // Auth & Users
  login: async (credentials: Partial<User>) => {
    const res = await instance.post<ApiResponse>('/api/auth/login', credentials);
    return res.data;
  },

  getUsers: async () => {
    const res = await instance.get<User[]>('/api/users');
    return res.data;
  },

  addUser: async (userData: User) => {
    const res = await instance.post<ApiResponse>('/api/users', userData);
    return res.data;
  },

  updateUser: async (username: string, userData: Partial<User>) => {
    const res = await instance.put<ApiResponse>(`/api/users/${username}`, userData);
    return res.data;
  },

  deleteUser: async (username: string) => {
    const res = await instance.delete<ApiResponse>(`/api/users/${username}`);
    return res.data;
  },

  saveMaster: async (data: MasterReagentData) => {
    const res = await instance.post<ApiResponse>('/api/master', data);
    return res.data;
  },

  getSettings: async () => {
    const res = await instance.get<SettingsResponse>('/api/settings');
    return res.data;
  },

  updateSettings: async (data: { action: 'add' | 'delete', type: 'reagent' | 'job' | 'machine', value: string }) => {
    const res = await instance.post<ApiResponse>('/api/settings', data);
    return res.data;
  },

  reconcileInventory: async (data: { itemId: string, lotNo: string, newQty: number }) => {
    const res = await instance.post<ApiResponse>('/api/inventory/reconcile', data);
    return res.data;
  },

  // Vendor Supply Chain
  getShipments: async () => {
    const res = await instance.get<Shipment[]>('/api/vendor/shipments');
    return res.data;
  },

  updateShipment: async (id: number, action: 'receive' | 'cancel') => {
    const res = await instance.patch<ApiResponse>(`/api/vendor/shipments/${id}`, { action });
    return res.data;
  },

  uploadShipments: async (items: ShipmentItem[], referenceNo: string) => {
    const res = await instance.post<ApiResponse>('/api/vendor/shipments', { items, referenceNo });
    return res.data;
  },

  runRawQuery: async (query: string, params?: unknown[]) => {
    const res = await instance.post<ApiResponse<Record<string, unknown>[]>>('/api/raw-query', { query, params });
    return res.data;
  }
};
