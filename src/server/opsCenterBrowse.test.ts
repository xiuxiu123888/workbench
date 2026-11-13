import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadOpsCenterBrowseCatalog,
  loadOpsCenterFunnelDetail,
  loadOpsCenterOfferIndex,
} from './opsCenterBrowse'

const tempDirs: string[] = []

function writeJson(root: string, relative: string, data: unknown) {
  const full = path.join(root, 'data', 'ops-center', relative)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, JSON.stringify(data), 'utf8')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('opsCenterBrowse', () => {
  it('lists funnels and opens group/offer detail from local disk', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-browse-'))
    tempDirs.push(root)

    writeJson(root, 'meta.json', { primaryDay: '2026-11-10', pulledAt: '2026-11-10T12:00:00.000Z' })
    writeJson(root, 'raw/list.json', {
      data: [
        {
          funnelId: 'f1',
          funnelName: 'demo-v01',
          partnerName: 'P1',
          urlName: 'link-a',
          platform: 'MIS',
        },
      ],
    })
    writeJson(root, 'raw/groups.json', [
      {
        groupId: 'g1',
        groupName: 'demo-default',
        routing: 'rotator',
        geo: 'US',
        yesterdayRpm: 1.2,
        yesterdayRev: 3.4,
        offerList: [
          {
            offerId: 'o1',
            offerName: 'offer-a',
            categoryName: '个人贷款',
            weight: 1,
            channelId: '100',
            afsSource: '7',
            todayRpm: 2,
            todayRev: 5,
          },
        ],
        funnelId: 'f1',
        funnelName: 'demo-v01',
        partnerName: 'P1',
        urlName: 'link-a',
        platform: 'MIS',
      },
    ])
    writeJson(root, 'metrics/2026-11-10/all.json', {
      day: '2026-11-10',
      statsList: [
        {
          id: 'o1',
          name: 'offer-a',
          visits: 10,
          views: 20,
          conversion: 2,
          revenue: '8.5',
          funnelImpressions: 30,
          funnelClicks: 6,
          clicks: 4,
          funnelRpm: '1.1',
          rpc: '0.5',
          funnelCtr: '20',
          cvr1: '10',
          cvr2: '5',
          url: 'https://example.com/detail/1?channel=100',
        },
      ],
    })

    const catalog = loadOpsCenterBrowseCatalog(root)
    expect(catalog.funnelCount).toBe(1)
    expect(catalog.funnels[0].funnelName).toBe('demo-v01')
    expect(catalog.funnels[0].revenue).toBe(8.5)
    expect(catalog.matchedOfferCount).toBe(1)

    const detail = loadOpsCenterFunnelDetail(root, 'f1')
    expect(detail.groups).toHaveLength(1)
    expect(detail.groups[0].offers[0].offerName).toBe('offer-a')
    expect(detail.groups[0].offers[0].hasFlatStats).toBe(true)
    expect(detail.groups[0].offers[0].visits).toBe(10)
    expect(detail.groups[0].offers[0].rpc).toBe(0.5)
    expect(detail.groups[0].offers[0].cvr1).toBe(10)
    expect(detail.groups[0].offers[0].landingUrl).toContain('example.com')
  })

  it('offer index only includes allowlisted funnels', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-offer-index-'))
    tempDirs.push(root)

    writeJson(root, 'meta.json', { primaryDay: '2026-11-10' })
    writeJson(root, 'raw/list.json', {
      data: [
        { funnelId: 'f-allow', funnelName: 'reader-v01' },
        { funnelId: 'f-deny', funnelName: 'other-funnel' },
      ],
    })
    writeJson(root, 'raw/groups.json', [
      {
        groupId: 'g1',
        groupName: 'a',
        routing: null,
        geo: 'US',
        yesterdayRpm: 0,
        yesterdayRev: 0,
        offerList: [{ offerId: 'o-allow', offerName: 'allow-offer', categoryName: 'x', channelId: '1' }],
        funnelId: 'f-allow',
        funnelName: 'reader-v01',
      },
      {
        groupId: 'g2',
        groupName: 'b',
        routing: null,
        geo: 'US',
        yesterdayRpm: 0,
        yesterdayRev: 0,
        offerList: [{ offerId: 'o-deny', offerName: 'deny-offer', categoryName: 'x', channelId: '2' }],
        funnelId: 'f-deny',
        funnelName: 'other-funnel',
      },
    ])
    writeJson(root, 'metrics/2026-11-10/all.json', { day: '2026-11-10', statsList: [] })

    const index = loadOpsCenterOfferIndex(root)
    expect(index.offers.map((row) => row.offerId)).toEqual(['o-allow'])
    expect(index.offers[0].funnelNames).toEqual(['reader-v01'])
  })
})
