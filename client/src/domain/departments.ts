import type { DepartmentMeta, DivisionId } from './types'
import { t } from '../i18n'

export const DEPARTMENTS: DepartmentMeta[] = [
  { id: 'research', label: t('department.research'), shortLabel: t('department.research'), color: '#7C3AED', priority: true },
  { id: 'product', label: t('department.product'), shortLabel: t('department.product'), color: '#E11D48', priority: true },
  { id: 'design', label: t('department.design'), shortLabel: t('department.design'), color: '#EA580C', priority: true },
  {
    id: 'engineering',
    label: t('department.engineering'),
    shortLabel: t('department.engineering'),
    color: '#1D4ED8',
    priority: true,
  },
  {
    id: 'game-development',
    label: t('department.game-development'),
    shortLabel: '게임 개발',
    color: '#2563EB',
    priority: true,
  },
  { id: 'testing', label: t('department.testing'), shortLabel: t('department.testing'), color: '#CA8A04', priority: true },
  { id: 'marketing', label: t('department.marketing'), shortLabel: t('department.marketing'), color: '#0D9488', priority: true },
  { id: 'strategy', label: t('department.strategy'), shortLabel: t('department.strategy'), color: '#4F46E5', priority: true },
  { id: 'sales', label: t('department.sales'), shortLabel: t('department.sales'), color: '#10B981', priority: false },
  { id: 'finance', label: t('department.finance'), shortLabel: t('department.finance'), color: '#16A34A', priority: false },
  { id: 'support', label: t('department.support'), shortLabel: t('department.support'), color: '#84CC16', priority: false },
  { id: 'security', label: t('department.security'), shortLabel: t('department.security'), color: '#EF4444', priority: false },
  { id: 'academic', label: t('department.academic'), shortLabel: t('department.academic'), color: '#8B5CF6', priority: false },
  {
    id: 'project-management',
    label: t('department.project-management'),
    shortLabel: 'PM',
    color: '#0EA5E9',
    priority: false,
  },
  {
    id: 'paid-media',
    label: t('department.paid-media'),
    shortLabel: t('department.paid-media'),
    color: '#EAB308',
    priority: false,
  },
  { id: 'gis', label: t('department.gis'), shortLabel: t('department.gis'), color: '#14B8A6', priority: false },
  {
    id: 'healthcare',
    label: t('department.healthcare'),
    shortLabel: t('department.healthcare'),
    color: '#0D9488',
    priority: false,
  },
  {
    id: 'spatial-computing',
    label: t('department.spatial-computing'),
    shortLabel: '공간',
    color: '#06B6D4',
    priority: false,
  },
  {
    id: 'specialized',
    label: t('department.specialized'),
    shortLabel: t('department.specialized'),
    color: '#6366F1',
    priority: false,
  },
]

export const PRIORITY_DEPARTMENTS = DEPARTMENTS.filter((d) => d.priority)

export const DEPARTMENT_MAP = Object.fromEntries(
  DEPARTMENTS.map((d) => [d.id, d]),
) as Record<DivisionId, DepartmentMeta>

export function getDepartment(id: DivisionId): DepartmentMeta {
  return DEPARTMENT_MAP[id] ?? {
    id,
    label: id,
    shortLabel: id,
    color: '#64748B',
    priority: false,
  }
}
