import { Suspense, lazy, useRef } from 'react'
import { useInView } from 'motion/react'
import { Reveal } from './reveal'
import { TrendingUp, ArrowUpRight } from 'lucide-react'
import { SECTIONS } from '../../lib/links'

// Only fetched once the section is close to the viewport, which keeps recharts
// out of the initial download — a visitor who never scrolls this far never pays
// for it.
const RevenueChart = lazy(() => import('./analytics-chart'))

const topItems = [
  { name: 'Osh (palov)', share: 92, sold: 214 },
  { name: "Lag'mon", share: 74, sold: 172 },
  { name: 'Cappuccino', share: 61, sold: 143 },
  { name: 'Somsa', share: 48, sold: 112 },
]

export function Analytics() {
  const chartRef = useRef<HTMLDivElement>(null)
  // 300px of margin so the chunk is already loading by the time the chart is
  // actually on screen.
  const chartInView = useInView(chartRef, { once: true, margin: '300px' })

  return (
    <section id="tahlil" className="relative border-t border-border/60 bg-secondary/40 py-20 sm:py-32">
      <div className="mx-auto max-w-[1600px] px-5 md:px-10">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Analitika
            </span>
            <h2 className="mt-6 text-balance font-serif text-3xl font-medium leading-tight tracking-tight min-[400px]:text-4xl sm:text-5xl">
              Har bir qaror — raqamlar asosida
            </h2>
            <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
              Tushum, eng ko&apos;p sotiladigan taomlar, to&apos;lov usullari va
              buyurtma turlari — bir joyda. Hisobotni Excel&apos;ga ham
              yuklab olasiz.
            </p>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-6 lg:grid-cols-5">
          <Reveal className="lg:col-span-3" delay={0.1}>
            <div className="h-full rounded-3xl border border-border bg-card p-4 shadow-[0_30px_80px_-50px_rgba(30,60,40,0.35)] sm:p-8">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Namuna: haftalik tushum</p>
                  <p className="mt-1 font-serif text-2xl font-medium sm:text-3xl">
                    17 160 000 so&apos;m
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary">
                  <TrendingUp className="h-4 w-4" strokeWidth={2} />
                  +18.4%
                </span>
              </div>

              <div ref={chartRef} className="mt-8 h-[200px] w-full sm:h-[240px]">
                {chartInView && (
                  <Suspense
                    fallback={
                      <div className="h-full w-full animate-pulse rounded-2xl bg-muted" />
                    }
                  >
                    <RevenueChart />
                  </Suspense>
                )}
              </div>
            </div>
          </Reveal>

          <Reveal className="lg:col-span-2" delay={0.2}>
            <div className="h-full rounded-3xl border border-border bg-card p-4 shadow-[0_30px_80px_-50px_rgba(30,60,40,0.35)] sm:p-8">
              <p className="text-sm text-muted-foreground">Eng ko&apos;p sotilganlar</p>
              <ul className="mt-6 space-y-5">
                {topItems.map((item) => (
                  <li key={item.name}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{item.name}</span>
                      <span className="shrink-0 text-muted-foreground">{item.sold} dona</span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-700"
                        style={{ width: `${item.share}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <a
                href={SECTIONS.pricing}
                className="mt-8 inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
              >
                Hisobotlarni ulash
                <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
              </a>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
