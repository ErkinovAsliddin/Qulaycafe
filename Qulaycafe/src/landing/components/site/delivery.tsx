import { Reveal } from './reveal'
import { Check, MapPin, Bike, Send } from 'lucide-react'
import { SECTIONS } from '../../lib/links'

// The draft had a "Mobil ilova" section here. There is no mobile app — the
// courier side runs on a Telegram bot, so this section shows that instead.
const points = [
  "Buyurtma to'g'ridan-to'g'ri kuryer botiga tushadi",
  'Mijoz manzili karta nuqtasi bilan yuboriladi',
  "Kuryer holatni bosadi — admin panelda darhol ko'rinadi",
  "Dostavka buyurtmalari hisobotda alohida hisoblanadi",
]

export function Delivery() {
  return (
    <section
      id="dostavka"
      className="relative overflow-hidden border-t border-border/60 bg-secondary/40 py-20 sm:py-32"
    >
      <div className="mx-auto max-w-[1600px] px-5 md:px-10">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            {/* 300px + 2×8px bezel keeps the frame inside a 360px screen once
                the section's 2×20px padding is counted. */}
            <div className="relative mx-auto w-full max-w-[300px] sm:max-w-sm">
              <div className="relative w-full rounded-[2.5rem] border-8 border-foreground/90 bg-foreground/90 shadow-[0_50px_120px_-40px_rgba(30,60,40,0.55)]">
                <div className="absolute left-1/2 top-0 z-10 h-6 w-28 -translate-x-1/2 rounded-b-2xl bg-foreground/90" />
                <div className="relative overflow-hidden rounded-[2rem] bg-card">
                  {/* Telegram-style chat header */}
                  <div className="flex items-center gap-3 border-b border-border bg-background px-4 pb-3 pt-8">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
                      <Bike className="size-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        QulayCafe — Dostavka
                      </p>
                      <p className="text-[0.65rem] text-muted-foreground">bot</p>
                    </div>
                  </div>

                  <div className="space-y-3 p-4">
                    {/* order message */}
                    <div className="max-w-[92%] rounded-2xl rounded-tl-md border border-border bg-secondary/70 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                        Yangi dostavka
                      </p>
                      <p className="mt-2 text-sm font-medium text-foreground">#1042</p>
                      <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                        <li>2 × Klassik Burger</li>
                        <li>1 × Cappuccino</li>
                      </ul>
                      <div className="mt-2.5 flex items-start gap-1.5 border-t border-border pt-2.5 text-xs text-foreground/90">
                        <MapPin className="mt-0.5 size-3.5 shrink-0 text-accent-foreground" strokeWidth={2} />
                        <span className="text-pretty">Amir Temur ko&apos;chasi 14, 3-qavat</span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-primary">100 000 so&apos;m</p>
                    </div>

                    {/* map pin card */}
                    <div className="relative h-20 max-w-[92%] overflow-hidden rounded-2xl border border-border bg-muted">
                      {/* Faint street grid, drawn with CSS so the mock costs
                          no extra image request. */}
                      <div
                        className="absolute inset-0 opacity-70"
                        style={{
                          backgroundImage:
                            'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
                          backgroundSize: '18px 18px',
                        }}
                      />
                      <span className="absolute left-1/2 top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg">
                        <MapPin className="size-4" strokeWidth={2.25} />
                      </span>
                      <span className="absolute bottom-2 left-2 rounded-full bg-card/90 px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground backdrop-blur">
                        Manzil
                      </span>
                    </div>

                    {/* courier reply */}
                    <div className="ml-auto flex max-w-[80%] items-center gap-2 rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground">
                      <Check className="size-4 shrink-0" strokeWidth={3} />
                      <span className="text-sm font-medium">Qabul qildim</span>
                    </div>

                    <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2">
                      <span className="flex-1 text-xs text-muted-foreground">Xabar…</span>
                      <Send className="size-4 shrink-0 text-primary" strokeWidth={2} />
                    </div>
                  </div>
                </div>
              </div>

              {/* floating badge — off-canvas on phones, so it only shows from sm */}
              <div className="absolute -right-4 top-24 hidden rounded-2xl border border-border bg-card px-4 py-3 shadow-xl sm:block">
                <p className="text-xs text-muted-foreground">Yetkazildi</p>
                <p className="font-serif text-lg font-medium text-primary">28 daq</p>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.15}>
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Dostavka
              </span>
              <h2 className="mt-6 text-balance font-serif text-3xl font-medium leading-tight tracking-tight min-[400px]:text-4xl sm:text-5xl">
                Kuryeringiz Telegram&apos;da ishlaydi
              </h2>
              <p className="mt-5 max-w-md text-pretty text-lg leading-relaxed text-muted-foreground">
                Alohida ilova o&apos;rnatish shart emas. Yetkazib berish
                buyurtmasi kuryerga Telegram&apos;da taom ro&apos;yxati, manzil
                va karta nuqtasi bilan boradi.
              </p>

              <ul className="mt-8 space-y-4">
                {points.map((p) => (
                  <li key={p} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </span>
                    <span className="text-pretty leading-relaxed text-foreground/90">{p}</span>
                  </li>
                ))}
              </ul>

              <a
                href={SECTIONS.pricing}
                className="mt-8 inline-flex text-sm font-medium text-primary transition-colors hover:text-primary/80"
              >
                Dostavkani ulash →
              </a>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
