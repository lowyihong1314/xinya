import { CCTVPage } from '../CCTV/CCTVPage';
import { EventTablePage } from '../event/react/EventTablePage';
import { FahuiPage } from '../fahui/FahuiPage';
import { FormWorkspacePage } from '../form/react/FormWorkspacePage';
import { UserControlPage } from '../user_control/react/UserControlPage';
import { FinancePage } from '../Account/react/FinancePage';
import { SongbookAdminPage } from '../changyou/react/SongbookAdminPage';
import { FileSystemPage } from '../file_system/react/FileSystemPage';
import { YouthClassRegistrationPage } from '../youth_class/react/YouthClassRegistrationPage';
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
  | 'youth_class_registration';

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
    key: 'youth_class_registration',
    title: '青年佛学班报名',
    icon: 'fas fa-user-graduate',
    description: '青少年 & 青年佛学班前端报名表（暂未接后台）。',
    panelType: 'react',
    Component: YouthClassRegistrationPage,
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

export function getCRMModule(moduleKey?: string | null) {
  return CRM_MODULES.find((item) => item.key === moduleKey) ?? CRM_MODULES[0];
}

export function isCRMModuleKey(value: string | null): value is CRMModuleKey {
  return CRM_MODULES.some((item) => item.key === value);
}
