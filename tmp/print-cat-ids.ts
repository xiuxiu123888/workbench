import fs from 'node:fs'

const list = JSON.parse(fs.readFileSync('tmp/article-categories-raw.json', 'utf8')) as Array<{
  id: number
  name: string
  alias: string
  parentId: number | null
}>

const names = [
  'SUV',
  '汽车租赁',
  '新能源汽车',
  '微创注射美容',
  '注射美容',
  '注射除皱',
  '玻尿酸填充',
  '玻尿酸注射',
  '宠物产品',
  '消费电子',
  '数码设备',
  '汽车金融',
  '汽车贷款',
  '癌症治疗',
  '肿瘤专科药',
  '肿瘤 / 生物制剂',
  '面部提拉',
  '抗衰老',
  '护肤',
  '激光除皱/抗衰',
  '丁丙诺啡市场',
  '整形 / 医美',
  '心理健康 / 成瘾',
  '医美',
  '医疗·皮肤',
  '皮肤美容',
  '荷尔蒙与抗衰',
  '抗衰老与再生医学',
  '线上健康与保健产品热销',
]

const byName = new Map(list.map((c) => [c.name, c]))
const rows = names.map((name) => {
  const c = byName.get(name)
  return c
    ? { id: c.id, name: c.name, alias: c.alias, parentId: c.parentId }
    : { id: null, name, alias: '', parentId: null, missing: true }
})
console.log(JSON.stringify(rows, null, 2))
