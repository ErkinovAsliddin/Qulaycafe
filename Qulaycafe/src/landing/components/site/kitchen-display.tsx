import { useState } from 'react'
import { LayoutGroup, motion } from 'motion/react'
import { Check, ChefHat, Clock } from 'lucide-react'
import { Reveal } from './reveal'

type Status = 'new' | 'cooking' | 'ready'

type Order = {
  id: number
  table: string
  items: string[]
  status: Status
}

// The kitchen screen labels each ticket with where it is going, because the
// real one does: a dine-in ticket, a delivery ticket and a takeaway ticket are
// handled differently by the staff.
const INITIAL: Order[] = [
  { id: 1, table: '12-stol', items: ['2 × Burger', '1 × Sezar salati', '2 × Cola'], status: 'new' },
  { id: 2, table: '🛵 Dostavka', items: ['3 × Sabzavotli salat'], status: 'new' },
  { id: 3, table: '04-stol', items: ['1 × Steyk', '2 × Cappuccino'], status: 'cooking' },
  { id: 4, table: '🥡 Olib ketish', items: ['1 × Burger', '1 × Limonad'], status: 'ready' },
]

const COLUMNS: { key: Status; title: string; tone: string }[] = [
  { key: 'new', title: 'Yangi buyurtmalar', tone: 'text-primary' },
  { key: 'cooking', title: 'Tayyorlanmoqda', tone: 'text-accent-foreground' },
  { key: 'ready', title: 'Tayyor', tone: 'text-primary' },
]

const EASE = [0.22, 1, 0.36, 1] as const

export function KitchenDisplay() {
  const [orders, setOrders] = useState<Order[]>(INITIAL)

  function advance(id: number) {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              status: o.status === 'new' ? 'cooking' : 'ready',
            }
          : o,
      ),
    )
  }

  return (
    <section id="oshxona" className="relative overflow-hidden bg-card py-20 md:py-36">
      <div className="mx-auto max-w-[1600px] px-5 md:px-10">
        <div className="max-w-2xl">
          <Reveal>
            <p className="mb-6 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
              04 — Oshxona ekrani
            </p>
            <h2 className="text-balance font-serif text-3xl font-medium leading-[1.06] tracking-tight text-foreground min-[400px]:text-4xl sm:text-5xl lg:text-6xl">
              Buyurtma oshxonaga darhol yetib boradi.
            </h2>
            <p className="mt-6 text-pretty text-lg leading-relaxed text-muted-foreground">
              Har bir buyurtma real vaqtda oshxona ekranida — stol, dostavka yoki
              olib ketish ekanligi aniq ko‘rinadi. Kartani bosing va holatni
              yangilang: shu yerda sinab ko‘rishingiz mumkin.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.15}>
          <div className="mt-12 grid gap-4 rounded-3xl border border-border bg-background p-4 shadow-[0_30px_80px_-50px_rgba(30,50,40,0.5)] md:grid-cols-3 md:p-6">
            <LayoutGroup>
              {COLUMNS.map((col) => {
                const colOrders = orders.filter((o) => o.status === col.key)
                return (
                  <div key={col.key} className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2.5 sm:px-4">
                      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                        <span className={`shrink-0 ${col.tone}`}>
                          {col.key === 'ready' ? (
                            <Check className="size-4" strokeWidth={3} />
                          ) : col.key === 'cooking' ? (
                            <ChefHat className="size-4" />
                          ) : (
                            <Clock className="size-4" />
                          )}
                        </span>
                        <span className="truncate">{col.title}</span>
                      </span>
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-background text-xs font-bold text-foreground">
                        {colOrders.length}
                      </span>
                    </div>

                    {/* min-h keeps an empty column from collapsing so the three
                        columns stay aligned as tickets move between them. */}
                    <div className="flex min-h-[80px] flex-col gap-3 md:min-h-[120px]">
                      {colOrders.map((o) => (
                        <motion.div
                          layout
                          layoutId={`order-${o.id}`}
                          key={o.id}
                          transition={{ duration: 0.55, ease: EASE }}
                          className="rounded-2xl border border-border bg-card p-4 shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-serif text-lg font-medium text-foreground">
                              {o.table}
                            </span>
                            {o.status === 'ready' && (
                              <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[0.65rem] font-semibold text-primary">
                                Tayyor
                              </span>
                            )}
                          </div>
                          <ul className="mt-2 space-y-1">
                            {o.items.map((it) => (
                              <li
                                key={it}
                                className="text-sm text-muted-foreground"
                              >
                                {it}
                              </li>
                            ))}
                          </ul>
                          {o.status !== 'ready' && (
                            <button
                              type="button"
                              onClick={() => advance(o.id)}
                              className="mt-3 w-full rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground transition-transform active:scale-95"
                            >
                              {o.status === 'new' ? 'Tayyorlanmoqda' : 'Tayyor'}
                            </button>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </LayoutGroup>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
