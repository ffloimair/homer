// Temporary A/B harness — NOT meant to be committed. Proves the deep-link
// "prefills but never searches" bug is a real EventBus mount-order race.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { DashboardProvider, useDashboard, useWidgetSearch } from './DashboardContext'
import SearchDeepLinkBootstrap from '../SearchDeepLinkBootstrap'

function Loader({ dashboardId }: { dashboardId: string }) {
  const { loadDashboard } = useDashboard()
  useEffect(() => {
    loadDashboard(dashboardId)
  }, [loadDashboard, dashboardId])
  return null
}

function TestResultsWidget({ widgetId }: { widgetId: string }) {
  const searchData = useWidgetSearch(widgetId)
  useEffect(() => {
    if (searchData) {
      fetch('/api/v4/transactions/search', {
        method: 'POST',
        body: JSON.stringify(searchData),
      })
    }
  }, [searchData])
  return null
}

// Mirrors DashboardGrid: widget components only mount once `widgets` is
// populated (same commit as `loading` flipping false) - NOT unconditionally
// present from the first render. That's what makes this a real race against
// SearchDeepLinkBootstrap's effect.
function TestGrid() {
  const { widgets } = useDashboard()
  return (
    <>
      {widgets
        .filter((w) => w.type === 'results')
        .map((w) => (
          <TestResultsWidget key={w.id} widgetId={w.id} />
        ))}
    </>
  )
}

describe('dashboard deep-link A/B: mount-order race', () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/dashboards/d1')) {
      return new Response(
        JSON.stringify({
          data: {
            widgets: [
              { id: 'r1', type: 'results' },
              { id: 's1', type: 'search' },
            ],
          },
        }),
        { status: 200 },
      )
    }
    if (url.includes('/dashboards')) {
      return new Response(JSON.stringify({ data: [{ id: 'd1' }] }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  })

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/?call_id=abc-def-123&from=1700000000000&to=1700003600000#dashboard')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.pushState({}, '', '/')
  })

  it('runs the search on the results widget for a valid call_id deep link', async () => {
    render(
      <DashboardProvider
        apiBase="/api/v4"
        token="t"
        timeRange={{ from: 0, to: 0, activePreset: null, calendarPreset: null }}
        timeZone="UTC"
        requestTimeRange={vi.fn()}
      >
        <Loader dashboardId="d1" />
        <SearchDeepLinkBootstrap />
        <TestGrid />
      </DashboardProvider>,
    )

    await waitFor(() => {
      const searchCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/transactions/search'),
      )
      expect(searchCalls.length).toBeGreaterThan(0)
    })
  })
})
