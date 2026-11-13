import type { CategoryOption } from '../api/article'

export interface CategoryTreeNode {
  value: number | string
  label: string
  children?: CategoryTreeNode[]
}

function categoryLabel(item: CategoryOption): string {
  const name = String(item.name ?? '').trim() || String(item.id)
  const alias = String(item.alias ?? '').trim()
  return alias ? `${name}（${alias}）` : name
}

/** 用 parentId 拼 cascader 树；无父或父不在列表中的节点作为根 */
export function buildCategoryTree(items: CategoryOption[]): CategoryTreeNode[] {
  const nodes = new Map<string, CategoryTreeNode & { parentKey: string }>()
  for (const item of items) {
    if (item.id == null || item.id === '') {
      continue
    }
    const key = String(item.id)
    const parentKey =
      item.parentId == null || item.parentId === '' || String(item.parentId) === '0'
        ? ''
        : String(item.parentId)
    nodes.set(key, {
      value: item.id,
      label: categoryLabel(item),
      parentKey,
      children: [],
    })
  }

  const roots: CategoryTreeNode[] = []
  for (const node of nodes.values()) {
    const { parentKey, ...rest } = node
    if (parentKey && nodes.has(parentKey)) {
      const parent = nodes.get(parentKey)!
      parent.children = parent.children || []
      parent.children.push(rest)
    } else {
      roots.push(rest)
    }
  }

  const prune = (list: CategoryTreeNode[]): CategoryTreeNode[] =>
    list.map((item) => {
      const children = item.children?.length ? prune(item.children) : undefined
      return children?.length ? { ...item, children } : { value: item.value, label: item.label }
    })

  return prune(roots)
}

export function categoryPathLabel(
  categories: CategoryOption[],
  categoryId: number | string | undefined | null,
): string {
  if (categoryId == null || categoryId === '') {
    return '—'
  }
  const byId = new Map(categories.map((item) => [String(item.id), item]))
  const parts: string[] = []
  let current: CategoryOption | undefined = byId.get(String(categoryId))
  const seen = new Set<string>()
  while (current && !seen.has(String(current.id))) {
    seen.add(String(current.id))
    parts.unshift(String(current.name ?? current.id).trim() || String(current.id))
    const parentId = current.parentId
    if (parentId == null || parentId === '' || String(parentId) === '0') {
      break
    }
    current = byId.get(String(parentId))
  }
  return parts.length ? parts.join(' / ') : String(categoryId)
}

export function leafCategoryId(path: Array<number | string> | undefined | null): number | undefined {
  if (!path?.length) {
    return undefined
  }
  const last = path[path.length - 1]
  const id = Number(last)
  return Number.isFinite(id) && id > 0 ? id : undefined
}

/** 选中节点及其全部子孙品类 id */
export function categorySubtreeIds(
  categories: CategoryOption[],
  rootId: number | string | undefined | null,
): Set<string> {
  if (rootId == null || rootId === '') {
    return new Set()
  }
  const children = new Map<string, string[]>()
  for (const item of categories) {
    if (item.id == null || item.id === '') {
      continue
    }
    const parent =
      item.parentId == null || item.parentId === '' || String(item.parentId) === '0'
        ? ''
        : String(item.parentId)
    if (!parent) {
      continue
    }
    const list = children.get(parent) ?? []
    list.push(String(item.id))
    children.set(parent, list)
  }
  const root = String(rootId)
  const out = new Set<string>([root])
  const stack = [root]
  while (stack.length) {
    const id = stack.pop()!
    for (const child of children.get(id) ?? []) {
      if (!out.has(child)) {
        out.add(child)
        stack.push(child)
      }
    }
  }
  return out
}
