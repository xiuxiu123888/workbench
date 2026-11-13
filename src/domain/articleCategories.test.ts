import { describe, expect, it } from 'vitest'
import { buildCategoryTree, categoryPathLabel, leafCategoryId } from './articleCategories'

describe('articleCategories', () => {
  const items = [
    { id: 1, name: '家居', alias: 'home', parentId: 0 },
    { id: 9, name: '厨房', parentId: 1 },
    { id: 10, name: '厨房用品', alias: 'kitchenware', parentId: 9 },
    { id: 20, name: '独立根', parentId: null },
  ]

  it('builds cascader tree from parentId', () => {
    const tree = buildCategoryTree(items)
    expect(tree).toEqual([
      {
        value: 1,
        label: '家居（home）',
        children: [
          {
            value: 9,
            label: '厨房',
            children: [{ value: 10, label: '厨房用品（kitchenware）' }],
          },
        ],
      },
      { value: 20, label: '独立根' },
    ])
  })

  it('labels path and leaf id', () => {
    expect(categoryPathLabel(items, 10)).toBe('家居 / 厨房 / 厨房用品')
    expect(leafCategoryId([1, 9, 10])).toBe(10)
    expect(leafCategoryId([])).toBeUndefined()
  })
})
