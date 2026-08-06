type Permissions = {
  dashboard: { canRead: boolean; canExport: boolean };
  syncMonitor: { canReadSync: boolean; canExportStoreData: boolean };
  userManagement: { canInvite: boolean; canRead: boolean };
  dtr: { canUploadDtr: boolean };
  storeManagement: {
    canCreate: boolean;
    canRead: boolean;
    canEdit: boolean;
    canDisable: boolean;
  };
  deviceManagement: {
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: boolean;
  };
};

export const ROLE_PERMISSIONS: Record<string, Permissions> = {
  SUPERADMIN: {
    dashboard: { canRead: true, canExport: true },
    syncMonitor: { canReadSync: true, canExportStoreData: true },
    userManagement: { canInvite: true, canRead: true },
    dtr: { canUploadDtr: true },
    storeManagement: {
      canCreate: true,
      canRead: true,
      canEdit: true,
      canDisable: true,
    },
    deviceManagement: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    },
  },
  HR: {
    dashboard: { canRead: true, canExport: true },
    syncMonitor: { canReadSync: true, canExportStoreData: true },
    userManagement: { canInvite: false, canRead: true },
    dtr: { canUploadDtr: true },
    storeManagement: {
      canCreate: false,
      canRead: true,
      canEdit: false,
      canDisable: false,
    },
    deviceManagement: {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    },
  },
  MP: {
    dashboard: { canRead: false, canExport: false },
    syncMonitor: { canReadSync: false, canExportStoreData: false },
    userManagement: { canInvite: false, canRead: false },
    dtr: { canUploadDtr: true },
    storeManagement: {
      canCreate: false,
      canRead: false,
      canEdit: false,
      canDisable: false,
    },
    deviceManagement: {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    },
  },
};
