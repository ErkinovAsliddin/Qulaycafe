import { Reveal } from './reveal'
import { Users, Clock, CheckCircle2 } from 'lucide-react'
import { SECTIONS } from '../../lib/links'

type TableState = 'free' | 'seated' | 'bill'

const tables: { id: string; seats: number; state: TableState; time?: string }[] = [
  { id: '01', seats: 2, state: 'seated', time: '24 daq' },
  { id: '02', seats: 4, state: 'free' },
  { id: '03', seats: 4, state: 'bill', time: 'hisob' },
  { id: '04', seats: 2, state: 'seated', time: '8 daq' },
  { id: '05', seats: 6, state: 'free' },
  { id: '06', seats: 2, state: 'seated', time: '51 daq' },
  { id: '07', seats: 4, state: 'free' },
  { id: '08', seats: 8, state: 'bill', time: 'hisob' },
  { id: '09', seats: 2, state: 'seated', time: '12 daq' },
  { id: '10', seats: 4, state: 'free' },
  { id: '11', seats: 2, state: 'seated', time: '33 daq' },
  { id: '12', seats: 4, state: 'free' },
]

const stateStyles: Record<TableState, { dot: string; ring: string; label: string; text: string }> = {
  free: {
    dot: 'bg-muted-foreground/40',
    ring: 'border-border bg-card',
    label: "Bo'sh",
    text: 'text-muted-foreground',
  },
  seated: {
    dot: 'bg-primary',
    ring: 'border-primary/30 bg-primary/5',
    label: 'Band',
    text: 'text-primary',
  },
  bill: {
    dot: 'bg-accent',
    ring: 'border-accent/40 bg-accent/10',
    label: 'Hisob-kitob',
    text: 'text-accent-foreground',
  },
}

export function Tables() {
  return (
    // px-5/md:px-10 and max-w-[1600px] to match the sections above — the export
    // mixed two different container widths, so the page edge visibly jumped
    // from section to section.
    <section id="stollar" className="relative border-t border-border/60 py-20 sm:py-32">
      <div className="mx-auto max-w-[1600px] px-5 md:px-10">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Zal boshqaruvi
              </span>
              <h2 className="mt-6 text-balance font-serif text-3xl font-medium leading-tight tracking-tight min-[400px]:text-4xl sm:text-5xl">
                Butun zalni bir ekranda ko&apos;ring
              </h2>
              <p className="mt-5 max-w-md text-pretty text-lg leading-relaxed text-muted-foreground">
                Qaysi stol bo&apos;sh, qaysi biri hisob-kitob kutmoqda, mehmon
                qancha vaqt o&apos;tirdi — hammasi real vaqtda. Har bir stolning
                o&apos;z QR kodi bor, bron qilish ham shu yerda.
              </p>

              <dl className="mt-10 grid grid-cols-3 gap-4 sm:gap-6">
                {[
                  { icon: Users, k: 'Stol', v: 'QR kodi va holati' },
                  { icon: Clock, k: 'Vaqt', v: "mehmon o'tirgan vaqt" },
                  { icon: CheckCircle2, k: 'Bron', v: 'oldindan buyurtma' },
                ].map((s) => (
                  <div key={s.v}>
                    <s.icon className="h-5 w-5 text-primary" strokeWidth={1.5} />
                    <dt className="mt-3 font-serif text-xl font-medium sm:text-2xl">{s.k}</dt>
                    <dd className="text-sm text-muted-foreground">{s.v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="rounded-3xl border border-border bg-card p-4 shadow-[0_30px_80px_-40px_rgba(30,60,40,0.35)] sm:p-8">
              {/* The three legend chips plus the title do not fit on one line at
                  360px, so the header wraps instead of overflowing. */}
              <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="text-sm font-medium">Asosiy zal</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:gap-4">
                  {(['free', 'seated', 'bill'] as TableState[]).map((st) => (
                    <span key={st} className="flex items-center gap-1.5 text-muted-foreground">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${stateStyles[st].dot}`} />
                      {stateStyles[st].label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
                {tables.map((t) => {
                  const s = stateStyles[t.state]
                  return (
                    <div
                      key={t.id}
                      className={`flex aspect-square flex-col items-center justify-center rounded-2xl border ${s.ring} transition-transform duration-300 hover:-translate-y-1`}
                    >
                      <span className="font-serif text-lg font-medium">{t.id}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Users className="h-3 w-3" strokeWidth={1.5} />
                        {t.seats}
                      </span>
                      {t.time && <span className={`mt-1 text-[10px] font-medium ${s.text}`}>{t.time}</span>}
                    </div>
                  )
                })}
              </div>

              <a
                href={SECTIONS.features}
                className="mt-6 inline-flex text-sm font-medium text-primary transition-colors hover:text-primary/80"
              >
                Boshqa imkoniyatlar →
              </a>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
