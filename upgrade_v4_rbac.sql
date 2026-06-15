-- 🚀 LabStock Dynamic RBAC Migration (v4)

-- 1. Create Role Permissions Table
CREATE TABLE IF NOT EXISTS role_permissions (
    role TEXT PRIMARY KEY,
    allowed_menus TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Populate Initial Permissions (Based on current hardcoded logic)
INSERT INTO role_permissions (role, allowed_menus) VALUES
('Admin', ARRAY[
    'dashboard', 'analysis', 'logs', 
    'dispense', 'receive', 'count', 'borrow', 'lend', 
    'orders', 'receive_vendor', 
    'master_data', 'main_stock', 'user_management', 'sql_explorer', 
    'settings', 'notifications', 'barcodes'
]),
('Manager', ARRAY[
    'dashboard', 'analysis', 'logs', 
    'dispense', 'receive', 'count', 'borrow', 'lend', 
    'orders', 'receive_vendor', 
    'master_data', 'main_stock', 
    'settings', 'notifications', 'barcodes'
]),
('Operator', ARRAY[
    'dashboard', 'logs', 
    'dispense', 
    'notifications'
]),
('User', ARRAY[
    'dashboard', 'analysis', 'logs', 
    'dispense', 'receive', 'count', 'borrow', 'lend', 
    'orders', 'receive_vendor', 
    'notifications'
]),
('Vendor', ARRAY[
    'dashboard', 
    'lend',
    'vendor_orders', 'vendor_shipments', 
    'notifications'
])
ON CONFLICT (role) DO UPDATE SET 
    allowed_menus = EXCLUDED.allowed_menus,
    updated_at = NOW();
