import { CCTVPage } from '../CCTV/CCTVPage';
import { EventTablePage } from '../event/react/EventTablePage';
import { FahuiPage } from '../fahui/FahuiPage';
import { FormWorkspacePage } from '../form/react/FormWorkspacePage';
import { PermanentRegistrationPage } from '../permanent_registration/react/PermanentRegistrationPage';
import { UserControlPage } from '../user_control/react/UserControlPage';
import { FinancePage } from '../Account/react/FinancePage';
import { SongbookAdminPage } from '../changyou/react/SongbookAdminPage';
import { FileSystemPage } from '../file_system/react/FileSystemPage';
import { createElement } from 'react';
import type { ComponentType } from 'react';

export type CRMModuleKey =
  | 'user_control'
  | 'event_table'
  | 'dharma_event'
  | 'finance'
  | 'register'
  | 'cctv'
  | 'files'
  | 'songbook'
  | 'permanent_registration';

export type CRMModuleSpec = {
  key: CRMModuleKey;
  title: string;
  icon: string;
  description: string;
} & (
  | {
      panelType: 'legacy';
      render: (container: HTMLElement) => void | Promise<void>;
    }
  | {
      panelType: 'react';
      Component: ComponentType;
    }
);

export const CRM_MODULES: CRMModuleSpec[] = [
  {
    key: 'user_control',
    title: '用户管理',
    icon: 'fas fa-users-cog',
    description: '部门、权限与用户数据维护。',
    panelType: 'react',
    Component: UserControlPage,
  },
  {
    key: 'event_table',
    title: '活动表格',
    icon: 'fas fa-table',
    description: '查看和管理活动主表数据。',
    panelType: 'react',
    Component: EventTablePage,
  },
  {
    key: 'dharma_event',
    title: '法会',
    icon: 'fas fa-praying-hands',
    description: '法会相关后台管理入口。',
    panelType: 'react',
    Component: FahuiPage,
  },
  {
    key: 'finance',
    title: '财务',
    icon: 'fas fa-coins',
    description: '报销与财务审批工作台。',
    panelType: 'react',
    Component: FinancePage,
  },
  {
    key: 'register',
    title: '报名',
    icon: 'fas fa-clipboard-list',
    description: '表单报名、注册与记录查询。',
    panelType: 'react',
    Component: FormWorkspacePage,
  },
  {
    key: 'permanent_registration',
    title: '长期开放表格',
    icon: 'fas fa-id-card-clip',
    description: '会员与青少年班等长期开放报名表格工作台。',
    panelType: 'react',
    Component: PermanentRegistrationPage,
  },
  {
    key: 'cctv',
    title: '监控',
    icon: 'fas fa-video',
    description: '直播监控与 PTZ 控制入口。',
    panelType: 'react',
    Component: CCTVPage,
  },
  {
    key: 'songbook',
    title: '唱游歌簿',
    icon: 'fas fa-guitar',
    description: '管理唱游使用的歌词与 chord 歌簿。',
    panelType: 'react',
    Component: SongbookAdminPage,
  },
  {
    key: 'files',
    title: '文件系统',
    icon: 'fas fa-folder-tree',
    description: '文件浏览、上传、权限和回收站管理。',
    panelType: 'react',
    Component: () => createElement(FileSystemPage, { embedded: true }),
  },
];

export const DEFAULT_CRM_MODULE_KEY: CRMModuleKey = CRM_MODULES[0].key;

const CRM_MODULE_ALIASES: Record<string, CRMModuleKey> = {
  membership_registration: 'permanent_registration',
  youth_class_registration: 'permanent_registration',
};

export function resolveCRMModuleKey(moduleKey?: string | null): CRMModuleKey {
  const normalized = moduleKey ? CRM_MODULE_ALIASES[moduleKey] ?? moduleKey : null;
  return CRM_MODULES.find((item) => item.key === normalized)?.key ?? CRM_MODULES[0].key;
}

export function getCRMModule(moduleKey?: string | null) {
  const resolvedKey = resolveCRMModuleKey(moduleKey);
  return CRM_MODULES.find((item) => item.key === resolvedKey) ?? CRM_MODULES[0];
}

export function getCRMModuleAliasSection(moduleKey?: string | null): string | null {
  if (moduleKey === 'membership_registration') {
    return 'membership';
  }
  if (moduleKey === 'youth_class_registration') {
    return 'youth_class';
  }
  return null;
}
