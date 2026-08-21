import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Minus, Plus, QrCode, ShoppingBag } from 'lucide-react'
import { Reveal } from './reveal'
import { Img } from './img'

const EASE = [0.22, 1, 0.36, 1] as const

const MENU = [
  { id: 'burger', name: 'Klassik Burger', desc: 'Mol go‘shti, cheddar, sabzavot', price: 39000, img: '/images/food-closeup.webp' },
  { id: 'steak', name: 'Sizzling Steyk', desc: 'Ko‘katlar bilan bezatilgan', price: 89000, img: '/images/dish-main.webp' },
  { id: 'salad', name: 'Sezar salati', desc: 'Parmezan, kruton, sous', price: 34000, img: '/images/dish-salad.webp' },
  { id: 'coffee', name: 'Cappuccino', desc: 'Yangi qovurilgan don', price: 22000, img: '/images/coffee.webp' },
]

const CATS = ['Ommabop', 'Taomlar', 'Salatlar', 'Ichimliklar']

function formatSom(n: number) {
  // ru-RU groups thousands with a non-breaking space, and the space before
  // "so‘m" is non-breaking too, so a price never wraps mid-number inside the
  // narrow phone mock.
  return n.toLocaleString('ru-RU') + ' so‘m'
}

const FLOW = [
  'QR kodni skanerlang',
  'Menyu o‘z tilingizda ochiladi',
  'Taomni tanlang',
  'Savat yangilanadi',
  'Buyurtma oshxonaga ketadi',
]

export function QrMenu() {
  const [cart, setCart] = useState<Record<string, number>>({ steak: 1 })
  const [confirmed, setConfirmed] = useState(false)

  const count = Object.values(cart).reduce((a, b) => a + b, 0)
  const total = MENU.reduce((sum, m) => sum + (cart[m.id] ?? 0) * m.price, 0)

  function add(id: string) {
    setConfirmed(false)
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  }
  function remove(id: string) {
    setConfirmed(false)
    setCart((c) => {
      const next = { ...c }
      if (!next[id]) return next
      next[id] -= 1
      if (next[id] <= 0) delete next[id]
      return next
    })
  }

  return (
    // id was "imkoniyatlar", which the Ecosystem section also claims — two
    // elements shared one id and the nav link scrolled to whichever came first.
    <section id="qr-menyu" className="relative overflow-hidden py-20 md:py-36">
      <div className="pointer-events-none absolute -left-40 top-1/3 -z-10 size-[32rem] rounded-full bg-accent/15 blur-[120px]" />
      <div className="mx-auto grid max-w-[1600px] items-center gap-12 px-5 md:gap-14 md:px-10 lg:grid-cols-2 lg:gap-8">
        {/* text */}
        <div>
          <Reveal>
            <p className="mb-6 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
              03 — QR menyu
            </p>
            <h2 className="text-balance font-serif text-3xl font-medium leading-[1.06] tracking-tight text-foreground min-[400px]:text-4xl sm:text-5xl lg:text-6xl">
              Mehmon uchun qulay.
            </h2>
            <p className="mt-6 max-w-md text-pretty text-lg leading-relaxed text-muted-foreground">
              QR kodni skanerlang. Menyuni oching. Buyurtmani bir necha soniyada
              yuboring — ofitsiantni kutmasdan. Menyu o‘zbek, rus va ingliz
              tillarida.
            </p>
          </Reveal>

          <Reveal delay={0.15}>
            <ul className="mt-10 space-y-4">
              {FLOW.map((f, i) => (
                <li key={f} className="flex items-center gap-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span className="font-medium text-foreground">{f}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        {/* phone. Interactive: the buttons really do update the mock cart. */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.9, ease: EASE }}
          className="flex justify-center lg:justify-end"
        >
          {/* 320px + 2×10px bezel = 340px, which overflowed a 360px screen once
              the section's 2×20px padding is counted. w-full + max-w keeps the
              frame inside the viewport and still caps it on desktop. */}
          <div className="relative w-full max-w-[320px] rounded-[2.8rem] border-[10px] border-foreground/90 bg-foreground/90 shadow-[0_50px_100px_-40px_rgba(30,50,40,0.6)]">
            <div className="absolute left-1/2 top-2 z-20 h-6 w-32 -translate-x-1/2 rounded-full bg-foreground/90" />
            <div className="relative h-[620px] overflow-hidden rounded-[2.1rem] bg-background">
              {/* screen header */}
              <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-4 pb-4 pt-8 sm:px-5">
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                    QulayCafe
                  </p>
                  <p className="truncate font-serif text-lg font-medium text-foreground">
                    Bahor Restoran
                  </p>
                </div>
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                  <QrCode className="size-5" />
                </span>
              </div>

              {/* categories */}
              <div className="flex gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden">
                {CATS.map((c, i) => (
                  <span
                    key={c}
                    className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium ${
                      i === 0
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {c}
                  </span>
                ))}
              </div>

              {/* items */}
              <div className="h-[380px] space-y-3 overflow-y-auto px-4 pb-4 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden">
                {MENU.map((m) => {
                  const qty = cart[m.id] ?? 0
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-2.5"
                    >
                      <div className="relative size-16 shrink-0 overflow-hidden rounded-xl">
                        <Img
                          src={m.img}
                          alt={m.name}
                          fill
                          sizes="64px"
                          className="object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {m.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.desc}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-primary">
                          {formatSom(m.price)}
                        </p>
                      </div>
                      {qty === 0 ? (
                        <button
                          type="button"
                          onClick={() => add(m.id)}
                          aria-label={`${m.name} qo‘shish`}
                          className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-transform active:scale-90"
                        >
                          <Plus className="size-4" />
                        </button>
                      ) : (
                        <div className="flex shrink-0 items-center gap-2 rounded-xl bg-primary/10 p-1">
                          <button
                            type="button"
                            onClick={() => remove(m.id)}
                            aria-label={`${m.name} kamaytirish`}
                            className="grid size-7 place-items-center rounded-lg bg-card text-foreground"
                          >
                            <Minus className="size-3.5" />
                          </button>
                          <span className="w-4 text-center text-sm font-semibold text-foreground">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => add(m.id)}
                            aria-label={`${m.name} qo‘shish`}
                            className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* cart bar */}
              <div className="absolute inset-x-0 bottom-0 border-t border-border bg-card/95 p-4 backdrop-blur">
                <AnimatePresence mode="wait">
                  {confirmed ? (
                    <motion.div
                      key="confirmed"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-primary-foreground"
                    >
                      <Check className="size-5 shrink-0" strokeWidth={3} />
                      <span className="font-semibold">Buyurtma tasdiqlandi</span>
                    </motion.div>
                  ) : (
                    <motion.button
                      key="cart"
                      type="button"
                      onClick={() => count > 0 && setConfirmed(true)}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex w-full items-center justify-between gap-2 rounded-xl bg-primary px-4 py-3 text-primary-foreground disabled:opacity-60"
                      disabled={count === 0}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <span className="relative">
                          <ShoppingBag className="size-5" />
                          <motion.span
                            key={count}
                            initial={{ scale: 0.5 }}
                            animate={{ scale: 1 }}
                            className="absolute -right-2 -top-2 grid size-4 place-items-center rounded-full bg-accent text-[0.6rem] font-bold text-accent-foreground"
                          >
                            {count}
                          </motion.span>
                        </span>
                        Buyurtma berish
                      </span>
                      <span className="whitespace-nowrap text-sm font-bold">
                        {formatSom(total)}
                      </span>
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
