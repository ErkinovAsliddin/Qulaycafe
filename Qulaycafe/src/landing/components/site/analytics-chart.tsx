import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../ui/chart'

// recharts is ~400 kB of the landing bundle on its own, for one decorative
// chart at the bottom of a marketing page. It lives in this file so it can be
// a lazy chunk that is only fetched when the analytics section scrolls into
// view — see analytics.tsx.

// Illustrative figures for one demo week — the shape of the report, not a
// claim about any restaurant's revenue.
const revenueData = [
  { day: 'Du', revenue: 1240, orders: 84 },
  { day: 'Se', revenue: 1680, orders: 102 },
  { day: 'Ch', revenue: 1420, orders: 91 },
  { day: 'Pa', revenue: 2100, orders: 128 },
  { day: 'Ju', revenue: 3200, orders: 186 },
  { day: 'Sh', revenue: 3980, orders: 224 },
  { day: 'Ya', revenue: 3540, orders: 198 },
]

const chartConfig = {
  revenue: { label: 'Tushum', color: 'var(--chart-1)' },
} satisfies ChartConfig

export default function RevenueChart() {
  return (
    // ChartContainer's own `aspect-video` would win over a bare h-[240px] on
    // some widths, so the aspect is reset here.
    <ChartContainer config={chartConfig} className="aspect-auto h-full w-full">
      <AreaChart data={revenueData} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-revenue)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={10} className="text-xs" />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Area
          dataKey="revenue"
          type="natural"
          fill="url(#fillRevenue)"
          stroke="var(--color-revenue)"
          strokeWidth={2.5}
        />
      </AreaChart>
    </ChartContainer>
  )
}
