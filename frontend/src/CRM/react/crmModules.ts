import { CCTVPage } from '../CCTV/CCTVPage';
import { EventTablePage } from '../event/react/EventTablePage';
import { FahuiPage } from '../fahui/FahuiPage';
import { FormWorkspacePage } from '../form/react/FormWorkspacePage';
import { LongOpenRegistrationFormPage } from '../long_open_registration_form/react/LongOpenRegistrationFormPage';
import { UserControlPage } from '../user_control/react/UserControlPage';
import { FinancePage } from '../Account/react/FinancePage';
import { AssetWorkspace } from '../Account/react/asset/AssetWorkspace';
import { SongbookAdminPage } from '../changyou/react/SongbookAdminPage';
import { FileSystemPage } from '../file_system/react/FileSystemPage';
import { ManualPage } from '../manual/react/ManualPage';
import { createElement } from 'react';
import type { ComponentType } from 'react';

export type CRMModuleKey =
  | 'user_control'
  | 'event_table'
  | 'dharma_event'
  | 'finance'
  | 'asset'
  | 'register'
  | 'cctv'
  | 'files'
  | 'songbook'
  | 'permanent_registration'
  | 'manual';

export type CRMModuleSpec = {
  key: CRMModuleKey;
  title: string;
  icon: string;
  description: string;
  Component: ComponentType;
};

export const CRM_MODULES: CRMModuleSpec[] = [
  {
    key: 'user_control',
    title: '用户与部门',
    icon: 'fas fa-users-cog',
    description: '用户名片与部门/权限维护。',
    Component: UserControlPage,
  },
  {
    key: 'event_table',
    title: '创建活动',
    icon: 'fas fa-table',
    description: '查看和管理活动主表数据。',
    Component: EventTablePage,
  },
  {
    key: 'dharma_event',
    title: '法会',
    icon: 'fas fa-praying-hands',
    description: 'YLP 盂兰盆法会与 LAMP 点灯法会管理。',
    Component: FahuiPage,
  },
  {
    key: 'finance',
    title: '财务',
    icon: 'fas fa-coins',
    description: '报销与财务审批工作台。',
    Component: FinancePage,
  },
  {
    key: 'asset',
    title: '资产库存',
    icon: 'fa-solid fa-boxes-stacked',
    description: '仓库、库存、单据与库存流水。',
    Component: AssetWorkspace,
  },
  {
    key: 'register',
    title: '报名表格',
    icon: 'fas fa-clipboard-list',
    description: '特别活动报名、注册与记录查询。',
    Component: FormWorkspacePage,
  },
  {
    key: 'permanent_registration',
    title: '长期活动表格',
    icon: 'fas fa-id-card-clip',
    description: '会员与青少年班等长期活动报名表格工作台。',
    Component: LongOpenRegistrationFormPage,
  },
  {
    key: 'cctv',
    title: '监控',
    icon: 'fas fa-video',
    description: '直播监控与 PTZ 控制入口。',
    Component: CCTVPage,
  },
  {
    key: 'songbook',
    title: '唱游歌簿',
    icon: 'fas fa-guitar',
    description: '管理唱游使用的歌词与 chord 歌簿。',
    Component: SongbookAdminPage,
  },
  {
    key: 'files',
    title: '文件系统',
    icon: 'fas fa-folder-tree',
    description: '文件浏览、上传、权限和回收站管理。',
    Component: () => createElement(FileSystemPage, { embedded: true }),
  },
  {
    key: 'manual',
    title: '使用说明',
    icon: 'fas fa-book',
    description: '各模块中文使用说明，可在文档间跳转。',
    Component: ManualPage,
  },
];

export const DEFAULT_CRM_MODULE_KEY: CRMModuleKey = CRM_MODULES[0].key;
export const LONG_OPEN_REGISTRATION_FORM_PATH = '/long_open_registration_form';

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

export function buildCRMModulePath(moduleKey?: string | null) {
  const resolvedKey = resolveCRMModuleKey(moduleKey);
  if (resolvedKey === 'permanent_registration') {
    return LONG_OPEN_REGISTRATION_FORM_PATH;
  }
  return `/crm/${resolvedKey}`;
}

export function buildCRMModuleHref(moduleKey?: string | null, sourceSearchParams?: URLSearchParams) {
  void sourceSearchParams;
  return buildCRMModulePath(moduleKey);
}
