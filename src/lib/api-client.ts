import axios from 'axios';
import type { AppEventsResponse } from '@/lib/app-events-types';
import type { ConfirmResult } from '@/lib/count-work-orders';
import type { ItemUsageDetail } from '@/lib/reagent-item-usage';

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

instance.interceptors.response.use((response) => response, (error) => {
  if (typeof window !== 'undefined' && error.response?.status === 401) {
    localStorage.removeItem('labstock_user');
    localStorage.removeItem('labstock_token');

    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

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
  isActive?: boolean;
  statusReason?: string | null;
  statusChangedAt?: string | null;
  quantity: number;
  lots: Lot[];
  [key: string]: unknown;
}

export interface Lot {
  inventoryId: number;
  lotNo: string;
  expDate: string;
  receivedOn: string;
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

export type ReorderStatus = 'normal' | 'reorder' | 'critical';

export interface ReagentUsageInsight {
  itemId: string;
  name: string;
  unit: string;
  quantity: number;
  minThreshold: number;
  dispensedLast90Days: number;
  averageDailyUsage: number;
  daysUntilMin: number | null;
  status: ReorderStatus;
  recommendedOrderQty: number;
}

export interface ExpiryRiskInsight {
  itemId: string;
  name: string;
  unit: string;
  lotNo: string;
  expDate: string;
  quantity: number;
  daysUntilExpiry: number;
  expectedDaysToUse: number | null;
  isExpiryRisk: boolean;
}

export interface UsageResponse {
  summary: UsageData[];
  dailyStats?: DailyStat[];
  weeklyStats?: { week: string; totalDispensed: number }[];
  expiringSoon?: { itemId: string; name: string; lotNo: string; expDate: string; quantity: number }[];
  slowMoving?: { itemId: string; name: string; stock: number }[];
  insights?: ReagentUsageInsight[];
  expiryRisks?: ExpiryRiskInsight[];
}

export type { ItemUsageDetail };

export interface BatchItem {
  inventoryId?: number;
  loanId?: number;
  itemId: string;
  lotNo: string;
  qty: number;
  name?: string;
  unit?: string;
  expDate?: string;
  receivedOn?: string;
  note?: string;
}

export interface WeeklyStockNotificationItem {
  itemId: string;
  name: string;
  quantity: number;
  unit: string;
  weeklyTarget: number;
  vendor: string;
}

export interface User {
  username: string;
  name: string;
  role: string;
  vendor?: string;
  department?: string | null;
  email?: string;
  accountStatus?: 'active' | 'pending' | 'suspended';
  vendorRequest?: string;
  password?: string;
  pin?: string;
  hasPin?: boolean;
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
  confidence?: "green" | "amber" | "red";
  mappingReason?: string;
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

export interface BarcodePattern {
  id: number;
  name: string;
  regex_pattern: string;
  item_id_group: number | null;
  lot_no_group: number | null;
  exp_date_group: number | null;
}

export type BarcodePatternCreatePayload = Omit<BarcodePattern, 'id'> & {
  sample_barcode: string;
};

export interface SettingsResponse {
  reagentTypes: string[];
  jobTypes: string[];
  machineTypes: string[];
  units: string[];
  vendors: string[];
  departments?: string[];
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

export interface CountWorkOrderSummary {
  id: number;
  ownerUsername: string;
  jobType: string;
  status: 'OPEN' | 'CONFIRMED' | 'CANCELLED';
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Runtime-only V2 pattern. Legacy clients can safely ignore this field. */
export interface BarcodePatternV2Runtime {
  id: number;
  name: string;
  mapping_mode: 'CAPTURED_IDENTIFIER' | 'FIXED_REAGENT';
  fixed_item_id: string | null;
  regex_pattern: string;
  item_id_group: number | null;
  lot_no_group: number | null;
  exp_date_group: number | null;
}

export interface BarcodeRuntimeResponse {
  patterns: BarcodePattern[];
  v2Patterns: BarcodePatternV2Runtime[];
  engineVersion: 1 | 2;
  v2Available?: boolean;
}

export type BarcodePatternV2Status = 'DRAFT' | 'VERIFIED' | 'ACTIVE' | 'INACTIVE';

export interface BarcodePatternV2Example {
  raw_barcode: string;
  expected_item_id?: string;
  expected_lot?: string;
  expected_exp_date?: string;
}

export interface BarcodePatternV2 {
  id: number;
  name: string;
  status: BarcodePatternV2Status;
  mapping_mode: 'CAPTURED_IDENTIFIER' | 'FIXED_REAGENT';
  fixed_item_id: string | null;
  regex_pattern: string;
  item_id_group: number | null;
  lot_no_group: number | null;
  exp_date_group: number | null;
  examples: BarcodePatternV2Example[];
  verification: {
    status: 'VERIFIED' | 'UNVERIFIED';
    errors: string[];
    warnings?: string[];
    checked_at?: string;
  };
  created_by?: string;
  updated_by?: string;
  activated_by?: string | null;
  deactivation_reason?: string | null;
  created_at: string;
  updated_at: string;
  activated_at?: string | null;
  deactivated_at?: string | null;
}

export interface BarcodePatternV2Payload {
  name: string;
  mapping_mode: 'CAPTURED_IDENTIFIER' | 'FIXED_REAGENT';
  fixed_item_id?: string | null;
  regex_pattern?: string;
  item_id_group?: number | null;
  lot_no_group?: number | null;
  exp_date_group?: number | null;
  examples: BarcodePatternV2Example[];
}

export interface PurchaseOrderSummary {
  id: number;
  po_number: string;
  vendor: string;
  status: string;
  expected_date?: string | null;
  created_at: string;
  items?: Array<{ item_id: string; item_name?: string; quantity: number; unit?: string }>;
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

export interface RolePermission {
  role: string;
  allowed_menus: string[];
  updated_at?: string;
}

export interface OutstandingLoan {
  id: number;
  direction: "BORROWED_IN" | "LENT_OUT";
  partner_name: string;
  item_id: string;
  item_name: string;
  lot_no: string;
  exp_date: string | null;
  remaining_qty: number;
  loaned_at: string;
}

export const apiClient = {
  // Permissions
  getPermissions: async () => {
    const res = await instance.get<RolePermission[] | RolePermission>('/api/permissions');
    return res.data;
  },

  updatePermissions: async (role: string, allowed_menus: string[]) => {
    const res = await instance.post<ApiResponse>('/api/permissions', { role, allowed_menus });
    return res.data;
  },

  getDashboard: async () => {
    const res = await instance.get<Reagent[]>('/api/dashboard');
    return res.data;
  },

  getPurchaseOrders: async () => {
    const res = await instance.get<PurchaseOrderSummary[]>('/api/purchase-orders');
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

  listCountWorkOrders: async () => (await instance.get<CountWorkOrderSummary[]>('/api/count-work-orders')).data,
  saveCountWorkOrder: async (jobType: string, items: Array<{ itemId: string; countedQty: number }>) =>
    (await instance.post<{ id: number; savedCount: number; alreadyDispensed: string[] }>('/api/count-work-orders', { jobType, items })).data,
  confirmCountWorkOrder: async (id: number, allocations: Array<{ itemId: string; inventoryId: number; qty: number }>) =>
    (await instance.post<ConfirmResult>(`/api/count-work-orders/${id}/confirm`, { allocations })).data,
  getCountWorkOrder: async (id: number) => (await instance.get(`/api/count-work-orders/${id}`)).data,
  updateCountWorkOrder: async (id: number, items: Array<{ itemId: string; countedQty: number }>) => (await instance.patch(`/api/count-work-orders/${id}`, { items })).data,
  getCountWorkOrderLots: async (id: number) => (await instance.get<Lot[]>(`/api/count-work-orders/${id}/lots`)).data,
  cancelCountWorkOrder: async (id: number) => (await instance.delete(`/api/count-work-orders/${id}`)).data,

  getAppEvents: async (filters: { username?: string; action?: string; outcome?: string; startDate?: string; endDate?: string; before?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    return (await instance.get<AppEventsResponse>(`/api/app-events?${params.toString()}`)).data;
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

  getItemUsage: async (itemId: string, startDate: string, endDate: string) => {
    const res = await instance.get<ItemUsageDetail>(
      `/api/usage/item?itemId=${encodeURIComponent(itemId)}&startDate=${startDate}&endDate=${endDate}`
    );
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

  getOutstandingLoans: async (direction: "BORROWED_IN" | "LENT_OUT") => {
    const res = await instance.get<OutstandingLoan[]>(`/api/reagent-loans?direction=${direction}`);
    return res.data;
  },

  recordLoanBatch: async (
    operation: "BORROW_IN" | "LEND_OUT" | "RETURN_IN" | "RETURN_OUT",
    partnerName: string,
    batchItems: BatchItem[]
  ) => {
    const res = await instance.post<ApiResponse>("/api/reagent-loans", { operation, partnerName, batchItems });
    return res.data;
  },

  updateUserAccountStatus: async (username: string, accountStatus: 'active' | 'suspended') => {
    const res = await instance.patch<ApiResponse>(`/api/users/${username}/account-status`, { accountStatus });
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

  updateSettings: async (action: 'add' | 'delete', type: string, value: string) => {
    const res = await instance.post('/api/settings', { action, type, value });
    return res.data;
  },

  // Barcode Patterns
  getBarcodePatterns: async () => {
    const res = await instance.get<BarcodePattern[]>('/api/settings/barcodes');
    return res.data;
  },

  updateReagentStatus: async (itemId: string, isActive: boolean, reason: string) => {
    const res = await instance.patch<ApiResponse>(`/api/master/${encodeURIComponent(itemId)}/status`, { isActive, reason });
    return res.data;
  },
  getBarcodeRuntimePatterns: async () => {
    const res = await instance.get<BarcodeRuntimeResponse>('/api/barcode-patterns/runtime');
    return res.data;
  },
  getBarcodeV2Patterns: async () => {
    const res = await instance.get<BarcodePatternV2[]>('/api/settings/barcode-v2');
    return res.data;
  },
  createBarcodeV2Pattern: async (data: BarcodePatternV2Payload) => {
    const res = await instance.post<ApiResponse<{ pattern: BarcodePatternV2 }>>('/api/settings/barcode-v2', data);
    return res.data;
  },
  updateBarcodeV2Pattern: async (id: number, data: BarcodePatternV2Payload) => {
    const res = await instance.patch<ApiResponse<{ pattern: BarcodePatternV2 }>>(`/api/settings/barcode-v2/${id}`, data);
    return res.data;
  },
  validateBarcodeV2Pattern: async (data: BarcodePatternV2Payload) => {
    const res = await instance.post<ApiResponse<{ verification: BarcodePatternV2['verification']; regex_pattern: string; item_id_group: number | null; lot_no_group: number | null; exp_date_group: number | null }>>('/api/settings/barcode-v2/validate', data);
    return res.data;
  },
  activateBarcodeV2Pattern: async (id: number) => {
    const res = await instance.post<ApiResponse<{ pattern: BarcodePatternV2 }>>(`/api/settings/barcode-v2/${id}/activate`);
    return res.data;
  },
  deactivateBarcodeV2Pattern: async (id: number, reason: string) => {
    const res = await instance.post<ApiResponse<{ pattern: BarcodePatternV2 }>>(`/api/settings/barcode-v2/${id}/deactivate`, { reason });
    return res.data;
  },
  deleteBarcodeV2Pattern: async (id: number) => {
    const res = await instance.delete<ApiResponse>(`/api/settings/barcode-v2/${id}`);
    return res.data;
  },
  createBarcodePattern: async (data: BarcodePatternCreatePayload) => {
    const res = await instance.post('/api/settings/barcodes', data);
    return res.data;
  },
  deleteBarcodePattern: async (id: number) => {
    const res = await instance.delete('/api/settings/barcodes', { data: { id } });
    return res.data;
  },

  reconcileInventory: async (data: {
    inventoryId: number;
    itemId: string;
    newLotNo: string;
    newExpDate?: string;
    newQty: number;
  }) => {
    const res = await instance.post<ApiResponse>('/api/inventory/reconcile', data);
    return res.data;
  },

  // Vendor Supply Chain
  getShipments: async () => {
    const res = await instance.get<Shipment[]>('/api/vendor/shipments');
    return res.data;
  },

  updateShipment: async (id: number, action: 'receive' | 'cancel', quantities?: { accepted_qty: number; rejected_qty: number; rejection_reason?: string; shelf_life_override_reason?: string }) => {
    const res = await instance.patch<ApiResponse>(`/api/vendor/shipments/${id}`, { action, ...quantities });
    return res.data;
  },

  getShelfLifeRules: async () => (await instance.get<{ available: boolean; rules: Record<string, number> }>('/api/master/shelf-life')).data,
  setShelfLifeRule: async (itemId: string, minShelfLifeDays: number | null) =>
    (await instance.patch<ApiResponse>('/api/master/shelf-life', { itemId, minShelfLifeDays })).data,

  uploadShipments: async (items: ShipmentItem[], referenceNo: string, poNumber?: string, trackingNo?: string, trackingProvider?: string, metadata?: Record<string, string>) => {
    const res = await instance.post<ApiResponse>('/api/vendor/shipments', { items, referenceNo, poNumber, trackingNo, trackingProvider, ...metadata });
    return res.data;
  },

  runRawQuery: async (query: string, params?: unknown[]) => {
    const res = await instance.post<ApiResponse<Record<string, unknown>[]>>('/api/raw-query', { query, params });
    return res.data;
  },

  sendWeeklyStockSummary: async (items: WeeklyStockNotificationItem[]) => {
    const res = await instance.post<ApiResponse>('/api/notifications/weekly-stock-summary', { items });
    return res.data;
  },

  sendVendorLowStockAlert: async () => {
    const res = await instance.post<ApiResponse>('/api/notifications/vendor-low-stock');
    return res.data;
  }
};
